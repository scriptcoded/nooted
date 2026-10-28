import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppDeps } from '../app.ts'
import { createReportStore } from '../feedback/report-store.ts'
import { authenticateBearer, bearerChallenge } from '../oauth/bearer.ts'
import { registerTools } from './tools.ts'

const VERSION = '0.1.0'

// Stateless Streamable HTTP: a fresh server and transport per request, plain JSON responses.
export function createMcpRoutes(deps: AppDeps) {
  const store = createReportStore(deps)
  return new Hono()
    .use(
      '/mcp',
      cors({
        origin: '*',
        allowHeaders: ['Authorization', 'Content-Type', 'mcp-protocol-version', 'mcp-session-id'],
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        exposeHeaders: ['WWW-Authenticate', 'mcp-session-id'],
        credentials: false,
      }),
    )
    .all('/mcp', async (c) => {
      const auth = await authenticateBearer({ config: deps.config, db: deps.db, oauth: deps.oauth }, c.req.raw)
      if ('error' in auth) {
        return c.json({ error: auth.error === 'missing' ? 'unauthorized' : 'invalid_token' }, 401, {
          'WWW-Authenticate': bearerChallenge(deps.config.publicUrl, auth.error),
        })
      }
      // Stateless: there is no session to stream notifications to or to delete.
      if (c.req.method !== 'POST') return c.json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' })
      const server = new McpServer({ name: 'nooted', version: VERSION })
      registerTools(server, deps, store, auth)
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      await server.connect(transport)
      try {
        return await transport.handleRequest(c.req.raw)
      } finally {
        await transport.close()
        await server.close()
      }
    })
}
