import type { FetchFn } from './brain'
import type { LocalModelId } from './stt-local'
import { toPcm16k, toWav16k } from './mic'
import * as local from './stt-local'

/**
 * Speech recognition for push-to-talk:
 *   venice       Venice's OpenAI-compatible endpoint (the default: the Venice key is already there)
 *   fish         Fish Audio's POST /v1/asr (needs paid credit)
 *   local        whisper on this PC, in the app (stt-local.ts)
 *   openai       any OpenAI-compatible POST {url}/audio/transcriptions (Groq, OpenAI…)
 *   voiceserver  a whisper-asr-webservice style POST /asr (e.g. whisper-asr-webservice)
 */
export type SttEngine = 'venice' | 'fish' | 'local' | 'openai' | 'voiceserver' | 'off'

export type SttCfg
  = | { kind: 'fish', key: string }
    | { kind: 'local', model: LocalModelId }
    | { kind: 'openai', url: string, key: string, model: string }
    | { kind: 'voiceserver', url: string, token: string }

const FISH_ASR = 'https://api.fish.audio/v1/asr'
const FISH_ASR_MODEL = 'transcribe-1-pro'

const wavBlob = (wav: Uint8Array) => new Blob([wav as BlobPart], { type: 'audio/wav' })
const trimUrl = (u: string) => u.trim().replace(/\/+$/, '')
const isoLang = (language: string) => (language && language !== 'auto' ? language.slice(0, 2).toLowerCase() : '')

/** The text, tidied: no speaker markers, no doubled spaces. */
export function cleanTranscript(text: string): string {
  return text.replace(/<\|[^|]*\|>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function fail(res: Response, what: string): Promise<never> {
  if (res.status === 401 || res.status === 403)
    throw new Error(`${what} refused the key`)
  let msg = (await res.text().catch(() => '')).slice(0, 200)
  try {
    msg = JSON.parse(msg).message ?? msg
  }
  catch {}
  throw new Error(`${what}: ${res.status} ${msg}`)
}

/** One push-to-talk clip (as recorded) to text. '' when nothing was said. */
export async function transcribe(fetchFn: FetchFn, c: SttCfg, clip: Blob, ac: BaseAudioContext, language: string, signal?: AbortSignal): Promise<string> {
  const lang = isoLang(language)

  if (c.kind === 'local')
    return cleanTranscript(await local.transcribe(c.model, await toPcm16k(clip, ac), lang, signal))

  if (c.kind === 'fish') {
    if (!c.key)
      throw new Error('no Fish Audio key for speech recognition')
    // Fish takes the recording as it is (WebM/Opus), no conversion.
    const form = new FormData()
    form.append('audio', clip, 'utterance.webm')
    if (lang)
      form.append('language', lang)
    form.append('ignore_timestamps', 'true')
    form.append('tag_audio_events', 'false')
    form.append('diarize', 'false')
    let res: Response | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetchFn(FISH_ASR, { method: 'POST', headers: { Authorization: `Bearer ${c.key}`, model: FISH_ASR_MODEL }, body: form, signal })
      if (res.status !== 429 && res.status < 500)
        break
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
    }
    if (!res!.ok)
      await fail(res!, 'Fish speech recognition')
    return cleanTranscript(String((await res!.json())?.text ?? ''))
  }

  const wav = await toWav16k(clip, ac)
  let res: Response
  if (c.kind === 'voiceserver') {
    if (!c.url.trim())
      throw new Error('no voice server URL set')
    const form = new FormData()
    form.append('audio_file', wavBlob(wav), 'utterance.wav')
    const q = new URLSearchParams({ task: 'transcribe', output: 'json', vad_filter: 'true' })
    if (lang)
      q.set('language', lang)
    res = await fetchFn(`${trimUrl(c.url)}/asr?${q}`, { method: 'POST', headers: c.token ? { Authorization: `Bearer ${c.token}` } : {}, body: form, signal })
  }
  else {
    if (!c.url.trim())
      throw new Error('no speech recognition URL set')
    const form = new FormData()
    form.append('file', wavBlob(wav), 'utterance.wav')
    form.append('model', c.model || 'whisper-large-v3-turbo')
    form.append('response_format', 'json')
    form.append('temperature', '0')
    if (lang)
      form.append('language', lang)
    res = await fetchFn(`${trimUrl(c.url)}/audio/transcriptions`, { method: 'POST', headers: c.key ? { Authorization: `Bearer ${c.key}` } : {}, body: form, signal })
  }
  if (!res.ok)
    await fail(res, 'Speech recognition')
  return cleanTranscript(String((await res.json())?.text ?? ''))
}
