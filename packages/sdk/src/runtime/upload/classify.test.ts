import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classify } from './classify.ts'

describe('classify', () => {
  const table: [number, string][] = [
    [200, 'delivered'],
    [201, 'delivered'],
    [401, 'unauthorized'],
    [400, 'permanent'],
    [403, 'permanent'],
    [413, 'permanent'],
    [415, 'permanent'],
    [408, 'temporary'],
    [429, 'temporary'],
    [500, 'temporary'],
    [502, 'temporary'],
    [503, 'temporary'],
    [504, 'temporary'],
    [599, 'temporary'],
    // Unlisted statuses
    [404, 'permanent'],
    [422, 'permanent'],
    [204, 'temporary'],
    [301, 'temporary'],
    [0, 'temporary'],
  ]
  for (const [status, expected] of table) {
    it(`${status} is ${expected}`, () => assert.equal(classify({ status }), expected))
  }
  it('network error is temporary', () => assert.equal(classify({ networkError: true }), 'temporary'))
})
