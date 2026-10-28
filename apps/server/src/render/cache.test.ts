import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createFsBlobStore } from '../blobs.ts'
import { createTestApp } from '../test-helpers.ts'
import { createProjectRepo } from '../projects/repo.ts'
import { RENDER_VERSION, createRenderCache, stillKey } from './cache.ts'

const target = { projectId: 'p1', itemId: 'i1', n: 2 }
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 1])

describe('render cache', () => {
  it('stores under the versioned project prefix', async () => {
    const blobs = createFsBlobStore(await mkdtemp(join(tmpdir(), 'nooted-cache-')))
    const cache = createRenderCache(blobs)
    await cache.still(target, async () => jpeg)
    assert.equal(stillKey(target), `projects/p1/renders/i1/v${RENDER_VERSION}/2-still.jpg`)
    assert.deepEqual(Buffer.from((await blobs.get(stillKey(target)))!), jpeg)
  })

  it('collapses concurrent renders of the same key and reuses the stored result', async () => {
    const blobs = createFsBlobStore(await mkdtemp(join(tmpdir(), 'nooted-cache-')))
    const cache = createRenderCache(blobs)
    let renders = 0
    const render = async () => {
      renders++
      await new Promise((r) => setTimeout(r, 20))
      return jpeg
    }
    await Promise.all([cache.still(target, render), cache.still(target, render), cache.still(target, render)])
    await cache.still(target, render)
    assert.equal(renders, 1)
    await cache.still({ ...target, n: 3 }, render)
    assert.equal(renders, 2)
  })

  it('never stores failures, so the next call renders again', async () => {
    const blobs = createFsBlobStore(await mkdtemp(join(tmpdir(), 'nooted-cache-')))
    const cache = createRenderCache(blobs)
    await assert.rejects(cache.still(target, async () => { throw new Error('boom') }), /boom/)
    assert.equal(await blobs.get(stillKey(target)), null)
    assert.deepEqual(await cache.still(target, async () => jpeg), jpeg)
  })

  it('round-trips a storyboard', async () => {
    const blobs = createFsBlobStore(await mkdtemp(join(tmpdir(), 'nooted-cache-')))
    const cache = createRenderCache(blobs)
    const frames = [{ t: 0, caption: '0:00  start', image: jpeg }, { t: 5, caption: '0:05  end', image: Buffer.from([0xff, 0xd8, 0xff, 2]) }]
    await cache.frames(target, async () => frames)
    const got = await cache.frames(target, async () => { throw new Error('should be cached') })
    assert.deepEqual(got, frames)
  })

  it('is deleted with its project', async () => {
    const t = await createTestApp()
    await t.db.insertInto('projects').values({ id: 'p1', name: 'P', public_key: 'pk', retention_days: 90, created_at: 1 }).execute()
    const cache = createRenderCache(t.blobs)
    await cache.still(target, async () => jpeg)
    await cache.frames(target, async () => [{ t: 0, caption: '0:00  start', image: jpeg }])
    await createProjectRepo(t.db, t.blobs).remove('p1')
    assert.equal(await t.blobs.get(stillKey(target)), null)
    assert.equal(await t.blobs.get(`projects/p1/renders/i1/v${RENDER_VERSION}/2-frames.json`), null)
  })
})
