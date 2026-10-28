import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { NOOTED_URL } from './env.ts'

export const RESOURCE = `${NOOTED_URL}/mcp`

/** A loopback HTTP listener standing in for a desktop client's redirect URI. */
export interface Loopback {
  redirectUri: string
  /** Resolves with the next URL the browser is redirected to. */
  next(): Promise<URL>
  close(): Promise<void>
}

export async function startLoopback(): Promise<Loopback> {
  const waiting: ((url: URL) => void)[] = []
  const arrived: URL[] = []
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Callback</title><p>You can close this tab.</p>')
    const resolve = waiting.shift()
    if (resolve) resolve(url)
    else arrived.push(url)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    next: () => {
      const url = arrived.shift()
      return url ? Promise.resolve(url) : new Promise((resolve) => waiting.push(resolve))
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

export async function registerClient(redirectUri: string, name: string): Promise<string> {
  const response = await fetch(`${NOOTED_URL}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: name, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  })
  if (response.status !== 201) throw new Error(`register failed: ${response.status} ${await response.text()}`)
  return ((await response.json()) as { client_id: string }).client_id
}

export interface Authorization {
  url: string
  state: string
  verifier: string
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, scope = 'feedback.read feedback.write'): Authorization {
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(12).toString('base64url')
  const url = new URL(`${NOOTED_URL}/oauth/authorize`)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
    resource: RESOURCE,
    scope,
  }).toString()
  return { url: url.toString(), state, verifier }
}

export interface Tokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const response = await fetch(`${NOOTED_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  if (!response.ok) throw new Error(`token request failed: ${response.status} ${await response.text()}`)
  return (await response.json()) as Tokens
}

export const exchangeCode = (clientId: string, redirectUri: string, code: string, verifier: string) =>
  tokenRequest({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier, resource: RESOURCE })

export const refreshTokens = (clientId: string, refreshToken: string) =>
  tokenRequest({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken })

/** An MCP client (the official SDK) over Streamable HTTP with the bearer. */
export async function connectMcp(accessToken: string): Promise<Client> {
  const client = new Client({ name: 'e2e', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }))
  return client
}

export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; raw: CallToolResult }> {
  const raw = (await client.callTool({ name, arguments: args })) as CallToolResult
  const text = raw.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
  return { text, raw }
}
