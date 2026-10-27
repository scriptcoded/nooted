import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBuffer, type BufferEvent } from './buffer.ts'

const META = 4
const FULL = 2
const INCR = 3

let clock = 0
const ev = (type: number, data: unknown = null): BufferEvent => ({ type, timestamp: clock++, data })

/** What rrweb emits on a checkout: Meta then FullSnapshot, both with isCheckout = true. */
function checkout(b: ReturnType<typeof createBuffer>, id: number) {
  b.push(ev(META, { id }), true)
  b.push(ev(FULL, { id }), true)
}

describe('buffer', () => {
  it('keeps only the last two segments in a long session', () => {
    const b = createBuffer()
    // Initial snapshot (no isCheckout), then 10 checkouts with 3 incremental events each.
    b.push(ev(META, { id: 0 }))
    b.push(ev(FULL, { id: 0 }))
    for (let i = 0; i < 3; i++) b.push(ev(INCR, { seg: 0 }))
    for (let id = 1; id <= 10; id++) {
      checkout(b, id)
      for (let i = 0; i < 3; i++) b.push(ev(INCR, { seg: id }))
    }
    const frozen = b.freeze()
    // Segments 9 and 10, each 2 + 3 events.
    assert.equal(frozen.length, 10)
    assert.ok(frozen.every((e) => e.type === INCR || (e.data as { id: number }).id >= 9))
    assert.ok(frozen.filter((e) => e.type === INCR).every((e) => (e.data as { seg: number }).seg >= 9))
    // Starts with the checkout's Meta + FullSnapshot pair.
    assert.equal(frozen[0]!.type, META)
    assert.equal(frozen[1]!.type, FULL)
    assert.equal((frozen[0]!.data as { id: number }).id, 9)
  })

  it('the checkout Meta+FullSnapshot pair stays in one segment', () => {
    const b = createBuffer()
    b.push(ev(META))
    b.push(ev(FULL))
    checkout(b, 1)
    checkout(b, 2)
    checkout(b, 3)
    const frozen = b.freeze()
    assert.deepEqual(frozen.map((e) => e.type), [META, FULL, META, FULL])
    assert.deepEqual(frozen.map((e) => (e.data as { id: number }).id), [2, 2, 3, 3])
  })

  it('keeps everything in a short session', () => {
    const b = createBuffer()
    b.push(ev(META))
    b.push(ev(FULL))
    for (let i = 0; i < 5; i++) b.push(ev(INCR))
    assert.equal(b.freeze().length, 7)
    checkout(b, 1)
    b.push(ev(INCR))
    assert.equal(b.freeze().length, 10) // both segments still held
  })

  it('freeze returns an immutable copy unaffected by later pushes', () => {
    const b = createBuffer()
    b.push(ev(META))
    b.push(ev(FULL))
    const frozen = b.freeze()
    assert.ok(Object.isFrozen(frozen))
    assert.throws(() => (frozen as BufferEvent[]).push(ev(INCR)), TypeError)
    b.push(ev(INCR))
    checkout(b, 1)
    checkout(b, 2)
    assert.equal(frozen.length, 2)
    assert.equal(frozen[0]!.type, META)
    assert.notEqual(b.freeze(), frozen)
  })

  it('clear empties the buffer and starts over', () => {
    const b = createBuffer()
    b.push(ev(META))
    b.push(ev(FULL))
    b.clear()
    assert.equal(b.freeze().length, 0)
    b.push(ev(INCR))
    assert.equal(b.freeze().length, 1)
  })
})
