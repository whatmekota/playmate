import type { FetchFn } from './brain'

/**
 * Fish Audio, called directly (docs.fish.audio):
 *   POST /v1/tts      Bearer key, header `model`, JSON body -> streamed audio;
 *                     with format "pcm" it is raw s16le mono at sample_rate.
 *   GET  /model       the public voice library (title search, sort_by score).
 *   GET  /model/{id}  one voice.
 * Voices are public library models only, picked by id. Emotion is an inline
 * [tag] at the start of the text, which S2 models perform; so are sound tags
 * like [laughing] or [sigh] left in place.
 */

export const FISH_API = 'https://api.fish.audio'
export const FISH_MODELS = ['s2.1-pro-free', 's2.1-pro', 's2-pro', 's1', 'drama-3']
export const SAMPLE_RATE = 24000
/** The free model streams at about real time: gather this much before playing (1.2 s still ran dry now and then). */
export const PREBUFFER_S = 1.5
const RETRY = new Set([429, 500, 502, 503, 504])
const FIRST_AUDIO_MS = 15_000

export interface FishCfg { key: string, model: string }

export interface TtsStream {
  rate: number
  prebuffer: number
  reader: { read: () => Promise<{ done: boolean, value?: Uint8Array }> }
  abort: () => void
}

export interface TtsRequest { text: string, voice: string, emotion: string, language: string, speed: number }

const headers = (c: FishCfg): Record<string, string> => ({ Authorization: `Bearer ${c.key}` })

export function ttsBody(req: TtsRequest) {
  const text = req.emotion && req.emotion !== 'neutral' ? `[${req.emotion}] ${req.text}` : req.text
  return {
    text,
    reference_id: req.voice,
    format: 'pcm',
    sample_rate: SAMPLE_RATE,
    latency: 'balanced',
    normalize: true,
    ...(req.language && req.language !== 'auto' ? { language: req.language } : {}),
    ...(req.speed && req.speed !== 1 ? { prosody: { speed: req.speed } } : {}),
  }
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => {
    clearTimeout(t)
    resolve()
  }, { once: true })
})

/**
 * Start one sentence. Resolves once its first audio has arrived. A 429/5xx,
 * or a stall or drop before any audio came, is retried twice (nothing has
 * played yet, so nothing repeats); after the first audio, never.
 */
export async function synthesize(fetchFn: FetchFn, c: FishCfg, req: TtsRequest, outer?: AbortSignal): Promise<TtsStream> {
  const body = JSON.stringify(ttsBody(req))
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (outer?.aborted)
      break
    const ctrl = new AbortController()
    const onOuter = () => ctrl.abort()
    outer?.addEventListener('abort', onOuter, { once: true })
    let stalled = false
    const timer = setTimeout(() => {
      stalled = true
      ctrl.abort()
    }, FIRST_AUDIO_MS)
    try {
      const res = await fetchFn(`${FISH_API}/v1/tts`, {
        method: 'POST',
        headers: { ...headers(c), 'Content-Type': 'application/json', 'model': c.model || FISH_MODELS[0] },
        body,
        signal: ctrl.signal,
      })
      if (RETRY.has(res.status) && attempt < 2) {
        lastErr = new Error(`fish ${res.status}`)
        res.body?.cancel().catch(() => {})
        clearTimeout(timer)
        await sleep(500 * (attempt + 1), ctrl.signal)
        continue
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        let msg = t.slice(0, 200)
        try {
          msg = JSON.parse(t).message ?? msg
        }
        catch {}
        throw new Error(`fish ${res.status}${res.status === 401 ? ' (check the API key)' : res.status === 402 ? ' (out of credit)' : ''}: ${msg}`)
      }
      if (!res.body)
        throw new Error('fish: no audio')
      const reader = res.body.getReader()
      let first = await reader.read()
      while (!first.done && !first.value?.length)
        first = await reader.read()
      clearTimeout(timer)
      if (first.done) {
        // An empty answer: retry if we may, else a silent sentence.
        if (attempt < 2) {
          lastErr = new Error('fish: empty audio')
          continue
        }
      }
      let pending: { done: boolean, value?: Uint8Array } | null = first
      const stream: TtsStream = {
        rate: SAMPLE_RATE,
        prebuffer: PREBUFFER_S,
        reader: {
          read: async () => {
            if (pending) {
              const p = pending
              pending = null
              return p
            }
            return reader.read()
          },
        },
        abort: () => {
          ctrl.abort()
          reader.cancel().catch(() => {})
        },
      }
      return stream
    }
    catch (e) {
      clearTimeout(timer)
      if (outer?.aborted)
        break
      // A cancelled fetch can surface as a TypeError: the signal tells what happened.
      if ((stalled || (ctrl.signal.aborted === false && e instanceof TypeError)) && attempt < 2) {
        lastErr = e
        continue
      }
      throw stalled ? new Error('fish: no audio in time') : e
    }
    finally {
      outer?.removeEventListener('abort', onOuter)
    }
  }
  if (outer?.aborted)
    throw new DOMException('cancelled', 'AbortError')
  throw lastErr instanceof Error ? lastErr : new Error('fish: failed')
}

export interface FishVoice { id: string, title: string, languages: string[], likes: number, uses: number, author: string }

const toVoice = (m: any): FishVoice => ({
  id: String(m?._id ?? ''),
  title: String(m?.title ?? m?._id ?? ''),
  languages: Array.isArray(m?.languages) ? m.languages.map(String) : [],
  likes: Number(m?.like_count) || 0,
  uses: Number(m?.task_count) || 0,
  author: String(m?.author?.nickname ?? ''),
})

/** Search the public voice library. */
export async function searchVoices(fetchFn: FetchFn, c: FishCfg, query: string, opts: { language?: string, pageSize?: number } = {}): Promise<FishVoice[]> {
  if (!c.key)
    throw new Error('add your Fish Audio API key in Settings first')
  const q = new URLSearchParams({ page_size: String(opts.pageSize ?? 20), page_number: '1', sort_by: 'score' })
  if (query.trim())
    q.set('title', query.trim())
  if (opts.language && opts.language !== 'auto')
    q.set('language', opts.language)
  const res = await fetchFn(`${FISH_API}/model?${q}`, { headers: headers(c), signal: AbortSignal.timeout(15000) })
  if (res.status === 401)
    throw new Error('Fish Audio refused the API key')
  if (!res.ok)
    throw new Error(`voice search: ${res.status}`)
  const data = await res.json()
  return (Array.isArray(data?.items) ? data.items : [])
    .filter((m: any) => m && m._id && (m.visibility === undefined || m.visibility === 'public') && (m.type === undefined || m.type === 'tts'))
    .map(toVoice)
}

/** One voice by id; null if there is no such voice. Throws on a bad key or network trouble. */
export async function voiceInfo(fetchFn: FetchFn, c: FishCfg, id: string): Promise<FishVoice | null> {
  const res = await fetchFn(`${FISH_API}/model/${encodeURIComponent(id)}`, { headers: headers(c), signal: AbortSignal.timeout(8000) })
  if (res.status === 404 || res.status === 403)
    return null
  if (res.status === 401)
    throw new Error('Fish Audio refused the API key')
  if (!res.ok)
    throw new Error(`fish: ${res.status}`)
  return toVoice(await res.json())
}

/** A voice id from a pasted id or a fish.audio link (…/m/<id>), or null. */
export function parseVoiceId(input: string): string | null {
  const s = input.trim()
  if (!s)
    return null
  const url = /fish\.audio\/(?:[\w-]+\/)*m\/([\w-]{8,64})/i.exec(s)
  if (url)
    return url[1]
  return /^[\w-]{8,64}$/.test(s) ? s : null
}
