import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { MAX_AGE_MS, MAX_ITEMS, add, count, list, remove, resetForTests } from './queue.ts'

const item = (n: number, createdAt = 1_000_000 + n, projectKey = 'k') => ({
  clientReportId: `id-${n}`,
  projectKey,
  bytes: new Uint8Array([n]),
  createdAt,
})

// Node has no indexedDB, so these exercise the in-memory fallback.
describe('queue (memory fallback)', () => {
  beforeEach(resetForTests)

  it('keeps items in order and filters by project', async () => {
    await add(item(2))
    await add(item(1))
    await add(item(3, 1_000_003, 'other'))
    assert.deepEqual((await list('k', 1_000_100)).map((i) => i.clientReportId), ['id-1', 'id-2'])
    assert.equal((await list('other', 1_000_100)).length, 1)
  })

  it('removes items', async () => {
    await add(item(1, Date.now()))
    assert.equal(await count('k'), 1)
    await remove('id-1')
    assert.equal(await count('k'), 0)
  })

  it('drops the oldest when the 21st is added', async () => {
    for (let n = 1; n <= MAX_ITEMS + 1; n++) await add(item(n))
    const ids = (await list('k', 1_000_100)).map((i) => i.clientReportId)
    assert.equal(ids.length, MAX_ITEMS)
    assert.equal(ids[0], 'id-2')
  })

  it('drops items older than 7 days', async () => {
    await add(item(1, 0))
    await add(item(2, MAX_AGE_MS))
    assert.deepEqual((await list('k', MAX_AGE_MS + 5)).map((i) => i.clientReportId), ['id-2'])
  })
})
