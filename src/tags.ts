/**
 * Movement and emotion tags in the model's replies.
 *
 *   [speed 60]          strokes per minute (0 = still); also +10 / -10, slow|medium|fast|max
 *   [depth 70]          stroke length, % of the range; also +10 / -10, short|half|long|full
 *   [pos low|mid|high]  where the stroke sits (or 0-100)
 *   [shape sine|ease|pulse|saw|sharp]
 *   [move 60 70]        speed and depth together (a third number is pos)
 *   [stop]              hold still
 *   [edge]              a sudden stop, then a hold; the speed comes back by itself
 *   [end]               end the session after this reply
 *
 * Parsing is tolerant: case, extra spaces, ':' or '=', a '%' sign, commas,
 * and several pairs in one tag ([speed 60 depth 70]) all work.
 */

export type Shape = 'sine' | 'ease' | 'pulse' | 'saw' | 'sharp'

export type Move
  = | { kind: 'speed', value: number, rel?: boolean, frac?: boolean }
    | { kind: 'depth', value: number, rel?: boolean }
    | { kind: 'pos', value: number }
    | { kind: 'shape', value: Shape }
    | { kind: 'stop' }
    | { kind: 'edge' }
    | { kind: 'end' }
    | { kind: 'more', minutes: number }
    | { kind: 'play', query: string }

export const EMOTIONS = ['neutral', 'angry', 'sad', 'excited'] as const
export const EMOTION_ALIASES: Record<string, string> = { happy: 'excited', joy: 'excited', mad: 'angry', annoyed: 'angry', calm: 'neutral' }
export const EMOTION_NAMES = [...EMOTIONS, ...Object.keys(EMOTION_ALIASES)]

/** The emotion a tag names, or null. */
export function emotionOf(inner: string): string | null {
  const t = inner.trim().toLowerCase()
  if ((EMOTIONS as readonly string[]).includes(t))
    return t
  return EMOTION_ALIASES[t] ?? null
}

const HEADS: Record<string, string> = {
  speed: 'speed', spm: 'speed', tempo: 'speed', pace: 'speed', rate: 'speed',
  depth: 'depth', length: 'depth', stroke: 'depth', range: 'depth', len: 'depth',
  pos: 'pos', position: 'pos', center: 'pos', centre: 'pos', zone: 'pos', at: 'pos',
  shape: 'shape', style: 'shape', wave: 'shape', pattern: 'shape',
  move: 'move', motion: 'move', set: 'move',
  stop: 'stop', hold: 'stop', still: 'stop', pause: 'stop', freeze: 'stop',
  edge: 'edge', edging: 'edge',
  end: 'end',
  more: 'more', extend: 'more', longer: 'more', prolong: 'more',
  play: 'play', video: 'play', pick: 'play',
}
const SPEED_WORDS: Record<string, number> = { still: 0, off: 0, slow: 0.3, slower: -1, medium: 0.55, mid: 0.55, normal: 0.55, fast: 0.8, faster: -2, max: 1, full: 1, top: 1 }
const DEPTH_WORDS: Record<string, number> = { short: 35, shallow: 35, half: 50, mid: 50, medium: 50, long: 80, deep: 85, full: 100, max: 100 }
const POS_WORDS: Record<string, number> = { low: 25, bottom: 20, base: 25, mid: 50, middle: 50, center: 50, centre: 50, high: 75, top: 80, tip: 80 }
const SHAPE_WORDS: Record<string, Shape> = { sine: 'sine', smooth: 'sine', wave: 'sine', ease: 'ease', soft: 'ease', linger: 'ease', pulse: 'pulse', beat: 'pulse', saw: 'saw', sawtooth: 'saw', pound: 'saw', thrust: 'saw', sharp: 'sharp', triangle: 'sharp', hard: 'sharp', jerky: 'sharp' }

const NUM_RE = /^[+-]?\d+(?:\.\d+)?$/

/**
 * The moves a tag's inside (the text between the brackets) asks for, or null
 * when it isn't a movement tag.
 */
export function parseTag(inner: string): Move[] | null {
  const norm = inner
    .toLowerCase()
    .replace(/[%:=,;/]/g, ' ')
    // "speed60" -> "speed 60"
    .replace(/([a-z])(?=[+\-\d])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!norm)
    return null
  const tokens = norm.split(' ')
  const head = HEADS[tokens[0]]
  if (!head)
    return null
  if (head === 'stop' || head === 'edge' || head === 'end')
    return tokens.length <= 2 ? [{ kind: head }] : null
  if (head === 'play') {
    // [play intense], [play came], [play rias new]: what kind, not which one.
    const query = tokens.slice(1).join(' ')
    return [{ kind: 'play', query }]
  }
  if (head === 'more') {
    // [more 10], [more 10 min]; a bare [more] is ten minutes.
    const n = tokens[1] === undefined ? 10 : Number(tokens[1])
    if (!Number.isFinite(n) || tokens.length > 3)
      return null
    return [{ kind: 'more', minutes: Math.round(clamp(n, 1, 60)) }]
  }

  const out: Move[] = []
  // positional values after "move": speed, depth, pos
  const order = ['speed', 'depth', 'pos']
  let positional = 0
  let current: string | null = head === 'move' ? null : head
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]
    const named = HEADS[tok]
    if (named && named !== 'move' && !(current && valueOf(current, tok))) {
      current = named
      continue
    }
    const key = current ?? order[positional++]
    if (!key)
      return null
    const m = valueOf(key, tok)
    if (!m)
      return null
    out.push(m)
    current = null
  }
  return out.length ? out : null
}

function valueOf(key: string, tok: string): Move | null {
  const isNum = NUM_RE.test(tok)
  const n = Number(tok)
  const rel = /^[+-]/.test(tok)
  switch (key) {
    case 'speed':
      if (isNum)
        return rel ? { kind: 'speed', value: n, rel: true } : { kind: 'speed', value: n }
      if (tok in SPEED_WORDS) {
        const w = SPEED_WORDS[tok]
        if (w === -1)
          return { kind: 'speed', value: -10, rel: true }
        if (w === -2)
          return { kind: 'speed', value: 10, rel: true }
        return { kind: 'speed', value: w, frac: true }
      }
      return null
    case 'depth':
      if (isNum) {
        if (rel)
          return { kind: 'depth', value: n, rel: true }
        // 0.7 means 70 %
        return { kind: 'depth', value: n > 0 && n <= 1 && tok.includes('.') ? n * 100 : n }
      }
      return tok in DEPTH_WORDS ? { kind: 'depth', value: DEPTH_WORDS[tok] } : null
    case 'pos':
      if (isNum && !rel)
        return { kind: 'pos', value: n > 0 && n <= 1 && tok.includes('.') ? n * 100 : n }
      return tok in POS_WORDS ? { kind: 'pos', value: POS_WORDS[tok] } : null
    case 'shape':
      return tok in SHAPE_WORDS ? { kind: 'shape', value: SHAPE_WORDS[tok] } : null
  }
  return null
}

/** Sound tags named in the instructions. Any other non-movement tag passes through to the voice too ([смеётся] etc.). */
export const SOUND_TAGS = ['laughing', 'giggling', 'chuckling', 'sigh', 'moaning', 'panting', 'gasping', 'whispering', 'breathing heavily']

/** Words that start a movement or control tag: a tag that starts with one and doesn't parse is a botched move, not a sound. */
const CONTROL_WORDS = new Set([...Object.keys(HEADS), 'skip'])

/** Every bracketed tag in a piece of text, in order. */
export const TAG_RE = /\[([^[\]\n]{0,80})\]/g

export interface Extracted {
  /** What the voice gets: movement, emotion and botched tags removed; sound tags kept in place. */
  speech: string
  /** What the log shows: every tag removed. */
  text: string
  moves: Move[]
  /** Labels for the log: one per tag, as normalised text. */
  chips: { label: string, kind: 'move' | 'emotion' | 'sound' | 'unknown' }[]
}

/**
 * Pull the tags out of one sentence. Movement and emotion tags are taken
 * out; a tag that starts like a movement tag but doesn't parse is dropped
 * (it would be read out otherwise); any other tag is a sound for the voice
 * ([laughing], [рычит]) and stays where it is in the speech.
 */
export function extractTags(raw: string): Extracted {
  const moves: Move[] = []
  const chips: Extracted['chips'] = []
  const speech = raw.replace(TAG_RE, (whole, inner: string) => {
    const m = parseTag(inner)
    if (m) {
      moves.push(...m)
      chips.push({ label: inner.trim().toLowerCase().replace(/\s+/g, ' '), kind: 'move' })
      return ' '
    }
    const emo = emotionOf(inner)
    if (emo) {
      chips.push({ label: emo, kind: 'emotion' })
      return ' '
    }
    const t = inner.trim()
    if (!t)
      return ' '
    const first = t.toLowerCase().split(/[\s:=]+/)[0].replace(/\d.*$/, '')
    if (CONTROL_WORDS.has(first) || /\d/.test(t)) {
      chips.push({ label: t, kind: 'unknown' })
      return ' '
    }
    chips.push({ label: t, kind: 'sound' })
    return ` [${t}] `
  }).replace(/\[[^\]]*$/, ' ')
  return { speech, text: speech.replace(TAG_RE, ' '), moves, chips }
}

// ─── Applying moves ─────────────────────────────────────────────────────────

export interface MotionState {
  /** strokes per minute */
  spm: number
  /** % of the range */
  depth: number
  /** % from the bottom */
  pos: number
  shape: Shape
}

export interface Limits {
  /** The fastest the AI may ask for (already min'd with the app's ceiling). */
  maxSpm: number
  minDepth: number
  maxDepth: number
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface Applied {
  state: MotionState
  /** Something changed that has to go to the device. */
  changed: boolean
  stop: boolean
  edge: boolean
  end: boolean
  /** Minutes the session is to be made longer by. */
  moreMin: number
  /** What kind of video to put on, or null. */
  play: string | null
  /** A movement tag that should cancel a running edge hold. */
  moved: boolean
}

/** The motion after a list of moves, clamped to the user's limits. */
export function applyMoves(prev: MotionState, moves: Move[], limits: Limits): Applied {
  const s = { ...prev }
  const r: Applied = { state: s, changed: false, stop: false, edge: false, end: false, moreMin: 0, play: null, moved: false }
  const lo = Math.min(limits.minDepth, limits.maxDepth)
  const hi = Math.max(limits.minDepth, limits.maxDepth)
  for (const m of moves) {
    switch (m.kind) {
      case 'speed': {
        const v = m.frac ? m.value * limits.maxSpm : m.rel ? s.spm + m.value : m.value
        s.spm = Math.round(clamp(v, 0, Math.max(0, limits.maxSpm)))
        r.moved = r.changed = true
        r.stop = false
        r.edge = false
        break
      }
      case 'depth':
        s.depth = Math.round(clamp(m.rel ? s.depth + m.value : m.value, lo, hi))
        r.moved = r.changed = true
        break
      case 'pos':
        s.pos = Math.round(clamp(m.value, 0, 100))
        r.moved = r.changed = true
        break
      case 'shape':
        s.shape = m.value
        r.changed = true
        break
      case 'stop':
        s.spm = 0
        r.moved = r.changed = r.stop = true
        r.edge = false
        break
      case 'edge':
        r.edge = true
        r.changed = true
        break
      case 'end':
        r.end = true
        break
      case 'more':
        r.moreMin += m.minutes
        break
      case 'play':
        r.play = m.query
        break
    }
  }
  return r
}
