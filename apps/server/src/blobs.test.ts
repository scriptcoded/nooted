import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createFsBlobStore } from './blobs.ts'
import type { BlobStore } from './blobs.ts'

describe('fs blob store', () => {
  let dir: string
  let store: BlobStore

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nooted-blobs-'))
    store = createFsBlobStore(dir)
  })

  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips bytes exactly, creating directories', async () => {
    const bytes = Uint8Array.from([0, 1, 2, 255, 254, 128])
    await store.put('reports/a/one.json.gz', bytes)
    const got = await store.get('reports/a/one.json.gz')
    assert.deepEqual(got && [...got], [...bytes])
  })

  it('overwrites an existing key', async () => {
    await store.put('o.bin', Uint8Array.from([1]))
    await store.put('o.bin', Uint8Array.from([2, 3]))
    assert.deepEqual([...(await store.get('o.bin'))!], [2, 3])
  })

  it('returns null for a missing key', async () => {
    assert.equal(await store.get('nope/missing'), null)
  })

  it('deletes a key and tolerates deleting a missing one', async () => {
    await store.put('d.bin', Uint8Array.from([1]))
    await store.delete('d.bin')
    assert.equal(await store.get('d.bin'), null)
    await store.delete('d.bin')
  })

  it('deletePrefix removes only that prefix', async () => {
    await store.put('p1/a', Uint8Array.from([1]))
    await store.put('p1/sub/b', Uint8Array.from([2]))
    await store.put('p2/a', Uint8Array.from([3]))
    await store.deletePrefix('p1/')
    assert.equal(await store.get('p1/a'), null)
    assert.equal(await store.get('p1/sub/b'), null)
    assert.notEqual(await store.get('p2/a'), null)
    await store.deletePrefix('does-not-exist/')
  })

  it('rejects path traversal and absolute keys', async () => {
    const bytes = Uint8Array.from([1])
    for (const key of ['../x', 'a/../../x', '/etc/x', '', 'a/..']) {
      await assert.rejects(store.put(key, bytes), /Invalid blob key/, key)
      await assert.rejects(store.get(key), /Invalid blob key/, key)
      await assert.rejects(store.delete(key), /Invalid blob key/, key)
      await assert.rejects(store.deletePrefix(key), /Invalid blob key/, key)
    }
  })
})
