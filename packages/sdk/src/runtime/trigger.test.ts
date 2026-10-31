import assert from 'node:assert/strict'
import { test } from 'node:test'

const g = globalThis as any
const dataset: Record<string, string> = {}
g.location = { href: 'https://example.test/a' }
g.document = { documentElement: { dataset } }
g.window = { dispatchEvent: () => true }
g.CustomEvent = class {}
g.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
g.localStorage = g.sessionStorage

const { trigger, close } = await import('./trigger.ts')
const { getState, setState } = await import('./state.ts')

test('trigger restores a minimized report with the same draft and starts no new report', () => {
  close()
  assert.equal(trigger(), true)
  const draft = getState().draft
  const opened = dataset.nootedOpened
  setState({ note: 'hello', minimized: true })
  assert.equal(trigger(), true)
  assert.equal(getState().minimized, false)
  assert.equal(getState().open, true)
  assert.equal(getState().draft, draft)
  assert.equal(getState().note, 'hello')
  assert.equal(dataset.nootedOpened, opened)
  // Showing now: ignored.
  assert.equal(trigger(), false)
})

test('trigger is ignored while a capture is being taken, even if minimized', () => {
  setState({ minimized: true, captureMode: { kind: 'record', startedAt: 0 } })
  assert.equal(trigger(), false)
  assert.equal(getState().minimized, true)
  setState({ captureMode: undefined })
})

test('close clears minimized and the draft', () => {
  setState({ minimized: true })
  close()
  assert.equal(getState().minimized, false)
  assert.equal(getState().open, false)
  assert.equal(getState().draft, undefined)
})
