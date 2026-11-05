import type { LibraryVideo } from './types'

/**
 * Picking videos from a library of any size. She never sees the whole list
 * (thousands of titles won't fit, and wouldn't help): she asks for a kind of
 * video with [play …] (how hard, a favourite, something new, words from the
 * title), and this finds the best few matches and picks one of them. What she
 * does see is a small overview of the library, the same size however big it is.
 */

const BAND_WORDS: Record<string, 'gentle' | 'medium' | 'intense'> = {
  gentle: 'gentle', soft: 'gentle', slow: 'gentle', easy: 'gentle', calm: 'gentle', light: 'gentle', warmup: 'gentle',
  medium: 'medium', mid: 'medium', moderate: 'medium', normal: 'medium',
  intense: 'intense', hard: 'intense', fast: 'intense', rough: 'intense', wild: 'intense', heavy: 'intense', extreme: 'intense',
}
const FAV_WORDS = new Set(['came', 'favorite', 'favourite', 'fave', 'fav', 'best', 'loved', 'starred', 'star', 'top', 'again', 'proven'])
const NEW_WORDS = new Set(['new', 'unplayed', 'fresh', 'unseen', 'different', 'novel'])
const LENGTH_WORDS: Record<string, 'short' | 'long'> = { short: 'short', quick: 'short', brief: 'short', long: 'long', lengthy: 'long' }
const FILLER = new Set(['something', 'some', 'a', 'an', 'the', 'one', 'video', 'with', 'of', 'and', 'by', 'from', 'more', 'any', 'anything', 'please', 'random', 'kind', 'like'])

export interface PlayQuery {
  band: 'gentle' | 'medium' | 'intense' | null
  fav: boolean
  fresh: boolean
  length: 'short' | 'long' | null
  /** Words to find in the title, path or playlists. */
  words: string[]
  raw: string
}

export function parseQuery(raw: string): PlayQuery {
  const q: PlayQuery = { band: null, fav: false, fresh: false, length: null, words: [], raw: raw.trim() }
  for (const t of raw.toLowerCase().split(/[\s,;]+/).filter(Boolean)) {
    if (BAND_WORDS[t])
      q.band = BAND_WORDS[t]
    else if (FAV_WORDS.has(t))
      q.fav = true
    else if (NEW_WORDS.has(t))
      q.fresh = true
    else if (LENGTH_WORDS[t])
      q.length = LENGTH_WORDS[t]
    else if (!FILLER.has(t) && t.length > 1)
      q.words.push(t)
  }
  return q
}

/** Under this, a video is a clip: it ends almost as soon as it starts. */
export const SHORT_CLIP_S = 45

const haystack = (v: LibraryVideo) => `${v.title} ${v.path} ${v.playlists.join(' ')}`.toLowerCase()
const love = (v: LibraryVideo) => v.finishes * 4 + (v.starred ? 3 : 0) + Math.min(5, v.plays) * 0.5

/**
 * The video for a query, or null with the reason. Among the best matches it
 * picks at random (weighted to the top), so the same ask doesn't always give
 * the same video. `exclude`: played this session.
 */
export function resolveQuery(all: LibraryVideo[], q: PlayQuery, exclude: Set<string>, rnd = Math.random): { video: LibraryVideo } | { reason: string } {
  let pool = all.filter(v => v.hasScript && !exclude.has(v.id))
  if (!pool.length)
    return { reason: exclude.size ? 'every scripted video was already played this session' : 'there are no scripted videos in the library' }
  if (q.words.length) {
    const hit = pool.filter(v => q.words.every(w => haystack(v).includes(w)))
    // All words, else any word, else nothing to go on.
    pool = hit.length ? hit : pool.filter(v => q.words.some(w => haystack(v).includes(w)))
    if (!pool.length)
      return { reason: `nothing in the library matches "${q.words.join(' ')}"` }
  }
  const scored = pool.map((v) => {
    let s = rnd() * 2
    if (q.band)
      s += v.intensity ? (v.intensity.band === q.band ? 10 : q.band === 'medium' || v.intensity.band === 'medium' ? 2 : -6) : -1
    if (q.fav)
      s += love(v) * 2 - (v.finishes || v.starred ? 0 : 6)
    if (q.fresh)
      s += v.plays ? -8 : 6
    // A clip of a few seconds is over before she's said a line: only when asked.
    if (q.length !== 'short' && v.durationS && v.durationS < SHORT_CLIP_S)
      s -= 5
    if (q.length && v.durationS)
      s += q.length === 'short' ? (v.durationS < 300 ? 4 : v.durationS > 900 ? -4 : 0) : (v.durationS > 900 ? 4 : v.durationS < 300 ? -4 : 0)
    if (!q.band && !q.fav && !q.fresh && !q.length && !q.words.length)
      s += love(v) * 0.5
    return { v, s }
  }).sort((a, b) => b.s - a.s)
  // One of the best few, the top ones likelier.
  const top = scored.slice(0, Math.min(5, scored.length))
  const pick = top[Math.min(top.length - 1, Math.floor(rnd() ** 1.6 * top.length))]
  return { video: pick.v }
}

const mmss = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '?')

/** What she knows about the library up front: its size and shape, not its contents. */
export function libraryOverview(all: LibraryVideo[]): string {
  const scripted = all.filter(v => v.hasScript)
  const bands = { gentle: 0, medium: 0, intense: 0 }
  let unknown = 0
  for (const v of scripted) {
    if (v.intensity)
      bands[v.intensity.band]++
    else
      unknown++
  }
  const lists = new Map<string, number>()
  for (const v of scripted) {
    for (const p of v.playlists)
      lists.set(p, (lists.get(p) ?? 0) + 1)
  }
  const favs = [...scripted].filter(v => v.finishes || v.starred).sort((a, b) => love(b) - love(a)).slice(0, 8)
  const lines = [
    `${scripted.length} scripted videos: ${bands.gentle} gentle, ${bands.medium} medium, ${bands.intense} intense${unknown ? `, ${unknown} not measured yet` : ''}.`,
  ]
  if (lists.size)
    lines.push(`His playlists: ${[...lists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, c]) => `"${n}" (${c})`).join(', ')}.`)
  if (favs.length)
    lines.push(`His favourites:\n${favs.map(v => `- "${v.title}" (${mmss(v.durationS)}${v.intensity ? `, ${v.intensity.band}` : ''}${v.finishes ? `, he came to it ${v.finishes}×` : ''}${v.starred ? ', starred' : ''})`).join('\n')}`)
  return lines.join('\n')
}
