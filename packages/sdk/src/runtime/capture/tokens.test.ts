import assert from 'node:assert/strict'
import { test } from 'node:test'
import { insertToken, nextNumber, stripToken, unknownTokens } from './tokens.ts'

const at = (n: number) => ({ start: n, end: n })

test('insert at the end after a space: token plus a trailing space, caret after it', () => {
  const r = insertToken('If I click ', at(11), 1)
  assert.equal(r.note, 'If I click [1] ')
  assert.deepEqual(r.caret, at(15))
})

test('insert after a word adds a space before', () => {
  assert.equal(insertToken('click', at(5), 2).note, 'click [2] ')
})

test('insert in the middle of words spaces both sides', () => {
  assert.equal(insertToken('ab', at(1), 3).note, 'a [3] b')
})

test('before a space or closing punctuation no extra space is added', () => {
  assert.equal(insertToken('click here', at(5), 1).note, 'click [1] here')
  assert.equal(insertToken('click.', at(5), 1).note, 'click [1].')
})

test('the selection is kept: the token goes after it', () => {
  assert.equal(insertToken('the button now', { start: 4, end: 10 }, 1).note, 'the button [1] now')
})

test('an empty note gets just the token and a space', () => {
  assert.equal(insertToken('', at(0), 1).note, '[1] ')
})

test('the length limit cuts the text after the caret, not the token', () => {
  const r = insertToken('aaaa bbbb', at(5), 1, 10)
  assert.equal(r.note, 'aaaa [1] b')
})

test('strip removes the token and tidies spaces', () => {
  assert.equal(stripToken('If I click [1] I want', 1), 'If I click I want')
  assert.equal(stripToken('click [1].', 1), 'click.')
  assert.equal(stripToken('[1] hello', 1), 'hello')
  assert.equal(stripToken('hello [1]', 1), 'hello')
  assert.equal(stripToken('a[1]b', 1), 'ab')
  assert.equal(stripToken('one [1] two [1] three', 1), 'one two three')
  assert.equal(stripToken('line\n[1]\nnext', 1), 'line\n\nnext')
})

test('strip only touches the given number', () => {
  assert.equal(stripToken('[1] and [2] and [12]', 1), 'and [2] and [12]')
  assert.equal(stripToken('see [10] and [1]', 1), 'see [10] and')
})

test('numbers: monotonic, then the smallest free one after 10', () => {
  assert.equal(nextNumber([], 0), 1)
  assert.equal(nextNumber([2], 2), 3)
  assert.equal(nextNumber([], 2), 3) // the highest was removed: not reused
  assert.equal(nextNumber([1, 2, 3, 4, 5, 6, 7, 8, 9], 10), 10)
  assert.equal(nextNumber([1, 2, 3, 5, 6, 7, 8, 9, 10], 10), 4)
})

test('unknown tokens are the [n] in the note with no capture, once each, in order', () => {
  assert.deepEqual(unknownTokens('see [2] and [1], then [2] again and [3]', [1]), [2, 3])
  assert.deepEqual(unknownTokens('all known [1] [10]', [1, 10]), [])
  assert.deepEqual(unknownTokens('not tokens: [a] [ 1 ] []', []), [])
})
