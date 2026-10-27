import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { loaderCspHash, loaderScript, loaderSnippet, nooted } from './index.ts'

const g = globalThis as any

// Must run first: the missing-global warning is once per page (module state).
test('without a loader: one warning in total, never throws', () => {
  const warns: string[] = []
  const orig = console.warn
  console.warn = (...a: unknown[]) => void warns.push(a.join(' '))
  try {
    g.window = {}
    nooted.open()
    nooted.init({ release: '1' })
    nooted.signOut()
    nooted.disable()
    assert.equal(warns.length, 1)
    assert.match(warns[0]!, /^\[nooted\]/)
  } finally {
    console.warn = orig
    delete g.window
  }
})

test('forwards calls with their arguments to window.nooted', () => {
  const calls: unknown[][] = []
  g.window = {
    nooted: {
      init: (...a: unknown[]) => calls.push(['init', ...a]),
      open: () => calls.push(['open']),
      signOut: () => calls.push(['signOut']),
      disable: () => calls.push(['disable']),
    },
  }
  try {
    nooted.init({ release: '1.4.2', button: false })
    nooted.open()
    nooted.signOut()
    nooted.disable()
    assert.deepEqual(calls, [['init', { release: '1.4.2', button: false }], ['open'], ['signOut'], ['disable']])
    g.window.nooted.open = () => {
      throw new Error('bad')
    }
    const orig = console.warn
    console.warn = () => {}
    try {
      assert.doesNotThrow(() => nooted.open())
    } finally {
      console.warn = orig
    }
  } finally {
    delete g.window
  }
})

const hostile = { projectKey: '</script><script>alert(1)//\u2028&', nootedUrl: 'https://n.test/</script>/', release: 'a\u2029>' }

test('snippet escapes anything that could break out of the script element', () => {
  const snippet = loaderSnippet(hostile)
  assert.equal(snippet.indexOf('</script'), snippet.length - '</script>'.length)
  assert.ok(!snippet.includes('\u2028') && !snippet.includes('\u2029'))
  assert.ok(snippet.includes('\\u003c/script\\u003e'))
  assert.ok(snippet.includes('\\u2028'))
})

test('trailing slash on the URL is stripped and release is optional', () => {
  const s = loaderScript({ projectKey: 'k', nootedUrl: 'https://n.test//' })
  assert.ok(s.endsWith('({"k":"k","u":"https://n.test"})'))
})

test('loaderCspHash is the sha256 of the text between the script tags', async () => {
  for (const options of [hostile, { projectKey: 'k', nootedUrl: 'https://n.test' }]) {
    const inner = loaderSnippet(options).slice('<script>'.length, -'</script>'.length)
    assert.equal(await loaderCspHash(options), `'sha256-${createHash('sha256').update(inner).digest('base64')}'`)
  }
})
