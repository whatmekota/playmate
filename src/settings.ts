import type { BrainConfig, FetchFn } from './brain'
import type { SttCfg, SttEngine } from './stt'
import type { LocalModelId } from './stt-local'
import type { PluginContext, SelectOption, SettingField } from './types'
import { listModels, PROVIDERS } from './brain'
import { BUILTIN, builtinApiKey } from './builtin'
import { FISH_MODELS } from './fish'
import { LOCAL_MODELS } from './stt-local'

export interface Settings {
  brainKind: 'local' | 'api'
  localUrl: string
  localModel: string
  apiProvider: string
  apiUrl: string
  apiKey: string
  apiModel: string
  extraJson: string
  maxTokens: number
  history: number
  character: string
  language: string
  safeWord: string
  voiceOn: boolean
  fishKey: string
  fishModel: string
  defaultVoice: string
  emotion: string
  speechSpeed: number
  maxSpm: number
  minDepth: number
  maxDepth: number
  edgeSeconds: number
  lead: boolean
  quietSeconds: number
  sessionMinutes: number
  saveLog: boolean
  libraryOn: boolean
  seeVideo: boolean
  autoFrames: boolean
  sttEngine: SttEngine
  sttLocalModel: LocalModelId
  sttUrl: string
  sttServerUrl: string
  sttKey: string
  sttModel: string
  sttVeniceModel: string
  sttToken: string
  pttKey: string
}

export const DEFAULTS: Settings = {
  // With a built-in abliteration key, that is the brain out of the box.
  brainKind: BUILTIN.abliteration ? 'api' : 'local',
  localUrl: 'http://127.0.0.1:1234/v1',
  localModel: '',
  apiProvider: BUILTIN.abliteration ? 'abliteration' : 'openrouter',
  apiUrl: '',
  apiKey: '',
  apiModel: '',
  extraJson: '',
  maxTokens: 400,
  history: 30,
  character: 'ani-en',
  language: 'en',
  safeWord: 'red',
  voiceOn: true,
  fishKey: '',
  fishModel: 's2.1-pro-free',
  defaultVoice: '',
  emotion: 'neutral',
  speechSpeed: 1,
  maxSpm: 100,
  minDepth: 20,
  maxDepth: 100,
  edgeSeconds: 15,
  lead: false,
  quietSeconds: 20,
  sessionMinutes: 15,
  saveLog: true,
  // Off until the user says so: with a cloud brain, video names and stats go to it.
  libraryOn: false,
  seeVideo: false,
  autoFrames: false,
  // Venice's speech recognition needs nothing more than the Venice key.
  // (Fish's needs paid credit, which a free Fish account doesn't have.)
  sttEngine: BUILTIN.venice ? 'venice' : 'off',
  sttLocalModel: 'whisper-large-v3-turbo',
  sttUrl: 'https://api.groq.com/openai/v1',
  // whisper-asr-webservice's usual port.
  sttServerUrl: 'http://127.0.0.1:9000',
  sttKey: '',
  sttModel: 'whisper-large-v3-turbo',
  sttVeniceModel: 'nvidia/parakeet-tdt-0.6b-v3',
  sttToken: '',
  pttKey: 'KeyT',
}

const VENICE_URL = 'https://api.venice.ai/api/v1'

/** Keys that can be held to talk: free in playhound, easy to find. */
export const PTT_KEYS: SelectOption[] = [
  { value: 'KeyT', label: 'T' },
  { value: 'KeyV', label: 'V' },
  { value: 'KeyG', label: 'G' },
  { value: 'CapsLock', label: 'Caps Lock' },
  { value: 'ControlRight', label: 'Right Ctrl' },
  { value: 'AltRight', label: 'Right Alt' },
  { value: 'F8', label: 'F8' },
  { value: 'F9', label: 'F9' },
]

/** What push-to-talk transcribes with, or null when it is off or not set up. */
export function sttConfig(s: Settings): SttCfg | null {
  switch (s.sttEngine) {
    case 'venice': {
      // The Venice brain's key if that's the brain in use, else the built-in one.
      const key = (s.apiProvider === 'venice' ? s.apiKey.trim() : '') || BUILTIN.venice
      return key ? { kind: 'openai', url: VENICE_URL, key, model: s.sttVeniceModel.trim() || DEFAULTS.sttVeniceModel } : null
    }
    case 'fish': {
      const key = s.fishKey.trim() || BUILTIN.fish
      return key ? { kind: 'fish', key } : null
    }
    case 'local':
      return { kind: 'local', model: s.sttLocalModel }
    case 'openai':
      return s.sttUrl.trim() ? { kind: 'openai', url: s.sttUrl.trim(), key: s.sttKey.trim(), model: s.sttModel.trim() } : null
    case 'voiceserver':
      return s.sttServerUrl.trim() ? { kind: 'voiceserver', url: s.sttServerUrl.trim(), token: s.sttToken.trim() } : null
    default:
      return null
  }
}

export function read(ctx: PluginContext): Settings {
  const all = ctx.settings.all()
  const out = { ...DEFAULTS } as Record<string, unknown>
  for (const k of Object.keys(DEFAULTS)) {
    const v = all[k]
    if (v === undefined || v === null)
      continue
    const d = (DEFAULTS as unknown as Record<string, unknown>)[k]
    out[k] = typeof d === 'number' ? (Number.isFinite(Number(v)) ? Number(v) : d) : typeof d === 'boolean' ? !!v : String(v)
  }
  // Keys: one per provider preset (key_<provider>), apiKey for a custom URL.
  // What the user typed wins; else the built-in key, if any.
  const s = out as unknown as Settings
  const typed = s.apiProvider in PROVIDERS ? String(all[`key_${s.apiProvider}`] ?? '') : s.apiKey
  s.apiKey = typed.trim() || builtinApiKey(s.apiProvider)
  s.fishKey = s.fishKey.trim() || BUILTIN.fish
  return s
}

/** The URL and preset for the chosen API provider ('custom' = the URL field). */
export function apiTarget(s: Settings) {
  const p = PROVIDERS[s.apiProvider]
  return p ? { url: p.url, extra: p.extra, model: s.apiModel || p.model } : { url: s.apiUrl, extra: {}, model: s.apiModel }
}

export function parseExtra(json: string): Record<string, unknown> {
  if (!json.trim())
    return {}
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  }
  catch {
    return {}
  }
}

export function brainConfig(s: Settings): BrainConfig {
  const user = parseExtra(s.extraJson)
  if (s.brainKind === 'api') {
    const t = apiTarget(s)
    return { kind: 'api', url: t.url, model: t.model, key: s.apiKey.trim(), extra: { ...t.extra, ...user }, maxTokens: s.maxTokens, history: s.history }
  }
  return { kind: 'local', url: s.localUrl.trim(), model: s.localModel.trim(), key: '', extra: user, maxTokens: s.maxTokens, history: s.history }
}

const LANGS = [
  ['en', 'English'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['pl', 'Polish'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
].map(([value, label]) => ({ value, label }))

export interface FieldDeps {
  maxAppSpm: () => number
  characters: () => Promise<SelectOption[]>
}

type V = Record<string, unknown>

export function fields(ctx: PluginContext, fetchFn: FetchFn, deps: FieldDeps): SettingField[] {
  const local = (v: V) => (v.brainKind ?? DEFAULTS.brainKind) !== 'api'
  const api = (v: V) => !local(v)
  const voiceOn = (v: V) => (v.voiceOn ?? DEFAULTS.voiceOn) !== false
  const lead = (v: V) => !!(v.lead ?? DEFAULTS.lead)
  const ceiling = Math.max(10, Math.round(deps.maxAppSpm()))
  return [
    { type: 'heading', label: 'Brain', hint: 'Any OpenAI-compatible chat/completions endpoint.' },
    { key: 'brainKind', type: 'select', label: 'Brain', default: DEFAULTS.brainKind, options: [{ value: 'local', label: 'Local server (LM Studio)' }, { value: 'api', label: 'Cloud API (with a key)' }] },
    { key: 'localUrl', type: 'text', label: 'Server URL', default: DEFAULTS.localUrl, placeholder: DEFAULTS.localUrl, when: local },
    { key: 'localModel', type: 'select', label: 'Model', hint: 'Empty uses whatever model the server has loaded.', free: true, default: '', when: local, options: () => listModels(fetchFn, read(ctx).localUrl, '') },
    { key: 'apiProvider', type: 'select', label: 'Provider', default: DEFAULTS.apiProvider, when: api, options: [...Object.entries(PROVIDERS).map(([value, p]) => ({ value, label: p.label })), { value: 'custom', label: 'Custom URL' }] },
    { key: 'apiUrl', type: 'text', label: 'API URL', placeholder: 'https://…/v1', when: v => api(v) && v.apiProvider === 'custom' },
    ...Object.entries(PROVIDERS).map(([id, p]): SettingField => ({
      key: `key_${id}`,
      type: 'password',
      label: `${p.label} API key`,
      placeholder: builtinApiKey(id) ? 'built-in key' : '',
      hint: builtinApiKey(id) ? 'Empty uses the built-in key.' : undefined,
      when: v => api(v) && (v.apiProvider ?? DEFAULTS.apiProvider) === id,
    })),
    { key: 'apiKey', type: 'password', label: 'API key', when: v => api(v) && v.apiProvider === 'custom' },
    {
      key: 'apiModel',
      type: 'select',
      label: 'Model',
      hint: 'Empty uses the provider\'s default.',
      free: true,
      default: '',
      when: api,
      options: () => {
        const s = read(ctx)
        return listModels(fetchFn, apiTarget(s).url, s.apiKey)
      },
    },
    { key: 'extraJson', type: 'textarea', label: 'Extra request JSON', hint: 'Merged into each request, over the provider\'s own, e.g. {"temperature": 0.7}.', rows: 3, placeholder: '{}', default: '' },
    { key: 'maxTokens', type: 'number', label: 'Max reply tokens', min: 50, max: 4000, step: 50, default: DEFAULTS.maxTokens },
    { key: 'history', type: 'number', label: 'History (messages)', hint: 'At the cap it is cut back to half.', min: 4, max: 200, step: 2, default: DEFAULTS.history },

    { type: 'heading', label: 'Character and language', hint: 'Edit the main prompt and the characters in the panel (Prompts).' },
    { key: 'character', type: 'select', label: 'Character', default: DEFAULTS.character, options: deps.characters },
    { key: 'language', type: 'select', label: 'Reply language', hint: 'What it speaks, unless the character sets its own; also the language hint for the voice.', free: true, default: DEFAULTS.language, options: LANGS },
    { key: 'safeWord', type: 'text', label: 'Safe word', hint: 'Saying or typing it stops the device and pauses the session at once.', default: DEFAULTS.safeWord },

    { type: 'heading', label: 'Voice (Fish Audio)', hint: 'Public library voices, by id. Each character has its own; pick them in the panel.' },
    { key: 'voiceOn', type: 'switch', label: 'Speak replies', default: DEFAULTS.voiceOn },
    { key: 'fishKey', type: 'password', label: 'Fish Audio API key', placeholder: BUILTIN.fish ? 'built-in key' : '', hint: BUILTIN.fish ? 'Empty uses the built-in key.' : undefined, when: voiceOn },
    { key: 'fishModel', type: 'select', label: 'TTS model', free: true, default: DEFAULTS.fishModel, when: voiceOn, options: FISH_MODELS.map(value => ({ value, label: value })) },
    { key: 'defaultVoice', type: 'text', label: 'Fallback voice', hint: 'A voice id or a fish.audio/m/… link, for characters without their own.', placeholder: 'fish.audio/m/…', when: voiceOn },
    { key: 'emotion', type: 'select', label: 'Default emotion', default: 'neutral', when: voiceOn, options: ['neutral', 'excited', 'sad', 'angry'].map(value => ({ value, label: value })) },
    { key: 'speechSpeed', type: 'slider', label: 'Speech speed', min: 0.5, max: 2, step: 0.05, unit: '×', default: 1, when: voiceOn },

    { type: 'heading', label: 'Movement limits', hint: 'What the AI may ask for. The app\'s own speed ceiling still applies.' },
    { key: 'maxSpm', type: 'slider', label: 'Fastest it may go', min: 10, max: ceiling, step: 5, unit: '/min', default: Math.min(DEFAULTS.maxSpm, ceiling) },
    { key: 'minDepth', type: 'slider', label: 'Shortest stroke', min: 0, max: 100, step: 5, unit: '%', default: DEFAULTS.minDepth },
    { key: 'maxDepth', type: 'slider', label: 'Longest stroke', min: 0, max: 100, step: 5, unit: '%', default: DEFAULTS.maxDepth },
    { key: 'edgeSeconds', type: 'slider', label: 'Edge hold', min: 5, max: 60, step: 1, unit: 's', default: DEFAULTS.edgeSeconds },

    { type: 'heading', label: 'Lead mode', hint: 'It runs the session by itself: talks and changes the stroke when you are quiet.' },
    { key: 'lead', type: 'switch', label: 'Lead mode', default: DEFAULTS.lead },
    { key: 'quietSeconds', type: 'slider', label: 'Speaks up after', min: 5, max: 120, step: 1, unit: 's', default: DEFAULTS.quietSeconds, when: lead },
    { key: 'sessionMinutes', type: 'slider', label: 'Session length', min: 1, max: 120, step: 1, unit: 'min', default: DEFAULTS.sessionMinutes },
    { key: 'saveLog', type: 'switch', label: 'Keep the last session\'s log', default: DEFAULTS.saveLog },

    { type: 'heading', label: 'Your library', hint: 'She can pick scripted videos and talk over them; the device follows their scripts meanwhile.' },
    { key: 'seeVideo', type: 'switch', label: 'Let her see the video (experimental)', hint: 'Show her the video with the camera button in the panel (it sends what\'s in the text box along). Needs a brain that takes images (abliteration\'s large-flash does). Snapshots go to the brain\'s servers.', default: DEFAULTS.seeVideo },
    { key: 'autoFrames', type: 'switch', label: 'Also send snapshots by themselves', hint: 'While a video is on, her turns carry one too, at most one every 10 s.', default: DEFAULTS.autoFrames, when: v => !!v.seeVideo },
    { key: 'libraryOn', type: 'switch', label: 'Let her pick videos', hint: 'She sees a short list of your scripted videos: names, length, how hard they go, stars, playlists, and how often you finished to them. With a cloud brain that list goes to its servers; with a local one it stays here.', default: DEFAULTS.libraryOn },

    { type: 'heading', label: 'Talking to it (push-to-talk)', hint: 'Hold the key (or the mic button in the panel), speak, let go. It hears the reply language.' },
    { key: 'sttEngine', type: 'select', label: 'Speech recognition', default: DEFAULTS.sttEngine, options: [
      { value: 'venice', label: 'Venice (cloud, uses the Venice key)' },
      { value: 'fish', label: 'Fish Audio (cloud, needs paid Fish credit)' },
      { value: 'local', label: 'Whisper on this PC (download once, then offline)' },
      { value: 'openai', label: 'OpenAI-compatible API (Groq, OpenAI…)' },
      { value: 'voiceserver', label: 'Whisper server (/asr)' },
      { value: 'off', label: 'Off (typing only)' },
    ] },
    { key: 'sttLocalModel', type: 'select', label: 'Whisper model', hint: 'Install it from the panel (the mic button offers it).', default: DEFAULTS.sttLocalModel, when: v => v.sttEngine === 'local', options: LOCAL_MODELS.map(m => ({ value: m.id, label: m.label })) },
    { key: 'sttVeniceModel', type: 'select', label: 'Venice model', hint: 'Parakeet is the quickest; Whisper large v3 is the classic.', free: true, default: DEFAULTS.sttVeniceModel, when: v => v.sttEngine === 'venice', options: [
      { value: 'nvidia/parakeet-tdt-0.6b-v3', label: 'Parakeet v3 (fast)' },
      { value: 'openai/whisper-large-v3', label: 'Whisper large v3' },
      { value: 'elevenlabs/scribe-v2', label: 'ElevenLabs Scribe v2' },
    ] },
    { key: 'sttUrl', type: 'text', label: 'API URL', hint: 'The base that /audio/transcriptions goes after.', default: DEFAULTS.sttUrl, when: v => v.sttEngine === 'openai' },
    { key: 'sttServerUrl', type: 'text', label: 'Server URL', hint: 'A whisper server with POST /asr, such as whisper-asr-webservice.', default: DEFAULTS.sttServerUrl, when: v => v.sttEngine === 'voiceserver' },
    { key: 'sttKey', type: 'password', label: 'API key', when: v => v.sttEngine === 'openai' },
    { key: 'sttModel', type: 'text', label: 'Model', default: DEFAULTS.sttModel, when: v => v.sttEngine === 'openai' },
    { key: 'sttToken', type: 'password', label: 'Server token', when: v => v.sttEngine === 'voiceserver' },
    { key: 'pttKey', type: 'select', label: 'Hold to talk', hint: 'Works while the playhound window has focus and you are not typing in a box.', default: DEFAULTS.pttKey, when: v => v.sttEngine !== 'off', options: PTT_KEYS },
  ]
}
