import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'

// Lives in e2e because global setup builds dist/nooted.js and dist/replay.js; unit tests run from a clean checkout.
test('the runtime bundle stays within 100 KB gzipped', () => {
  const bundle = readFileSync(new URL('../dist/nooted.js', import.meta.url))
  expect(gzipSync(bundle).length).toBeLessThanOrEqual(100 * 1024)
})

test('the replay bundle stays within 150 KB gzipped', () => {
  const bundle = readFileSync(new URL('../dist/replay.js', import.meta.url))
  expect(gzipSync(bundle).length).toBeLessThanOrEqual(150 * 1024)
})
