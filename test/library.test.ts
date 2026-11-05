import type { LibraryVideo } from '../src/types.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { libraryOverview, parseQuery, resolveQuery } from '../src/library.ts'

const v = (id: string, o: Partial<LibraryVideo> = {}): LibraryVideo => ({
  id: `${id}.mp4`, title: id, path: `Lib/${id}.mp4`, durationS: 600, hasScript: true, starred: false,
  intensity: { band: 'medium', meanSpm: 80, meanSpeed: 1, peakSpeed: 2 }, playlists: [], plays: 0, finishes: 0, watchedMin: 0, lastPlayedAt: null, ...o,
})
const lib = [
  v('Soft Sunday', { intensity: { band: 'gentle', meanSpm: 40, meanSpeed: 0.4, peakSpeed: 1 } }),
  v('[Maplestar] Rias Fast', { intensity: { band: 'intense', meanSpm: 170, meanSpeed: 3, peakSpeed: 5 } }),
  v('[Maplestar] Other', { intensity: { band: 'gentle', meanSpm: 50, meanSpeed: 0.5, peakSpeed: 1 } }),
  v('Old Favourite', { finishes: 4, plays: 9, starred: true }),
  v('No Script', { hasScript: false }),
  ...Array.from({ length: 200 }, (_, i) => v(`Filler ${i}`, { plays: 3 })),
]
const pick = (q: string, played = new Set<string>()) => {
  const r = resolveQuery(lib, parseQuery(q), played, () => 0)
  return 'video' in r ? r.video.title : `none: ${r.reason}`
}

test('parses what kind of video she asks for', () => {
  assert.deepEqual(parseQuery('something new and gentle'), { band: 'gentle', fav: false, fresh: true, length: null, words: [], raw: 'something new and gentle' })
  assert.deepEqual(parseQuery('maplestar intense').words, ['maplestar'])
  assert.equal(parseQuery('came').fav, true)
})

test('finds by intensity, favourites, novelty and words, in a big library', () => {
  assert.equal(pick('intense'), '[Maplestar] Rias Fast')
  assert.equal(pick('came'), 'Old Favourite')
  assert.equal(pick('maplestar gentle'), '[Maplestar] Other')
  assert.equal(pick('rias'), '[Maplestar] Rias Fast')
  assert.match(pick('new gentle'), /Soft Sunday|\[Maplestar\] Other/)
})

test('never repeats in a session, and says why when nothing fits', () => {
  assert.notEqual(pick('intense', new Set(['[Maplestar] Rias Fast.mp4'])), '[Maplestar] Rias Fast')
  assert.match(pick('zzzz nothing'), /^none: nothing in the library matches/)
  assert.ok(!pick('').startsWith('none'))
})

test('the overview stays small however big the library', () => {
  const o = libraryOverview(lib)
  assert.match(o, /^204 scripted videos: 2 gentle, 201 medium, 1 intense/)
  assert.ok(o.length < 1200)
})

test('a few-second clip only wins when short is asked for', () => {
  const lib2 = [
    v('Quick Clip', { durationS: 12, intensity: { band: 'intense', meanSpm: 180, meanSpeed: 3, peakSpeed: 5 } }),
    v('Full Scene', { durationS: 600, intensity: { band: 'intense', meanSpm: 150, meanSpeed: 2.6, peakSpeed: 4 } }),
  ]
  const pick2 = (q: string) => {
    const r = resolveQuery(lib2, parseQuery(q), new Set(), () => 0)
    return 'video' in r ? r.video.title : 'none'
  }
  assert.equal(pick2('intense'), 'Full Scene')
  assert.equal(pick2('short intense'), 'Quick Clip')
})
