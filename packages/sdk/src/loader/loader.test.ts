import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { loaderCode } from './code.generated.ts'

interface Env {
  w: any
  store: Map<string, string>
  scripts: any[]
  listeners: string[]
  warns: string[]
  replaced: unknown[][]
}

// Runs the built loader against a fake browser.
function run(opts: { hash?: string; enabled?: boolean; nonce?: string; existing?: object } = {}): Env {
  const store = new Map<string, string>(opts.enabled ? [['nooted:enabled', '1']] : [])
  const scripts: any[] = []
  const listeners: string[] = []
  const warns: string[] = []
  const replaced: unknown[][] = []
  const handlers: Record<string, ((e: any) => void)[]> = {}
  const w: any = {
    nooted: opts.existing,
    addEventListener: (type: string, fn: (e: any) => void) => {
      listeners.push(type)
      ;(handlers[type] ??= []).push(fn)
    },
    emit: (type: string, ev: object) => handlers[type]?.forEach((fn) => fn(ev)),
  }
  const document = {
    currentScript: opts.nonce ? { nonce: opts.nonce, getAttribute: () => null } : null,
    head: { appendChild: (s: any) => scripts.push(s) },
    createElement: () => ({
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) {
        this.attrs[k] = v
      },
    }),
  }
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  const location = { hash: opts.hash ?? '', pathname: '/cart', search: '?a=1' }
  const history = { state: { s: 1 }, replaceState: (...a: unknown[]) => void replaced.push(a) }
  const console = { warn: (...a: unknown[]) => void warns.push(a.join(' ')) }
  const config = { k: 'key1', u: 'https://nooted.test', r: '1.0' }
  new Function('window', 'document', 'localStorage', 'location', 'history', 'console', `(${loaderCode})(${JSON.stringify(config)})`)(
    w, document, localStorage, location, history, console,
  )
  return { w, store, scripts, listeners, warns, replaced }
}

test('defines the stub without side effects when disabled', () => {
  const env = run()
  const n = env.w.nooted
  assert.equal(n.v, 1)
  assert.deepEqual([n.k, n.u, n.r, n.q], ['key1', 'https://nooted.test', '1.0', []])
  assert.equal(env.scripts.length, 0)
  assert.deepEqual(env.listeners, [])
  assert.equal(env.replaced.length, 0)
})

test('does not clobber an existing global', () => {
  const existing = { v: 1 }
  const env = run({ existing, enabled: true })
  assert.equal(env.w.nooted, existing)
  assert.equal(env.scripts.length, 0)
})

test('enabled device injects the async runtime script and adds no listeners', () => {
  const env = run({ enabled: true })
  assert.equal(env.scripts.length, 1)
  assert.equal(env.scripts[0].src, 'https://nooted.test/sdk/v1/nooted.js')
  assert.equal(env.scripts[0].async, true)
  assert.deepEqual(env.listeners, [])
  env.w.nooted.l()
  assert.equal(env.scripts.length, 1, 'l() is idempotent')
})

test('a hash in the URL has no effect: flag untouched, no load, URL untouched', () => {
  for (const hash of ['#nooted', '#nooted-off', '#nooted2']) {
    const off = run({ hash })
    assert.equal(off.store.size, 0)
    assert.equal(off.scripts.length, 0)
    assert.equal(off.replaced.length, 0)
    const on = run({ hash, enabled: true })
    assert.equal(on.store.get('nooted:enabled'), '1')
    assert.equal(on.scripts.length, 1)
    assert.equal(on.replaced.length, 0)
  }
})

test('API calls queue; init enables and loads, disable clears the flag', () => {
  const env = run()
  env.w.nooted.open()
  env.w.nooted.init({ release: '2' })
  assert.deepEqual(env.w.nooted.q, [['open', []], ['init', [{ release: '2' }]]])
  assert.equal(env.store.get('nooted:enabled'), '1')
  assert.equal(env.scripts.length, 1)
  assert.deepEqual(env.listeners, [])
  env.w.nooted.disable()
  assert.equal(env.store.has('nooted:enabled'), false)
})

test('nonce is copied to the injected script', () => {
  const env = run({ enabled: true, nonce: 'r4nd0m' })
  assert.equal(env.scripts[0].attrs.nonce, 'r4nd0m')
  assert.equal(run({ enabled: true }).scripts[0].attrs.nonce, undefined)
})

test('load failure logs exactly one warning naming the URL and script-src', () => {
  const env = run({ enabled: true })
  env.scripts[0].onerror()
  env.w.nooted.l()
  assert.equal(env.warns.length, 1)
  assert.match(env.warns[0]!, /^\[nooted\].*https:\/\/nooted\.test\/sdk\/v1\/nooted\.js.*script-src/)
})

test('minified loader is at most 1 KB gzipped', () => {
  const size = gzipSync(loaderCode).length
  console.log(`loader gzipped: ${size} bytes`)
  assert.ok(size <= 1024, `${size} bytes`)
})
