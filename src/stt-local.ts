// Local speech-to-text: Whisper in the renderer through transformers.js
// (WebGPU when the machine has an adapter, else WASM on the CPU).
//
// "Installing" a model = downloading its files once into the Cache Storage
// bucket transformers.js itself reads ('transformers-cache', keyed by the hub
// URL), so the pipeline later loads offline. We download the files ourselves
// (abortable, one progress bar) instead of letting from_pretrained do it,
// because transformers.js 3.x has no AbortSignal for downloads.
//
// transformers.js is imported dynamically: esbuild inlines it into the single
// bundle but defers its evaluation, so plugin activation stays cheap.

import type * as TF from '@huggingface/transformers'

export type LocalModelId = 'whisper-small' | 'whisper-large-v3-turbo'

type Device = 'webgpu' | 'wasm'
/** Which dtype set this machine gets: GPU with shader-f16, GPU without, CPU. */
type Profile = 'gpu16' | 'gpu32' | 'cpu'
type DType = 'fp32' | 'fp16' | 'q8' | 'q4'

interface Variant { encoder: DType, decoder: DType }
interface ModelDef {
  repo: string
  label: string
  hint: string
  variants: Record<Profile, Variant>
}

/** Small non-ONNX files every whisper pipeline reads (~3 MB together). */
const BASE_FILES = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json']
const BASE_MB = 2.8

/** Real sizes (MB) of the ONNX files we use, from the HF tree API. */
const ONNX_MB: Record<string, number> = {
  'onnx-community/whisper-small/onnx/encoder_model.onnx': 352.8,
  'onnx-community/whisper-small/onnx/encoder_model_fp16.onnx': 176.6,
  'onnx-community/whisper-small/onnx/encoder_model_quantized.onnx': 92.3,
  'onnx-community/whisper-small/onnx/decoder_model_merged_q4.onnx': 233.1,
  'onnx-community/whisper-small/onnx/decoder_model_merged_quantized.onnx': 156.8,
  'onnx-community/whisper-large-v3-turbo/onnx/encoder_model_q4.onnx': 424.9,
  'onnx-community/whisper-large-v3-turbo/onnx/decoder_model_merged_q4.onnx': 334.1,
}

const MODELS: Record<LocalModelId, ModelDef> = {
  'whisper-small': {
    repo: 'onnx-community/whisper-small',
    label: 'Whisper small',
    hint: 'Fast, runs on any machine (GPU or CPU). Russian is decent; short phrases work best.',
    variants: {
      gpu16: { encoder: 'fp16', decoder: 'q4' },
      gpu32: { encoder: 'fp32', decoder: 'q4' },
      cpu: { encoder: 'q8', decoder: 'q8' },
    },
  },
  'whisper-large-v3-turbo': {
    repo: 'onnx-community/whisper-large-v3-turbo',
    label: 'Whisper large v3 turbo',
    hint: 'Best quality, much better Russian. Needs a GPU (WebGPU); on CPU it works but is very slow.',
    // 4-bit block weights with fp32 math: no shader-f16 needed, ~760 MB.
    variants: {
      gpu16: { encoder: 'q4', decoder: 'q4' },
      gpu32: { encoder: 'q4', decoder: 'q4' },
      cpu: { encoder: 'q4', decoder: 'q4' },
    },
  },
}

const SUFFIX: Record<DType, string> = { fp32: '', fp16: '_fp16', q8: '_quantized', q4: '_q4' }
const HF = 'https://huggingface.co'
const CACHE_NAME = 'transformers-cache'
const ORT_WEB_VERSION_FALLBACK = '1.22.0-dev.20250409-89f8206ba4'

function onnxFiles(v: Variant): string[] {
  return [`onnx/encoder_model${SUFFIX[v.encoder]}.onnx`, `onnx/decoder_model_merged${SUFFIX[v.decoder]}.onnx`]
}
function sizeOf(id: LocalModelId, p: Profile): number {
  const m = MODELS[id]
  return Math.round(BASE_MB + onnxFiles(m.variants[p]).reduce((s, f) => s + (ONNX_MB[`${m.repo}/${f}`] ?? 0), 0))
}
function labelOf(id: LocalModelId, p: Profile): string {
  const tag = id === 'whisper-small' ? 'fast' : 'best'
  return `${MODELS[id].label} (${tag}, ~${sizeOf(id, p)} MB${id === 'whisper-large-v3-turbo' ? ', needs a GPU' : ''})`
}

/**
 * Model choices. Sizes start as the WebGPU (shader-f16) figures; once
 * webgpuAvailable() has run, the entries are updated in place to what this
 * machine will actually download.
 */
export const LOCAL_MODELS: { id: LocalModelId, label: string, sizeMb: number, hint: string }[]
  = (Object.keys(MODELS) as LocalModelId[]).map(id => ({ id, label: labelOf(id, 'gpu16'), sizeMb: sizeOf(id, 'gpu16'), hint: MODELS[id].hint }))

function refreshList(p: Profile) {
  for (const m of LOCAL_MODELS) {
    m.label = labelOf(m.id, p)
    m.sizeMb = sizeOf(m.id, p)
  }
}

// ─── device ──────────────────────────────────────────────────────────────────
let profilePromise: Promise<Profile> | null = null
function profile(): Promise<Profile> {
  profilePromise ??= (async () => {
    let p: Profile = 'cpu'
    try {
      const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu
      const adapter = gpu ? await gpu.requestAdapter() : null
      if (adapter)
        p = adapter.features.has('shader-f16') ? 'gpu16' : 'gpu32'
    }
    catch {}
    refreshList(p)
    return p
  })()
  return profilePromise
}
const deviceOf = (p: Profile): Device => (p === 'cpu' ? 'wasm' : 'webgpu')

export async function webgpuAvailable(): Promise<boolean> {
  return (await profile()) !== 'cpu'
}

// ─── cache ───────────────────────────────────────────────────────────────────
async function plan(id: LocalModelId) {
  const p = await profile()
  const m = MODELS[id]
  const v = m.variants[p]
  const files = [...BASE_FILES, ...onnxFiles(v)].map(f => ({
    file: f,
    url: `${HF}/${m.repo}/resolve/main/${f}`,
    mb: ONNX_MB[`${m.repo}/${f}`] ?? BASE_MB / BASE_FILES.length,
  }))
  return { p, device: deviceOf(p), v, m, files }
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME)
  }
  catch {
    return null
  }
}

export async function isInstalled(id: LocalModelId): Promise<boolean> {
  const cache = await openCache()
  if (!cache)
    return false
  const { files } = await plan(id)
  for (const f of files) {
    if (!(await cache.match(f.url)))
      return false
  }
  return true
}

export async function remove(id: LocalModelId): Promise<void> {
  if (loaded?.id === id)
    dispose()
  const cache = await openCache()
  if (!cache)
    return
  const prefix = `${HF}/${MODELS[id].repo}/`
  for (const req of await cache.keys()) {
    if (req.url.startsWith(prefix))
      await cache.delete(req)
  }
}

function abortError(): Error {
  return new DOMException('Aborted', 'AbortError')
}

async function download(cache: Cache, url: string, signal: AbortSignal | undefined, onBytes: (n: number) => void) {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body)
    throw new Error(`Download failed (${res.status}): ${url}`)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done)
      break
    chunks.push(value)
    size += value.length
    onBytes(value.length)
  }
  // Stored the way transformers.js stores it: key = hub URL, with a length
  // header so its own progress reader knows the total.
  await cache.put(url, new Response(new Blob(chunks as BlobPart[]), {
    headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'content-length': String(size) },
  }))
}

// ─── pipeline ────────────────────────────────────────────────────────────────
type TFModule = typeof TF
interface Asr {
  (audio: Float32Array, opts?: Record<string, unknown>): Promise<{ text: string } | { text: string }[]>
  dispose: () => Promise<void>
}

let tfPromise: Promise<TFModule> | null = null
function loadTf(): Promise<TFModule> {
  tfPromise ??= import('@huggingface/transformers').then((tf) => {
    const env = tf.env
    env.allowLocalModels = false
    env.allowRemoteModels = true
    env.useBrowserCache = true
    const onnx = env.backends.onnx as { versions?: { web?: string }, wasm?: { wasmPaths?: unknown } }
    // The bundle runs from a blob: URL, so onnxruntime-web can't find its
    // .wasm next to itself: point it at the CDN copy of the exact version.
    const ver = onnx.versions?.web || ORT_WEB_VERSION_FALLBACK
    if (onnx.wasm)
      onnx.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ver}/dist/`
    return tf
  }).catch((e) => {
    tfPromise = null
    throw e
  })
  return tfPromise
}

let loaded: { id: LocalModelId, profile: Profile, asr: Promise<Asr> } | null = null
/** Serialises model loads and runs: one ORT session can't run twice at once. */
let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => {})
  return run
}

async function getAsr(id: LocalModelId): Promise<Asr> {
  const pl = await plan(id)
  if (loaded && loaded.id === id && loaded.profile === pl.p)
    return loaded.asr
  dispose()
  const tf = await loadTf()
  const asr = tf.pipeline('automatic-speech-recognition', pl.m.repo, {
    device: pl.device,
    dtype: { encoder_model: pl.v.encoder, decoder_model_merged: pl.v.decoder },
  } as never) as unknown as Promise<Asr>
  const entry = { id, profile: pl.p, asr }
  loaded = entry
  asr.catch(() => {
    if (loaded === entry)
      loaded = null
  })
  return asr
}

export async function install(id: LocalModelId, onProgress: (fraction: number, text: string) => void, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    throw abortError()
  const cache = await openCache()
  if (!cache)
    throw new Error('Cache Storage is not available here')
  const { files } = await plan(id)
  const total = files.reduce((s, f) => s + f.mb, 0) * 1e6
  let got = 0
  const mb = (b: number) => Math.round(b / 1e6)
  const report = (what: string) => onProgress(Math.min(0.95, 0.95 * got / total), `Downloading ${what} ${mb(got)}/${mb(total)} MB`)
  onProgress(0, 'Checking files')
  for (const f of files) {
    if (signal?.aborted)
      throw abortError()
    if (await cache.match(f.url)) {
      got += f.mb * 1e6
      continue
    }
    const what = f.file.includes('encoder') ? 'encoder' : f.file.includes('decoder') ? 'decoder' : 'tokenizer'
    const start = got
    await download(cache, f.url, signal, (n) => {
      got += n
      report(what)
    })
    got = start + Math.max(got - start, f.mb * 1e6) // estimate -> actual
  }
  if (signal?.aborted)
    throw abortError()
  onProgress(0.96, 'Loading the model')
  await enqueue(async () => {
    const asr = await getAsr(id)
    onProgress(0.98, 'Warming up')
    // First run compiles the GPU shaders / sets up the session.
    const warm = new Float32Array(16000)
    for (let i = 0; i < warm.length; i++)
      warm[i] = (Math.random() - 0.5) * 0.01
    await asr(warm, { max_new_tokens: 4, return_timestamps: false })
  })
  onProgress(1, 'Ready')
}

// ─── transcription ───────────────────────────────────────────────────────────
/** Below this RMS (~ -48 dBFS) the clip counts as silence and isn't decoded. */
export const SILENCE_RMS = 0.004

/** Stock Whisper hallucinations on silence/noise, removed from any output. */
export const WHISPER_JUNK: RegExp[] = [
  /продолжение следует\.*/giu,
  /субтитр[а-я]* (?:сделал|создавал|подготовил|делал|by)[^.!?\n]*[.!?]*/giu,
  /редактор субтитров[^.!?\n]*[.!?]*/giu,
  /корректор [а-я]\.\s*[а-я]+[.!?]*/giu,
  /спасибо за (?:просмотр|внимание)[.!?]*/giu,
  /подпис(?:ывайтесь|ывайся|ывайтесь на канал|ись на канал)[^.!?\n]*[.!?]*/giu,
  /ставьте лайк[^.!?\n]*[.!?]*/giu,
  /до (?:новых )?встреч[^.!?\n]*[.!?]*/giu,
  /(?:динамичная |спокойная |весёлая |веселая |грустная )?музыка[.!?]*$/giu,
  /thank(?:s| you) (?:so much )?for watching[^.!?\n]*[.!?]*/giu,
  /(?:please )?(?:like and )?subscribe[^.!?\n]*[.!?]*/giu,
  /subtitles? by[^.!?\n]*[.!?]*/giu,
  /transcri(?:bed|ption) by[^.!?\n]*[.!?]*/giu,
  /amara\.org[^.!?\n]*[.!?]*/giu,
  /\[[^\]]*\]/gu, // [BLANK_AUDIO], [Музыка], [музыка играет]
  /\((?:музыка|смех|аплодисменты|music|laughs?|applause|silence)[^)]*\)/giu,
  /[♪♫]+[^♪♫]*[♪♫]*/gu,
]
/** Whole outputs that are junk only when they are all there is. */
const JUNK_ALONE = /^(?:you|ты|\.+|…|-)$/iu

export function stripJunk(text: string): string {
  let t = text
  for (const re of WHISPER_JUNK)
    t = t.replace(re, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  if (!/[\p{L}\p{N}]/u.test(t) || JUNK_ALONE.test(t))
    return ''
  return t
}

function rms(a: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++)
    s += a[i] * a[i]
  return a.length ? Math.sqrt(s / a.length) : 0
}

/** 'ru', 'ru-RU', 'Russian' -> 'ru' / 'russian'; '' / 'auto' -> undefined. */
function normLang(language: string): string | undefined {
  const l = language.trim().toLowerCase()
  if (!l || l === 'auto')
    return undefined
  return /^[a-z]{2,3}[-_]/.test(l) ? l.split(/[-_]/)[0] : l
}

export async function transcribe(id: LocalModelId, audio16k: Float32Array, language: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted)
    throw abortError()
  if (audio16k.length < 1600 || rms(audio16k) < SILENCE_RMS)
    return ''
  const lang = normLang(language)
  const tf = await loadTf()
  // Stops decoding at the next token once the signal fires.
  class AbortCriteria extends tf.StoppingCriteria {
    _call(input_ids: number[][]) {
      return input_ids.map(() => !!signal?.aborted)
    }
  }
  const long = audio16k.length > 30 * 16000
  const opts: Record<string, unknown> = {
    task: 'transcribe',
    return_timestamps: false,
    ...(lang ? { language: lang } : {}),
    ...(long ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
    ...(signal ? { stopping_criteria: [new AbortCriteria()] } : {}),
  }
  const out = await enqueue(async () => {
    if (signal?.aborted)
      throw abortError()
    const asr = await getAsr(id)
    try {
      return await asr(audio16k, opts)
    }
    catch (e) {
      // Unknown language name/code: retry with auto-detection.
      if (lang && /not supported/i.test(String((e as Error)?.message))) {
        delete opts.language
        return await asr(audio16k, opts)
      }
      throw e
    }
  })
  if (signal?.aborted)
    throw abortError()
  const text = Array.isArray(out) ? out.map(o => o.text).join(' ') : out.text
  return stripJunk(text ?? '')
}

export function dispose(): void {
  const l = loaded
  loaded = null
  if (l)
    void l.asr.then(a => a.dispose()).catch(() => {})
}
