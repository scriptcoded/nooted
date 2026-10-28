import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { consoleContextAs, readProject } from './helpers.ts'
import { sendRealReport } from './console-helpers.ts'
import { ADMIN_EMAIL, NOOTED_URL, STORAGE_STATE } from './env.ts'
import {
  RESOURCE,
  buildAuthorizeUrl,
  callTool,
  connectMcp,
  exchangeCode,
  refreshTokens,
  registerClient,
  startLoopback,
  type Loopback,
  type Tokens,
} from './mcp-helpers.ts'

// The whole MCP flow against the real server: a script client does OAuth with a browser signed in as admin,
// then talks to /mcp with the official MCP SDK client.

test.describe.configure({ mode: 'serial' })

const CLIENT_NAME = 'E2E Agent'
const projectUrl = () => `${NOOTED_URL}/projects/${readProject().id}`

let itemId = ''
let admin: BrowserContext
let loopback: Loopback
let clientId = ''
let tokens: Tokens
let mcp: Client | undefined

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  itemId = await sendRealReport(await context.newPage())
  await context.close()
  admin = await browser.newContext({ storageState: STORAGE_STATE, baseURL: NOOTED_URL })
  loopback = await startLoopback()
  clientId = await registerClient(loopback.redirectUri, CLIENT_NAME)
})

test.afterAll(async () => {
  await mcp?.close().catch(() => {})
  await admin?.close()
  await loopback?.close()
})

/** The item's row in the console list. */
async function statusRow(page: Page) {
  return page.getByTestId('feedback-row').filter({ hasText: 'should confirm' })
}

test('discovery points at the authorization server', async () => {
  const resource = await (await fetch(`${NOOTED_URL}/.well-known/oauth-protected-resource/mcp`)).json()
  expect(resource).toMatchObject({ resource: RESOURCE, authorization_servers: [NOOTED_URL] })
  const metadata = await (await fetch(`${NOOTED_URL}/.well-known/oauth-authorization-server`)).json()
  expect(metadata).toMatchObject({ issuer: NOOTED_URL, code_challenge_methods_supported: ['S256'] })
})

test('authorizing in the browser shows the consent page and Allow returns a code to the loopback listener', async () => {
  const auth = buildAuthorizeUrl(clientId, loopback.redirectUri)
  const page = await admin.newPage()
  await page.goto(auth.url)
  await expect(page).toHaveURL(/\/connect\/[^/]+$/)
  await expect(page.getByTestId('consent-client-name')).toContainText(CLIENT_NAME)
  await expect(page.getByTestId('consent-permissions')).toContainText('Read change requests')
  await expect(page.getByTestId('consent-permissions')).toContainText('Update their status')
  await expect(page.getByTestId('consent-card')).toContainText(ADMIN_EMAIL)

  const callback = loopback.next()
  await page.getByTestId('consent-allow').click()
  const url = await callback
  await expect(page).toHaveURL(/127\.0\.0\.1/)
  expect(url.searchParams.get('state')).toBe(auth.state)
  expect(url.searchParams.get('iss')).toBe(NOOTED_URL)
  const code = url.searchParams.get('code')
  expect(code).toBeTruthy()
  await page.close()

  tokens = await exchangeCode(clientId, loopback.redirectUri, code!, auth.verifier)
  expect(tokens.access_token).toMatch(/\S+/)
  expect(tokens.refresh_token).toMatch(/\S+/)
  expect(tokens.scope.split(' ').sort()).toEqual(['feedback.read', 'feedback.write'])
})

test('MCP lists tools, projects and the report, and the digest has the note, selector and recording', async () => {
  mcp = await connectMcp(tokens.access_token)
  const names = (await mcp.listTools()).tools.map((t) => t.name).sort()
  expect(names).toEqual(['get_feedback', 'list_feedback', 'list_projects', 'set_feedback_status'])

  const { id: projectId } = readProject()
  const projects = await callTool(mcp, 'list_projects')
  expect(projects.text).toContain(projectId)
  expect(projects.text).toContain('SDK e2e')

  const list = await callTool(mcp, 'list_feedback', { projectId })
  expect(list.text).toContain(itemId)
  expect(list.text).toContain('should confirm')

  const digest = await callTool(mcp, 'get_feedback', { itemId })
  expect(digest.raw.isError).toBeFalsy()
  expect(digest.text).toContain('button should confirm')
  expect(digest.text).toContain('Pointed at')
  expect(digest.text).toContain('#fx-counter')
  expect(digest.text).toContain('Recording')

  const everything = JSON.stringify([projects.raw, list.raw, digest.raw])
  expect(everything).not.toContain('"type":2')
  expect(everything).not.toContain('nodeId')
})

test('set_feedback_status shows in the console list, and a console change shows through MCP', async () => {
  const { id: projectId } = readProject()
  expect((await callTool(mcp!, 'set_feedback_status', { itemId, status: 'done' })).raw.isError).toBeFalsy()

  const page = await admin.newPage()
  await page.goto(projectUrl())
  await expect((await statusRow(page)).getByText('Done', { exact: true })).toBeVisible()

  await page.goto(`${projectUrl()}/feedback/${itemId}`)
  await expect(page.getByTestId('status-select')).toHaveText('Done')
  await page.getByTestId('status-select').click()
  await page.getByTestId('status-option-in_progress').click()
  await expect(page.getByTestId('status-select')).toHaveText('In progress')

  await expect
    .poll(async () => (await callTool(mcp!, 'list_feedback', { projectId })).text.split('\n').find((l) => l.includes(itemId)) ?? '')
    .toContain('In progress')
  await page.close()
})

test('refreshing rotates the tokens and the new access token works', async () => {
  const next = await refreshTokens(clientId, tokens.refresh_token)
  expect(next.access_token).not.toBe(tokens.access_token)
  expect(next.refresh_token).not.toBe(tokens.refresh_token)
  const client = await connectMcp(next.access_token)
  expect((await callTool(client, 'list_projects')).text).toContain(readProject().id)
  await client.close()
  tokens = next
  await mcp?.close().catch(() => {})
  mcp = undefined
})

test('Deny sends access_denied to the client', async () => {
  const auth = buildAuthorizeUrl(clientId, loopback.redirectUri, 'feedback.read')
  const page = await admin.newPage()
  await page.goto(auth.url)
  await expect(page.getByTestId('consent-permissions')).not.toContainText('Update their status')
  const callback = loopback.next()
  await page.getByTestId('consent-deny').click()
  const url = await callback
  await expect(page).toHaveURL(/127\.0\.0\.1/)
  expect(url.searchParams.get('error')).toBe('access_denied')
  expect(url.searchParams.get('state')).toBe(auth.state)
  expect(url.searchParams.get('code')).toBeNull()
  await page.close()
})

test('Connected agents lists the grant and Revoke makes /mcp answer 401', async () => {
  const page = await admin.newPage()
  await page.goto(`${NOOTED_URL}/settings/agents`)
  const row = page.getByTestId('agent-row').filter({ hasText: CLIENT_NAME })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Read and update status')
  await expect(page.getByTestId('mcp-command')).toContainText(`${NOOTED_URL}/mcp`)

  await row.getByTestId('agent-revoke').click()
  await page.getByTestId('agent-revoke-confirm').click()
  await expect(page.getByTestId('agent-row').filter({ hasText: CLIENT_NAME })).toHaveCount(0)
  await page.close()

  const response = await fetch(RESOURCE, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  expect(response.status).toBe(401)
  expect(response.headers.get('www-authenticate')).toMatch(/^Bearer /)
  await expect(refreshTokens(clientId, tokens.refresh_token)).rejects.toThrow()
})

test('a browser that is not signed in is sent to Dex, then lands on the consent page', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: NOOTED_URL })
  const page = await context.newPage()
  await page.goto(buildAuthorizeUrl(clientId, loopback.redirectUri).url)
  await page.locator('input[name="login"]').fill(ADMIN_EMAIL)
  await page.locator('input[name="password"]').fill('password')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/connect\/[^/]+$/)
  await expect(page.getByTestId('consent-client-name')).toContainText(CLIENT_NAME)
  await context.close()
})
