import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyMoves, extractTags, parseTag } from '../src/tags.ts'

const lim = { maxSpm: 80, minDepth: 20, maxDepth: 90 }
const base = { spm: 40, depth: 50, pos: 50, shape: 'sine' as const }

test('parseTag: canonical forms', () => {
  assert.deepEqual(parseTag('speed 60'), [{ kind: 'speed', value: 60 }])
  assert.deepEqual(parseTag('depth 70'), [{ kind: 'depth', value: 70 }])
  assert.deepEqual(parseTag('pos high'), [{ kind: 'pos', value: 75 }])
  assert.deepEqual(parseTag('shape pulse'), [{ kind: 'shape', value: 'pulse' }])
  assert.deepEqual(parseTag('move 60 70'), [{ kind: 'speed', value: 60 }, { kind: 'depth', value: 70 }])
  assert.deepEqual(parseTag('stop'), [{ kind: 'stop' }])
  assert.deepEqual(parseTag('edge'), [{ kind: 'edge' }])
  assert.deepEqual(parseTag('end'), [{ kind: 'end' }])
})

test('parseTag: tolerant of case, spaces, :, =, %, commas, glued numbers', () => {
  for (const t of ['Speed: 60', ' SPEED=60 ', 'speed60', 'spm 60', 'speed: 60 '])
    assert.deepEqual(parseTag(t), [{ kind: 'speed', value: 60 }], t)
  for (const t of ['depth 70%', 'Depth: 70 %', 'depth=70%', 'DEPTH 0.7'])
    assert.deepEqual(parseTag(t), [{ kind: 'depth', value: 70 }], t)
  assert.deepEqual(parseTag('move 60, 70%'), [{ kind: 'speed', value: 60 }, { kind: 'depth', value: 70 }])
  assert.deepEqual(parseTag('move speed 60 depth 70'), [{ kind: 'speed', value: 60 }, { kind: 'depth', value: 70 }])
  assert.deepEqual(parseTag('speed 60 depth 70'), [{ kind: 'speed', value: 60 }, { kind: 'depth', value: 70 }])
  assert.deepEqual(parseTag('position: 30'), [{ kind: 'pos', value: 30 }])
  assert.deepEqual(parseTag('speed +10'), [{ kind: 'speed', value: 10, rel: true }])
  assert.deepEqual(parseTag('speed fast'), [{ kind: 'speed', value: 0.8, frac: true }])
  assert.deepEqual(parseTag('Stop'), [{ kind: 'stop' }])
})

test('parseTag: not a movement tag', () => {
  for (const t of ['laughing', 'рычит', 'excited', 'speed', 'speed banana', 'move', 'stop right now please', ''])
    assert.equal(parseTag(t), null, t)
})

test('extractTags: strips movement and emotion tags, keeps sound tags for the voice only', () => {
  const ex = extractTags('[speed 60] Come here [laughing], now. [excited]')
  assert.deepEqual(ex.moves, [{ kind: 'speed', value: 60 }])
  assert.match(ex.speech, /\[laughing\]/)
  assert.doesNotMatch(ex.speech, /speed|excited/)
  assert.doesNotMatch(ex.text, /\[/)
  assert.deepEqual(ex.chips.map(c => c.kind), ['move', 'sound', 'emotion'])
})

test('extractTags: Russian sound tags pass through, movement tags apply, botched moves are dropped', () => {
  const ex = extractTags('[рычит] Иди сюда [speed 80] [speed fast-ish] [шепчет] быстрее [pos 1o]')
  assert.deepEqual(ex.moves, [{ kind: 'speed', value: 80 }])
  assert.match(ex.speech, /\[рычит\].*\[шепчет\]/)
  assert.doesNotMatch(ex.speech, /speed|pos/)
  assert.doesNotMatch(ex.text, /рычит|шепчет|\[/)
  assert.deepEqual(ex.chips.map(c => `${c.kind}:${c.label}`), ['sound:рычит', 'move:speed 80', 'unknown:speed fast-ish', 'sound:шепчет', 'unknown:pos 1o'])
})

test('extractTags: a dangling tag at the end is dropped', () => {
  assert.equal(extractTags('Faster [spe').speech.trim(), 'Faster')
})

test('applyMoves: clamps to the limits', () => {
  let r = applyMoves(base, [{ kind: 'speed', value: 200 }, { kind: 'depth', value: 5 }], lim)
  assert.equal(r.state.spm, 80)
  assert.equal(r.state.depth, 20)
  r = applyMoves(base, [{ kind: 'depth', value: 100 }, { kind: 'pos', value: 140 }], lim)
  assert.equal(r.state.depth, 90)
  assert.equal(r.state.pos, 100)
  r = applyMoves(base, [{ kind: 'speed', value: -100, rel: true }], lim)
  assert.equal(r.state.spm, 0)
  r = applyMoves(base, [{ kind: 'speed', value: 1, frac: true }], lim)
  assert.equal(r.state.spm, 80)
})

test('applyMoves: stop, edge, end flags', () => {
  let r = applyMoves(base, [{ kind: 'stop' }], lim)
  assert.equal(r.state.spm, 0)
  r = applyMoves(base, [{ kind: 'edge' }], lim)
  assert.ok(r.edge)
  assert.equal(r.state.spm, 40, 'edge keeps the speed to come back to')
  r = applyMoves(base, [{ kind: 'edge' }, { kind: 'speed', value: 50 }], lim)
  assert.ok(!r.edge, 'a later speed cancels the edge')
  r = applyMoves(base, [{ kind: 'stop' }, { kind: 'end' }], lim)
  assert.ok(r.end)
})

test('[more N] asks for a longer session, whatever the spelling', () => {
  assert.deepEqual(parseTag('more 10'), [{ kind: 'more', minutes: 10 }])
  assert.deepEqual(parseTag('extend: 15 min'), [{ kind: 'more', minutes: 15 }])
  assert.deepEqual(parseTag('more'), [{ kind: 'more', minutes: 10 }])
  assert.deepEqual(parseTag('more 500'), [{ kind: 'more', minutes: 60 }])
  const r = applyMoves({ spm: 60, depth: 60, pos: 50, shape: 'sine' }, [{ kind: 'more', minutes: 10 }, { kind: 'end' }], { maxSpm: 150, minDepth: 20, maxDepth: 100 })
  assert.equal(r.moreMin, 10)
})
