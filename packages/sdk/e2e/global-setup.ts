import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type FullConfig } from '@playwright/test'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  AUTH_DIR,
  NOOTED_URL,
  OIDC_ISSUER,
  PLAYGROUND_PORT,
  PLAYGROUND_URL,
  PROJECT_FILE,
  SDK_DIR,
  SERVER_DIR,
  SERVER_PORT,
  STORAGE_STATE,
} from './env.ts'

// Starts everything the tests need and returns the teardown:
//   1. builds the SDK runtime, so tests run against the current dist/nooted.js
//   2. starts the Nooted server on a temp DATA_DIR
//   3. signs in as admin through Dex, creates a project allowing the playground origin
//   4. starts the playground with that project's key in its environment
// Dex must already be running (docker compose up -d dex).

const children: ChildProcess[] = []
let dataDir: string | undefined

function isPortTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: 'localhost' })
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })
}

async function waitForHttp(url: string, what: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${what} exited with code ${child.exitCode} during startup`)
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error(`${what} did not respond at ${url} within 60s`)
}

function start(name: string, args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  // Keep a short tail of output for failure messages without flooding the test output.
  const prefix = `[e2e:${name}] `
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      if (process.env.E2E_VERBOSE) process.stdout.write(chunk.toString().replace(/^/gm, prefix))
    })
  }
  children.push(child)
  return child
}

async function stopAll(): Promise<void> {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve()
          child.once('exit', () => resolve())
          child.kill('SIGTERM')
          setTimeout(() => (child.kill('SIGKILL'), resolve()), 5_000).unref()
        }),
    ),
  )
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  dataDir = undefined
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  for (const [port, name] of [
    [SERVER_PORT, 'the Nooted server'],
    [PLAYGROUND_PORT, 'the playground'],
  ] as const) {
    if (await isPortTaken(port)) {
      throw new Error(`Port ${port} is in use, but e2e needs it for ${name}. Stop pnpm dev before running e2e.`)
    }
  }
  try {
    await fetch(`${OIDC_ISSUER}/.well-known/openid-configuration`)
  } catch {
    throw new Error(`Dex is not reachable at ${OIDC_ISSUER}. Start it with: docker compose up -d dex`)
  }

  try {
    for (const config of ['vite.runtime.config.ts', 'vite.replay.config.ts']) {
      execFileSync('pnpm', ['exec', 'vite', 'build', '-c', config], { cwd: SDK_DIR, stdio: 'pipe' })
    }

    dataDir = mkdtempSync(join(tmpdir(), 'nooted-e2e-'))
    const server = start('server', ['src/index.ts'], SERVER_DIR, {
      PORT: String(SERVER_PORT),
      PUBLIC_URL: NOOTED_URL,
      DATA_DIR: dataDir,
      OIDC_ISSUER,
      OIDC_CLIENT_ID: 'nooted',
      OIDC_CLIENT_SECRET: 'nooted-dev-secret',
      NOOTED_ADMIN_EMAILS: ADMIN_EMAIL,
      SDK_DIST_DIR: join(SDK_DIR, 'dist'),
      WEB_DIST_DIR: '',
    })
    await waitForHttp(`${NOOTED_URL}/sdk/v1/nooted.js`, 'The Nooted server', server)

    const { projectId, projectKey } = await signInAndCreateProject()

    const require = createRequire(import.meta.url)
    const viteBin = join(require.resolve('vite/package.json'), '..', 'bin', 'vite.js')
    const playground = start('playground', [viteBin, 'playground', '--port', String(PLAYGROUND_PORT), '--strictPort'], SDK_DIR, {
      NOOTED_URL,
      NOOTED_PROJECT_KEY: projectKey,
    })
    await waitForHttp(PLAYGROUND_URL, 'The playground', playground)

    writeFileSync(PROJECT_FILE, JSON.stringify({ id: projectId, key: projectKey }, null, 2))
  } catch (error) {
    await stopAll()
    throw error
  }
  return stopAll
}

// Logs in as admin through Dex (the real OIDC flow), saves the session as storageState,
// and creates the project over the console API with that session.
async function signInAndCreateProject(): Promise<{ projectId: string; projectKey: string }> {
  mkdirSync(AUTH_DIR, { recursive: true })
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${NOOTED_URL}/auth/login`)
    await page.locator('input[name="login"]').fill(ADMIN_EMAIL)
    await page.locator('input[name="password"]').fill(ADMIN_PASSWORD)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL((url) => url.origin === NOOTED_URL && !url.pathname.startsWith('/auth/'))
    await context.storageState({ path: STORAGE_STATE })

    const created = await context.request.post(`${NOOTED_URL}/api/projects`, { data: { name: 'SDK e2e' } })
    if (!created.ok()) throw new Error(`Creating the project failed: ${created.status()} ${await created.text()}`)
    const project = (await created.json()) as { id: string; publicKey: string }

    const origin = await context.request.post(`${NOOTED_URL}/api/projects/${project.id}/origins`, {
      data: { origin: PLAYGROUND_URL },
    })
    if (!origin.ok()) throw new Error(`Adding the origin failed: ${origin.status()} ${await origin.text()}`)
    return { projectId: project.id, projectKey: project.publicKey }
  } finally {
    await browser.close()
  }
}
