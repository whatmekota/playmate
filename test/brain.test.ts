import type { Msg } from '../src/brain.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SseParser, trimHistory } from '../src/brain.ts'

const pairs = (n: number): Msg[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }))

test('trimHistory: nothing below the cap', () => {
  const h = pairs(28)
  trimHistory(h, 30)
  assert.equal(h.length, 28)
})

test('trimHistory: at the cap, back to half in one chunk, starting with a user turn', () => {
  const h = pairs(30)
  trimHistory(h, 30)
  assert.equal(h.length, 14)
  assert.equal(h[0].role, 'user')
  assert.equal(h[0].content, '16')
  assert.equal(h.at(-1)!.content, '29', 'the newest stay')
  // The start stays put for the next turns (the server's prompt cache).
  const first = h[0]
  h.push(...pairs(2))
  trimHistory(h, 30)
  assert.equal(h[0], first)
})

test('trimHistory: odd caps still keep pairs', () => {
  const h = pairs(10)
  trimHistory(h, 9)
  assert.equal(h.length % 2, 0)
  assert.equal(h[0].role, 'user')
})

test('SseParser: deltas across chunk boundaries; reasoning fields ignored', () => {
  const p = new SseParser()
  const stream = [
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking...' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo [spe' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'ed 60]' } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
  const out: string[] = []
  for (let i = 0; i < stream.length; i += 7)
    out.push(...p.push(stream.slice(i, i + 7)))
  assert.equal(out.join(''), 'Hello [speed 60]')
})
