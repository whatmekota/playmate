import type { Extracted, Move } from './tags'
import { EMOTION_NAMES, emotionOf, extractTags } from './tags'

/**
 * Streamed reply text -> sentences, each with the emotion in force and the
 * movement tags it carries.
 *
 * A sentence ends at terminal punctuation followed by whitespace, or where an
 * emotion tag starts. Punctuation inside [brackets] doesn't count, and a tag
 * still arriving ("[spe" ... "ed 60]") holds the split until it closes. Very
 * short sentences are held and glued to the next one: TTS rushes one-word
 * generations. A sentence with tags and no words still goes out (silent), so
 * its moves apply in their place in the reply.
 */

export interface Sentence {
  /** What the log shows (no tags at all); '' for a tags-only item. */
  text: string
  /** What the voice gets: sound tags ([sigh], [смеётся]) kept in place; '' for a silent item. */
  speech: string
  emotion: string
  moves: Move[]
  chips: Extracted['chips']
}

const EMO = EMOTION_NAMES.join('|')
const EMO_START_RE = new RegExp(`^\\s*\\[\\s*(${EMO})\\s*\\]\\s*`, 'i')
export const SENTENCE_END_RE = new RegExp(`[.!?…]+["»”')]*\\s+|\\s*(?=\\[\\s*(?:${EMO})\\s*\\])`, 'gi')
/** An open bracket further back than this is a literal '[', not a tag on its way. */
const MAX_TAG = 80
const SHORT = 12
const WORDY = /[\p{L}\p{N}]/u

export function cleanSpoken(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, ' ') // *laughs*
    .replace(/\([^)]*\)/g, ' ') // (stage directions)
    .replace(/[\p{Extended_Pictographic}‍️]/gu, '')
    .replace(/[#_`~>|*]/g, '')
    // Whole tags stay (sound tags); a lone bracket is a stray.
    .replace(/\[[^[\]\n]{1,80}\]|[[\]]/g, m => (m.length > 1 ? m : ''))
    .replace(/\s+([,.!?…])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Where position i sits: outside brackets, inside a closed [..], or after an unclosed '['. */
function bracketAt(buf: string, i: number): 'out' | 'closed' | 'open' {
  const open = buf.lastIndexOf('[', i - 1)
  if (open < 0)
    return 'out'
  const close = buf.lastIndexOf(']', i - 1)
  if (close > open)
    return 'out'
  const closeAfter = buf.indexOf(']', open)
  if (closeAfter >= 0 && !buf.slice(open + 1, closeAfter).includes('['))
    return closeAfter - open <= MAX_TAG + 1 ? 'closed' : 'out'
  return buf.length - open <= MAX_TAG ? 'open' : 'out'
}

export class SentenceSplitter {
  private buf = ''
  private held: Sentence | null = null
  emotion: string

  constructor(private emit: (s: Sentence) => void, emotion = 'neutral') {
    this.emotion = emotion
  }

  push(text: string) {
    this.buf += text
    this.drain(false)
  }

  flush() {
    this.drain(true)
  }

  private drain(final: boolean) {
    for (;;) {
      const tag = EMO_START_RE.exec(this.buf)
      if (tag) {
        this.emotion = emotionOf(tag[1]) ?? this.emotion
        this.buf = this.buf.slice(tag[0].length)
        continue
      }
      const end = this.findEnd()
      if (end === null)
        break
      this.out(this.buf.slice(0, end))
      this.buf = this.buf.slice(end)
    }
    if (final) {
      this.out(this.buf)
      this.buf = ''
      if (this.held) {
        this.emit(this.held)
        this.held = null
      }
    }
  }

  /** Index just past the first complete sentence, or null to wait for more. */
  private findEnd(): number | null {
    SENTENCE_END_RE.lastIndex = 0
    for (let m = SENTENCE_END_RE.exec(this.buf); m; m = SENTENCE_END_RE.exec(this.buf)) {
      const stop = m.index + m[0].length
      if (m[0].length === 0)
        SENTENCE_END_RE.lastIndex++
      if (stop === 0)
        continue
      const where = bracketAt(this.buf, m.index)
      if (where === 'closed')
        continue
      // A tag still arriving: wait (on the final flush, out() drops the stub).
      if (where === 'open')
        return null
      return stop
    }
    return null
  }

  private out(raw: string) {
    const ex = extractTags(raw)
    const speech = cleanSpoken(ex.speech)
    const text = cleanSpoken(ex.text)
    const voiced = WORDY.test(speech)
    if (!voiced && !ex.moves.length)
      return
    const s: Sentence = {
      text: WORDY.test(text) ? text : '',
      speech: voiced ? speech : '',
      emotion: this.emotion,
      moves: ex.moves,
      chips: ex.chips.filter(c => c.kind !== 'emotion'),
    }
    if (!voiced) {
      // Silent moves: keep their place after whatever is held.
      if (this.held) {
        this.emit(this.held)
        this.held = null
      }
      this.emit(s)
      return
    }
    if (this.held) {
      const h = this.held
      this.held = null
      const join = (x: string, y: string) => (x && y ? `${x} ${y}` : x || y)
      this.emit({ text: join(h.text, s.text), speech: join(h.speech, s.speech), emotion: h.emotion, moves: [...h.moves, ...s.moves], chips: [...h.chips, ...s.chips] })
    }
    else if (speech.length < SHORT) {
      this.held = s
    }
    else {
      this.emit(s)
    }
  }
}
