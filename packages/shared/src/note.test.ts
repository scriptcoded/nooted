import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitNote, unknownTokens } from './note.ts'

test('plain text is one text part', () => {
  assert.deepEqual(splitNote('just words'), [{ text: 'just words' }])
})

test('an empty note has no parts', () => {
  assert.deepEqual(splitNote(''), [])
})

test('a token at the start, the middle and the end', () => {
  assert.deepEqual(splitNote('[1] start'), [{ ref: 1 }, { text: ' start' }])
  assert.deepEqual(splitNote('see [2] there'), [{ text: 'see ' }, { ref: 2 }, { text: ' there' }])
  assert.deepEqual(splitNote('end [3]'), [{ text: 'end ' }, { ref: 3 }])
})

test('only a token', () => {
  assert.deepEqual(splitNote('[1]'), [{ ref: 1 }])
})

test('adjacent tokens give adjacent refs with no empty text between', () => {
  assert.deepEqual(splitNote('[1][2]'), [{ ref: 1 }, { ref: 2 }])
  assert.deepEqual(splitNote('a[1][2]b'), [{ text: 'a' }, { ref: 1 }, { ref: 2 }, { text: 'b' }])
})

test('brackets that are not a number stay text', () => {
  assert.deepEqual(splitNote('[a] [ 1 ] []'), [{ text: '[a] [ 1 ] []' }])
  assert.deepEqual(splitNote('x [a] [2] [b]'), [{ text: 'x [a] ' }, { ref: 2 }, { text: ' [b]' }])
})

test('multi-digit numbers are one reference', () => {
  assert.deepEqual(splitNote('see [10] and [1]'), [{ text: 'see ' }, { ref: 10 }, { text: ' and ' }, { ref: 1 }])
})

test('unknown tokens are the [n] in the note with no capture, once each, in order', () => {
  assert.deepEqual(unknownTokens('see [2] and [1], then [2] again and [3]', [1]), [2, 3])
  assert.deepEqual(unknownTokens('all known [1] [10]', [1, 10]), [])
  assert.deepEqual(unknownTokens('not tokens: [a] [ 1 ] []', []), [])
})
