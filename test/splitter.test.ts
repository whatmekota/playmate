import type { Sentence } from '../src/splitter.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SentenceSplitter } from '../src/splitter.ts'

function run(chunks: string[]): Sentence[] {
  const out: Sentence[] = []
  const sp = new SentenceSplitter(s => out.push(s))
  for (const c of chunks) sp.push(c)
  sp.flush()
  return out
}
const charByChar = (s: string) => [...s]

const REPLY = '[excited] Hey you, I have been waiting. [speed 60] Let us go a bit faster now. [depth 70][pos high] Right at the tip, feel it? [edge] Stop. Hold still for me now.'

test('sentences carry their tags, however the stream is chunked', () => {
  const expected = run([REPLY])
  assert.deepEqual(expected.map(s => s.text), [
    'Hey you, I have been waiting.',
    'Let us go a bit faster now.',
    'Right at the tip, feel it?',
    'Stop. Hold still for me now.',
  ])
  assert.deepEqual(expected.map(s => s.moves.map(m => m.kind)), [[], ['speed'], ['depth', 'pos'], ['edge']])
  assert.equal(expected[0].emotion, 'excited')
  assert.deepEqual(run(charByChar(REPLY)), expected)
  assert.deepEqual(run(['[exc', 'ited] Hey you, I have been waiting. [spe', 'ed 6', '0] Let us go a bit faster now', '. [depth 7', '0][pos', ' high] Right at the tip, feel it? [ed', 'ge] Stop. Hold still for me now.']), expected)
})

test('punctuation inside a tag does not split; an open tag waits', () => {
  const out: Sentence[] = []
  const sp = new SentenceSplitter(s => out.push(s))
  sp.push('Slower now [depth 0.')
  assert.equal(out.length, 0, 'waits while the tag is open')
  sp.push('5] and deeper. Good.')
  sp.flush()
  assert.equal(out[0].text, 'Slower now and deeper.')
  assert.equal(out[1].text, 'Good.')
  assert.deepEqual(out[0].moves, [{ kind: 'depth', value: 50 }])
})

test('a tag before a sentence rides on it; a tags-only tail still goes out, silent', () => {
  let out = run(['That is enough talking for now. [stop] ', 'Good boy, you did so well today.'])
  assert.equal(out.length, 2)
  assert.deepEqual(out[1].moves, [{ kind: 'stop' }])
  out = run(['That is enough talking for now. [stop] [end]'])
  assert.equal(out.length, 2)
  assert.equal(out[1].speech, '')
  assert.deepEqual(out[1].moves, [{ kind: 'stop' }, { kind: 'end' }])
  out = run(['Right there, keep going. [edge][sad] Oh no, not yet, baby.'])
  assert.deepEqual(out.map(x => x.moves.map(m => m.kind)), [[], ['edge'], []])
  assert.equal(out[2].emotion, 'sad')
})

test('emotion tags split and switch the emotion', () => {
  const out = run(['I am so happy with you today. [sad] But it is late already.'])
  assert.deepEqual(out.map(s => s.emotion), ['neutral', 'sad'])
})

test('Russian reply: [рычит] goes to the voice, [speed 80] to the device', () => {
  const reply = '[рычит] Иди сюда, Хозяин, я жду. [speed 80] Быстрее давай, не дёргайся! [шепчет] Вот так, хороший.'
  for (const chunks of [[reply], charByChar(reply)]) {
    const out = run(chunks)
    assert.equal(out.length, 3)
    assert.equal(out[0].speech, '[рычит] Иди сюда, Хозяин, я жду.')
    assert.equal(out[0].text, 'Иди сюда, Хозяин, я жду.')
    assert.deepEqual(out[1].moves, [{ kind: 'speed', value: 80 }])
    assert.equal(out[1].speech, 'Быстрее давай, не дёргайся!')
    assert.equal(out[2].speech, '[шепчет] Вот так, хороший.')
    assert.equal(out[2].text, 'Вот так, хороший.')
    assert.deepEqual(out[0].chips, [{ label: 'рычит', kind: 'sound' }])
  }
})

test('short sentences are glued to the next, with their moves', () => {
  const out = run(['[speed 40] Yes! ', 'Now keep that pace for me, love.'])
  assert.equal(out.length, 1)
  assert.equal(out[0].text, 'Yes! Now keep that pace for me, love.')
  assert.deepEqual(out[0].moves, [{ kind: 'speed', value: 40 }])
})

test('stage directions and emojis are not spoken', () => {
  const out = run(['*leans in* Come closer (softly) 😘 my love, closer.'])
  assert.equal(out[0].speech, 'Come closer my love, closer.')
})
