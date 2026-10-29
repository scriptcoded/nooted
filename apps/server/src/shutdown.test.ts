import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'node:test'
import { createShutdown } from './shutdown.ts'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: (server.address() as AddressInfo).port }
}

function harness(server: Server, closers: Array<() => Promise<void>>, deadlineMs = 2000) {
  const exits: number[] = []
  const lines: string[] = []
  let onExit: () => void = () => {}
  const exited = new Promise<void>((resolve) => (onExit = resolve))
  const shutdown = createShutdown({
    server,
    closers,
    deadlineMs,
    exit: (code) => {
      exits.push(code)
      onExit()
    },
    log: (line) => lines.push(line),
  })
  return { shutdown, exits, lines, exited }
}

describe('shutdown', () => {
  it('exits 0 after closing an idle server', async () => {
    const { server } = await listen((_req, res) => res.end('ok'))
    const order: string[] = []
    const { shutdown, exits, exited } = harness(server, [
      async () => void order.push('renderer'),
      async () => void order.push('db'),
    ])
    shutdown('SIGTERM')
    await exited
    assert.deepEqual(exits, [0])
    assert.deepEqual(order, ['renderer', 'db'])
    assert.equal(server.listening, false)
  })

  it('lets an in-flight request finish, refuses new connections, then exits 0', async () => {
    const { server, port } = await listen((_req, res) => setTimeout(() => res.end('done'), 200))
    const { shutdown, exits, exited } = harness(server, [])
    const inFlight = fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())
    await tick(50)
    shutdown('SIGTERM')
    await tick(20)
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`))
    assert.deepEqual(exits, [])
    assert.equal(await inFlight, 'done')
    await exited
    assert.deepEqual(exits, [0])
  })

  it('cuts off a request that outlasts the deadline and exits 1', async () => {
    const { server, port } = await listen(() => {})
    const { shutdown, exits, exited } = harness(server, [], 100)
    const stuck = fetch(`http://127.0.0.1:${port}/`).catch(() => 'cut')
    await tick(30)
    shutdown('SIGTERM')
    await exited
    assert.deepEqual(exits, [1])
    assert.equal(await stuck, 'cut')
  })

  it('exits 1 at once on a second signal', async () => {
    const { server, port } = await listen(() => {})
    const { shutdown, exits } = harness(server, [])
    const stuck = fetch(`http://127.0.0.1:${port}/`).catch(() => 'cut')
    await tick(30)
    shutdown('SIGTERM')
    assert.deepEqual(exits, [])
    shutdown('SIGINT')
    assert.deepEqual(exits, [1])
    server.closeAllConnections()
    await stuck
  })

  it('exits 1 when a closer throws, still running the other closers', async () => {
    const { server } = await listen((_req, res) => res.end('ok'))
    const ran: string[] = []
    const { shutdown, exits, lines, exited } = harness(server, [
      async () => {
        throw new Error('boom')
      },
      async () => void ran.push('db'),
    ])
    shutdown('SIGTERM')
    await exited
    assert.deepEqual(exits, [1])
    assert.deepEqual(ran, ['db'])
    assert.ok(lines.some((line) => line.includes('boom')))
  })
})
