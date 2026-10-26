import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
  deletePrefix(prefix: string): Promise<void>
}

export function createFsBlobStore(rootDir: string): BlobStore {
  const root = resolve(rootDir)

  function pathFor(key: string): string {
    if (key === '' || key.startsWith('/') || key.includes('\0') || key.split(/[\\/]/).includes('..') || key.includes('..')) {
      throw new Error(`Invalid blob key: ${JSON.stringify(key)}`)
    }
    const full = resolve(root, key)
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`Invalid blob key: ${JSON.stringify(key)}`)
    }
    return full
  }

  return {
    async put(key, bytes) {
      const target = pathFor(key)
      await mkdir(dirname(target), { recursive: true })
      const temp = `${target}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, bytes)
        await rename(temp, target)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true })
    },
    async deletePrefix(prefix) {
      // Prefix is a directory-style prefix: "reports/p1/" or "reports/p1".
      await rm(pathFor(prefix), { recursive: true, force: true })
    },
  }
}
