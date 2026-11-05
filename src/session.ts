import type { TtsStream } from './fish'
import type { Character } from './prompt'
import type { LibraryVideo } from './types'
import type { Sentence } from './splitter'
import type { Limits, Move, MotionState } from './tags'
import type { MotionControl, PluginContext } from './types'
import { Speaker } from './audio'
import { Ears } from './ears'
import { libraryOverview, parseQuery, resolveQuery } from './library'
import { Cancelled, ChatBrain, NoVision } from './brain'
import { parseVoiceId, synthesize, voiceInfo } from './fish'
import { contextLine, DEFAULT_CHARACTERS, DEFAULT_MAIN, RETIRED_CHARACTERS, finalLine, isSafeWord, openingLine, safeWordLine, systemPrompt, tickLine, videoEventLine } from './prompt'
import { brainConfig, read, sttConfig } from './settings'

/** How much longer the chat may make one session, minutes. */
const MAX_EXTRA_MIN = 120

/** FNV-1a of earlier default prompt texts, per character id (see loadPrompts). */
const RETIRED_PROMPTS: Record<string, string[]> = {
  'ani': ['902772e4', '25928f38'],
  'ani-en': ['6a59be67'],
}
/** Earlier default names, per character id: a stored copy still carrying one takes the new name. */
const RETIRED_NAMES: Record<string, string[]> = {
  'ani': ['Ани'],
  'ani-en': ['Ani (EN)'],
}
/** Earlier default voices, per character id (see loadPrompts). */
const RETIRED_VOICES: Record<string, string[]> = {
  'ani-en': ['8c3ffc55cd4d4ad1ad10eded8d063369', '9780a2b12c3d492eb559dbcd8a9c62b5'],
}
function fnv(text: string): string {
  let h = 0x811C9DC5
  for (const ch of text) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}
import { SentenceSplitter } from './splitter'
import { applyMoves, clamp } from './tags'

export type ChipKind = 'move' | 'unknown' | 'lost' | 'sound'
export type Part = { t: 'text', v: string } | { t: 'chip', v: string, kind: ChipKind }

export interface LogEntry {
  id: number
  who: 'you' | 'ai' | 'sys'
  parts: Part[]
  at: number
  pending?: boolean
  error?: boolean
  old?: boolean
}

interface Item extends Sentence {
  gen: number
  entry: LogEntry
  synth: Promise<TtsStream> | null
  begun: boolean
}

export type VoiceState = 'off' | 'unknown' | 'checking' | 'ok' | 'down' | 'token' | 'nokey' | 'novoice' | 'badvoice'

interface StoredPrompts { main?: string | null, chars?: Character[] }

const LOG_MAX = 200
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export class Playmate {
  running = false
  control: MotionControl | null = null
  motion: MotionState = { spm: 0, depth: 60, pos: 50, shape: 'sine' }
  startedAt = 0
  lastActivity = 0
  brain: ChatBrain | null = null
  brainState: 'idle' | 'thinking' | 'error' = 'idle'
  brainError = ''
  voiceState: VoiceState = 'unknown'
  voiceTitle = ''
  speaking = false
  /** Stopped by the safe word: no movement, no lead nudges, until the user talks again. */
  safeHold = false
  log: LogEntry[] = []
  edgeUntil = 0
  /** Minutes added to this session from the chat ([more N]). */
  extraMin = 0
  /** The library as last read, and the overview of it she sees. */
  private libraryList: LibraryVideo[] = []
  private overview = ''
  /** What became of her last [play …], told to her once in the next turn. */
  private playNote = ''
  /** The video she put on, while it plays. */
  videoId: string | null = null
  videoTitle = ''
  private played = new Set<string>()
  private lastVideoNudge = 0
  /** When a snapshot last went with a turn; and whether the brain refused them. */
  private lastFrameAt = 0
  private visionRefused = false
  main: string | null = null
  chars: Character[] = clone(DEFAULT_CHARACTERS)

  readonly speaker = new Speaker()
  /** Push-to-talk: what you say goes in as if typed; starting to talk cuts her off. */
  readonly ears: Ears
  private nextId = 1
  private turnGen = 0
  private turnCtrl: AbortController | null = null
  private ttsCtrl = new AbortController()
  private inFlight = false
  private queue: Item[] = []
  private pumping = false
  private drainWaiters = new Set<() => void>()
  private edgeTimer: ReturnType<typeof setTimeout> | null = null
  private endAfter = false
  private finalSent = false
  private voiceFailUntil = 0
  private tickTimer: ReturnType<typeof setInterval>
  private listeners = new Set<() => void>()
  private emitQueued = false

  constructor(private ctx: PluginContext, opts: { tickMs?: number } = {}) {
    this.tickTimer = setInterval(() => this.tick(), opts.tickMs ?? 1000)
    // Older playhound builds have no playback API: then she just can't put videos on.
    ctx.playback?.onEnded?.(id => this.onVideoEnded(id))
    this.ears = new Ears(
      ctx.net.fetch,
      () => sttConfig(this.settings()),
      () => this.language(),
      () => this.speaker.audio(),
      () => {
        // You started talking: she stops, and the lead clock waits for you.
        this.cutAll()
        this.lastActivity = Date.now()
        this.emit()
      },
      text => this.send(text),
      ctx.log,
    )
  }

  // ─── Plumbing ─────────────────────────────────────────────────────────────

  settings() {
    return read(this.ctx)
  }

  limits(): Limits {
    const s = this.settings()
    const app = this.ctx.motion.readout().maxSpm
    return { maxSpm: Math.max(0, Math.round(Math.min(s.maxSpm, Number.isFinite(app) && app > 0 ? app : s.maxSpm))), minDepth: s.minDepth, maxDepth: s.maxDepth }
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    if (this.emitQueued)
      return
    this.emitQueued = true
    queueMicrotask(() => {
      this.emitQueued = false
      for (const fn of this.listeners) {
        try {
          fn()
        }
        catch (e) {
          this.ctx.log('listener failed', e)
        }
      }
    })
  }

  private addLog(who: LogEntry['who'], text = '', extra: Partial<LogEntry> = {}): LogEntry {
    const e: LogEntry = { id: this.nextId++, who, parts: text ? [{ t: 'text', v: text }] : [], at: Date.now(), ...extra }
    this.log.push(e)
    if (this.log.length > LOG_MAX)
      this.log.splice(0, this.log.length - LOG_MAX)
    this.emit()
    return e
  }

  sys(text: string, error = false) {
    this.addLog('sys', text, { error })
  }

  status() {
    const s = this.settings()
    const now = Date.now()
    return {
      player: this.ctx.player.state(),
      motion: this.motion,
      device: this.ctx.motion.readout().device,
      control: !!this.control?.active,
      edgeLeft: this.edgeUntil > now ? (this.edgeUntil - now) / 1000 : 0,
      safeHold: this.safeHold,
      elapsedMin: this.running ? (now - this.startedAt) / 60000 : 0,
      sessionMin: this.sessionMin(),
      lead: s.lead,
      video: this.videoPlaying() ? { title: this.videoTitle, script: this.ctx.player.script?.() ?? null } : null,
      note: this.takePlayNote(),
    }
  }

  // ─── Videos ───────────────────────────────────────────────────────────────

  /** Seeing the video is on, and the brain hasn't refused it. */
  visionOn() {
    return this.settings().seeVideo && !this.visionRefused && !!this.ctx.player.frame
  }

  /** A snapshot shown by hand (the camera button), waiting for its turn. */
  private shownFrame: string | null = null

  /** The camera button: show her the video now, with what he typed (if anything). */
  showFrame(text = ''): boolean {
    if (!this.visionOn())
      return false
    const f = this.ctx.player.state().title ? this.ctx.player.frame?.({ maxWidth: 640, quality: 0.75 }) ?? null : null
    if (!f) {
      this.sys('No video picture to show her right now', true)
      return false
    }
    this.shownFrame = f
    this.send(text.trim() || '[he shows you what is on the screen right now]', `📷 ${text.trim() || 'look'}`)
    return true
  }

  /** A snapshot for this turn: one shown by hand, else (if on) automatic, at most one every 10 s. */
  private takeFrame(): string | null {
    if (this.shownFrame) {
      const f = this.shownFrame
      this.shownFrame = null
      this.lastFrameAt = Date.now()
      return f
    }
    if (!this.visionOn() || !this.settings().autoFrames || Date.now() - this.lastFrameAt < 10_000)
      return null
    const p = this.ctx.player.state()
    if (!p.title)
      return null
    const f = this.ctx.player.frame?.({ maxWidth: 512, quality: 0.7 }) ?? null
    if (f)
      this.lastFrameAt = Date.now()
    return f
  }

  private takePlayNote() {
    const n = this.playNote
    this.playNote = ''
    return n
  }

  /** A video she put on is playing with its script (so the device follows it, not her). */
  videoPlaying(): boolean {
    if (!this.videoId)
      return false
    const p = this.ctx.player.state()
    return p.playing && p.hasScript && p.title === this.videoId
  }

  /** Read the library and give her its overview; scripts not measured yet get analysed in the background. */
  /** This playhound can list the library and play from it (newer builds only). */
  canPickVideos() {
    return !!this.ctx.library?.list && !!this.ctx.playback?.play
  }

  async prepareVideos() {
    if (!this.settings().libraryOn)
      return
    if (!this.canPickVideos()) {
      this.sys('This playhound is too old for her to put videos on; update it (or reload the dev window)', true)
      return
    }
    try {
      this.libraryList = await this.ctx.library.list()
      this.overview = libraryOverview(this.libraryList)
      if (!this.libraryList.some(v => v.hasScript))
        this.sys('No scripted videos in the library for her to put on', true)
      const unmeasured = this.libraryList.filter(v => v.hasScript && !v.intensity).map(v => v.id)
      if (unmeasured.length && !this.analysing) {
        this.analysing = true
        void this.ctx.library.analyse(unmeasured)
          .then(async () => {
            this.libraryList = await this.ctx.library.list()
          })
          .catch(() => {})
          .finally(() => {
            this.analysing = false
          })
      }
    }
    catch (e) {
      this.ctx.log('could not read the library', e)
    }
    this.emit()
  }

  private analysing = false

  private async playVideo(raw: string) {
    if (!this.canPickVideos())
      return
    if (!this.libraryList.length)
      this.libraryList = await this.ctx.library.list()
    const r = resolveQuery(this.libraryList, parseQuery(raw), this.played)
    if (!('video' in r)) {
      this.playNote = `your [play ${raw}] put nothing on: ${r.reason}`
      this.sys(`Nothing to put on for "${raw}": ${r.reason}`, true)
      return
    }
    const v = r.video
    // The script drives the device now; when it stops, nothing picks up by itself.
    this.motion = { ...this.motion, spm: 0 }
    this.clearEdge()
    this.control?.hold()
    const ok = await this.ctx.playback.play(v.id)
    if (!ok) {
      this.playNote = `your [play ${raw}] failed to start "${v.title}"`
      this.sys(`Couldn't play "${v.title}"`, true)
      return
    }
    this.videoId = v.id
    this.videoTitle = v.title
    this.played.add(v.id)
    this.lastVideoNudge = Date.now()
    this.playNote = `your [play ${raw}] put on "${v.title}"${v.intensity ? ` (${v.intensity.band})` : ''}${v.finishes ? `, one he came to ${v.finishes}× before` : ''}`
    this.sys(`▶ ${v.title}`)
  }

  private onVideoEnded(id: string | null) {
    if (!this.running || !this.videoId || id !== this.videoId)
      return
    const title = this.videoTitle
    const dur = this.libraryList.find(v => v.id === id)?.durationS ?? null
    const clip = !!dur && dur < 60
    this.videoId = null
    this.videoTitle = ''
    this.sys(`■ ${title} ended`)
    // Fresh numbers (plays, finishes), then let her react.
    void this.prepareVideos().then(() => {
      if (!this.running || this.busy)
        return
      const what = this.settings().lead
        ? clip
          ? `the clip "${title}" just ended (it was only ${Math.round(dur!)} s); put on the next one right away with [play …], keep it flowing`
          : `the video "${title}" just ended; put on the next with [play …], or take over the motion yourself`
        : `the video "${title}" just ended; he leads, so suggest in one short line what you'd put on next, and play it only when he says yes`
      void this.turn(videoEventLine(this.status(), what))
    })
  }

  // ─── Prompts and characters ───────────────────────────────────────────────

  mainPrompt() {
    return this.main ?? DEFAULT_MAIN
  }

  character(): Character {
    const id = this.settings().character
    return this.chars.find(c => c.id === id) ?? this.chars[0] ?? DEFAULT_CHARACTERS[0]
  }

  /** The reply language: the character's own, else the setting. */
  language() {
    return this.character().language.trim() || this.settings().language.trim() || 'en'
  }

  /** The Fish voice id: the character's, else the fallback setting. */
  voiceId() {
    return parseVoiceId(this.character().voice) ?? parseVoiceId(this.settings().defaultVoice) ?? ''
  }

  system() {
    const s = this.settings()
    return systemPrompt(this.mainPrompt(), this.character(), { language: this.language(), limits: this.limits(), edgeSeconds: s.edgeSeconds, safeWord: s.safeWord.trim() || 'red' }, s.libraryOn && this.canPickVideos() ? this.overview : '', this.visionOn())
  }

  isDefaultChar(id: string) {
    return DEFAULT_CHARACTERS.some(c => c.id === id)
  }

  async loadPrompts() {
    try {
      const st = await this.ctx.storage.get<StoredPrompts>('prompts')
      this.main = typeof st?.main === 'string' ? st.main : null
      if (Array.isArray(st?.chars) && st.chars.length) {
        const chars = st.chars.filter(c => c && typeof c.id === 'string' && !RETIRED_CHARACTERS.includes(c.id)).map(c => ({ id: c.id, name: String(c.name ?? ''), prompt: String(c.prompt ?? ''), voice: String(c.voice ?? ''), language: String(c.language ?? '') }))
        // A stored copy of a default that was since rewritten, never edited
        // by hand: take the new default text.
        for (const c of chars) {
          const d = DEFAULT_CHARACTERS.find(x => x.id === c.id)
          if (d && RETIRED_PROMPTS[c.id]?.includes(fnv(c.prompt)))
            c.prompt = d.prompt
          if (d && RETIRED_NAMES[c.id]?.includes(c.name))
            c.name = d.name
          // Same for a default voice that was since changed.
          if (d && RETIRED_VOICES[c.id]?.includes(c.voice))
            c.voice = d.voice
        }
        // Defaults added in a later version show up too.
        for (const d of DEFAULT_CHARACTERS) {
          if (!chars.some(c => c.id === d.id))
            chars.splice(DEFAULT_CHARACTERS.indexOf(d), 0, clone(d))
        }
        this.chars = chars
      }
      // The selected character may have been one of the retired ones.
      if (!this.chars.some(c => c.id === this.settings().character))
        this.ctx.settings.set('character', this.chars[0]?.id ?? 'ani-en')
    }
    catch (e) {
      this.ctx.log('could not load prompts', e)
    }
    this.emit()
  }

  private async savePrompts() {
    try {
      await this.ctx.storage.set('prompts', clone({ main: this.main, chars: this.chars }))
    }
    catch (e) {
      this.ctx.log('could not save prompts', e)
    }
    this.emit()
  }

  setMain(text: string) {
    this.main = text.trim() === DEFAULT_MAIN.trim() ? null : text
    void this.savePrompts()
  }

  resetMain() {
    this.main = null
    void this.savePrompts()
  }

  updateChar(id: string, patch: Partial<Omit<Character, 'id'>>) {
    const c = this.chars.find(x => x.id === id)
    if (!c)
      return
    Object.assign(c, patch)
    void this.savePrompts()
    if (('voice' in patch || 'language' in patch) && id === this.character().id)
      void this.refreshVoice()
  }

  resetChar(id: string) {
    const d = DEFAULT_CHARACTERS.find(x => x.id === id)
    const i = this.chars.findIndex(x => x.id === id)
    if (!d || i < 0)
      return
    this.chars[i] = clone(d)
    void this.savePrompts()
    if (id === this.character().id)
      void this.refreshVoice()
  }

  addChar(): Character {
    const c: Character = { id: `c${Date.now().toString(36)}`, name: 'New character', prompt: '', voice: '', language: '' }
    this.chars.push(c)
    void this.savePrompts()
    return c
  }

  deleteChar(id: string) {
    if (this.isDefaultChar(id))
      return
    this.chars = this.chars.filter(c => c.id !== id)
    if (this.settings().character === id)
      this.ctx.settings.set('character', this.chars[0]?.id ?? '')
    void this.savePrompts()
  }

  selectChar(id: string) {
    this.ctx.settings.set('character', id)
    if (this.running)
      this.sys(`Now: ${this.chars.find(c => c.id === id)?.name ?? id}`)
    void this.refreshVoice()
    this.emit()
  }

  get busy() {
    return this.inFlight || this.pumping || this.queue.length > 0
  }

  get motionLost() {
    return this.running && !this.control?.active
  }

  // ─── Session ──────────────────────────────────────────────────────────────

  /** Start a session (or, while one runs and the motion was lost, take it back). */
  start(): boolean {
    if (this.ctx.safety.panicked()) {
      this.ctx.ui.toast('Panic is on', { tone: 'error', detail: 'Resume first, then start playmate.' })
      return false
    }
    if (this.running) {
      if (!this.control?.active)
        this.take(true)
      return true
    }
    const s = this.settings()
    this.running = true
    this.startedAt = this.lastActivity = Date.now()
    this.finalSent = this.endAfter = this.safeHold = false
    this.extraMin = 0
    this.lastFrameAt = 0
    this.visionRefused = false
    this.played.clear()
    this.overview = ''
    this.playNote = ''
    this.videoId = null
    this.brainState = 'idle'
    this.brainError = ''
    const lim = this.limits()
    this.motion = { spm: 0, depth: Math.round(clamp(60, Math.min(lim.minDepth, lim.maxDepth), Math.max(lim.minDepth, lim.maxDepth))), pos: 50, shape: 'sine' }
    this.brain = new ChatBrain(this.ctx.net.fetch, () => this.system(), () => brainConfig(this.settings()), this.ctx.log)
    try {
      this.speaker.audio()
    }
    catch (e) {
      this.ctx.log('no audio context', e)
    }
    this.sys(`Session started with ${this.character().name}${s.lead ? `, leading for ${s.sessionMinutes} min` : ''}`)
    this.take()
    void this.refreshVoice()
    // Her video list first (if she may pick), so the opening already knows it.
    const ready = this.prepareVideos()
    if (s.lead)
      void ready.then(() => {
        if (this.running)
          void this.turn(openingLine(this.status()))
      })
    this.emit()
    return true
  }

  private take(again = false) {
    const c = this.ctx.motion.take()
    this.control = c
    if (!c) {
      this.sys('Could not take the stroke generator', true)
    }
    else {
      this.pushMotion()
      if (again)
        this.sys('Took the motion back')
    }
    this.emit()
  }

  stop(reason = 'Session stopped') {
    if (!this.running)
      return
    this.running = false
    this.cutAll()
    this.clearEdge()
    try {
      this.control?.release()
    }
    catch {}
    this.control = null
    if (this.videoPlaying())
      this.ctx.playback.pause()
    this.videoId = null
    this.videoTitle = ''
    this.brainState = 'idle'
    this.sys(reason)
    void this.saveLog()
    this.emit()
  }

  /** Panic: the host already released the generator. Stop talking, listening and thinking. */
  panic() {
    this.ears.cancel()
    if (this.running)
      this.stop('Panic: session stopped')
    else
      this.cutAll()
  }

  /** Barge-in: cut speech and the turn in flight. */
  private cutAll() {
    this.turnGen++
    this.turnCtrl?.abort()
    this.turnCtrl = null
    this.ttsCtrl.abort()
    this.ttsCtrl = new AbortController()
    this.speaker.cut()
    this.queue = []
    this.inFlight = false
    this.speaking = false
    for (const w of [...this.drainWaiters]) w()
  }

  setLead(on: boolean) {
    this.ctx.settings.set('lead', on)
    if (this.running) {
      this.sys(on ? 'Lead mode on: it runs the session' : 'Lead mode off: you lead')
      this.lastActivity = Date.now()
    }
    this.emit()
  }

  // ─── Turns ────────────────────────────────────────────────────────────────

  /** What the user said or typed. Starts a session if none runs. */
  send(text: string, shown?: string) {
    text = text.trim()
    if (!text)
      return
    if (!this.running && !this.start())
      return
    this.cutAll()
    this.addLog('you', shown ?? text)
    this.lastActivity = Date.now()
    const s = this.settings()
    if (isSafeWord(text, s.safeWord.trim() || 'red')) {
      // Stop first, then let the character check in.
      this.safeHold = true
      this.clearEdge()
      this.motion = { ...this.motion, spm: 0 }
      this.pushMotion()
      this.sys('Safe word: stopped', true)
      void this.turn(safeWordLine(this.status(), text))
      return
    }
    if (this.safeHold) {
      this.safeHold = false
      this.sys('Resumed after the safe word')
    }
    void this.turn(`${contextLine(this.status())}\n${text}`)
  }

  private async turn(content: string) {
    const brain = this.brain
    if (!brain || !this.running)
      return
    const gen = ++this.turnGen
    const ctrl = new AbortController()
    this.turnCtrl = ctrl
    this.inFlight = true
    const entry = this.addLog('ai', '', { pending: true })
    const splitter = new SentenceSplitter(s => this.enqueue(s, gen, entry), this.settings().emotion)
    this.brainState = 'thinking'
    this.emit()
    try {
      const onText = (d: string) => {
        if (gen === this.turnGen)
          splitter.push(d)
      }
      const frame = this.takeFrame()
      try {
        await brain.ask(content, onText, ctrl.signal, frame)
      }
      catch (e) {
        if (!(e instanceof NoVision))
          throw e
        // The brain can't take pictures: off for this session, and the turn goes again without one.
        this.visionRefused = true
        this.sys('The brain refused the video snapshot (no image support?); seeing the video is off for this session', true)
        await brain.ask(content, onText, ctrl.signal)
      }
      if (gen !== this.turnGen)
        return
      splitter.flush()
      this.brainState = 'idle'
      this.brainError = ''
      this.emit()
      await this.drained(gen)
    }
    catch (e) {
      if (gen !== this.turnGen || e instanceof Cancelled || ctrl.signal.aborted)
        return
      const msg = e instanceof Error ? e.message : String(e)
      this.brainState = 'error'
      this.brainError = msg
      this.sys(`Brain: ${msg}`, true)
    }
    finally {
      entry.pending = false
      if (!entry.parts.length)
        this.log = this.log.filter(x => x !== entry)
      if (gen === this.turnGen) {
        this.inFlight = false
        this.turnCtrl = null
        this.lastActivity = Date.now()
        if (this.endAfter && this.running)
          this.stop('The session is over')
      }
      this.emit()
    }
  }

  private drained(gen: number): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (gen !== this.turnGen || (!this.pumping && !this.queue.some(i => i.gen === gen))) {
          this.drainWaiters.delete(check)
          resolve()
        }
      }
      this.drainWaiters.add(check)
      check()
    })
  }

  private enqueue(s: Sentence, gen: number, entry: LogEntry) {
    if (gen !== this.turnGen)
      return
    this.queue.push({ ...s, gen, entry, synth: null, begun: false })
    void this.pump()
  }

  private ttsActive() {
    const s = this.settings()
    return s.voiceOn && !!s.fishKey.trim() && !!this.voiceId() && Date.now() >= this.voiceFailUntil
  }

  private synth(item: Item): Promise<TtsStream> {
    const s = this.settings()
    const p = synthesize(this.ctx.net.fetch, { key: s.fishKey.trim(), model: s.fishModel.trim() }, {
      text: item.speech,
      voice: this.voiceId(),
      emotion: item.emotion,
      language: this.language(),
      speed: s.speechSpeed,
    }, this.ttsCtrl.signal)
    p.catch(() => {})
    return p
  }

  private async pump() {
    if (this.pumping)
      return
    this.pumping = true
    try {
      while (this.queue.length && this.running) {
        const item = this.queue.shift()!
        if (item.gen !== this.turnGen)
          continue
        const ttsSignal = this.ttsCtrl.signal
        let stream: TtsStream | null = null
        if (item.speech && this.ttsActive()) {
          try {
            stream = await (item.synth ??= this.synth(item))
          }
          catch (e) {
            if (!ttsSignal.aborted)
              this.voiceFailed(e)
          }
        }
        if (item.gen !== this.turnGen) {
          stream?.abort()
          continue
        }
        // Synthesize the next sentence while this one plays.
        const begin = () => {
          this.beginSentence(item)
          const n = this.queue[0]
          if (n && n.gen === item.gen && n.speech && this.ttsActive())
            n.synth ??= this.synth(n)
        }
        if (stream) {
          this.speaking = true
          this.emit()
          try {
            await this.speaker.play(stream, begin)
          }
          catch (e) {
            if (!ttsSignal.aborted)
              this.voiceFailed(e)
            if (!item.begun)
              begin()
          }
        }
        else {
          begin()
          if (item.text) {
            this.speaking = true
            this.emit()
            await this.speaker.pause(clamp(item.text.length * 60, 800, 8000))
          }
        }
        this.speaking = false
      }
    }
    finally {
      this.pumping = false
      this.speaking = false
      this.emit()
      for (const w of [...this.drainWaiters]) w()
    }
  }

  private voiceFailed(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    this.voiceFailUntil = Date.now() + 20_000
    const was = this.voiceState
    this.voiceState = /401|api key/i.test(msg) ? 'token' : 'down'
    if (was !== this.voiceState)
      this.sys(`Voice: ${msg}; showing text for now`, true)
    this.emit()
  }

  /** A sentence starts playing: its tags apply now. */
  private beginSentence(item: Item) {
    if (item.begun)
      return
    item.begun = true
    if (item.gen !== this.turnGen)
      return
    const lost = item.moves.length ? this.apply(item.moves) : false
    for (const c of item.chips)
      item.entry.parts.push({ t: 'chip', v: c.label, kind: c.kind === 'move' ? (lost ? 'lost' : 'move') : c.kind === 'sound' ? 'sound' : 'unknown' })
    if (item.text)
      item.entry.parts.push({ t: 'text', v: item.text })
    this.emit()
  }

  // ─── Motion ───────────────────────────────────────────────────────────────

  /** Apply moves to the device; returns true when they went nowhere (no control, or the safe word holds). */
  apply(moves: Move[]): boolean {
    if (this.safeHold) {
      // Only [end] still counts.
      if (moves.some(m => m.kind === 'end'))
        this.endAfter = true
      return true
    }
    const r = applyMoves(this.motion, moves, this.limits())
    this.motion = r.state
    if (r.moreMin)
      this.extend(r.moreMin)
    if (r.end && !r.moreMin)
      this.endAfter = true
    if (r.play !== null)
      void this.playVideo(r.play)
    // While her video plays, its script has the device: movement tags wait.
    const scripted = r.play !== null || this.videoPlaying()
    if (r.edge && !scripted)
      this.startEdge()
    else if (r.moved && this.edgeUntil)
      this.clearEdge()
    if (r.changed && !scripted)
      this.pushMotion()
    this.emit()
    return !this.control?.active
  }

  /** This session's length in minutes: the setting plus what the chat added. */
  sessionMin() {
    return this.settings().sessionMinutes + this.extraMin
  }

  /** The user asked to go on longer: more time, and a goodbye in progress is called off. */
  private extend(minutes: number) {
    const base = this.settings().sessionMinutes
    if (this.extraMin >= MAX_EXTRA_MIN)
      return
    // From the later of the planned end and now: asked for after time ran out,
    // "ten more" still means ten from here.
    const elapsed = Math.ceil((Date.now() - this.startedAt) / 60000)
    const end = Math.max(this.sessionMin(), elapsed) + Math.max(1, minutes)
    const before = this.sessionMin()
    this.extraMin = Math.min(MAX_EXTRA_MIN, end - base)
    this.finalSent = false
    this.endAfter = false
    this.sys(`Session extended by ${this.sessionMin() - before} min (now ${this.sessionMin()} min)`)
  }

  private pushMotion() {
    const c = this.control
    if (!c?.active)
      return
    const m = this.motion
    const edging = this.edgeUntil > Date.now()
    c.set({ ...(edging ? {} : { spm: m.spm }), depth: m.depth / 100, center: m.pos / 100, shape: m.shape })
    if (edging || m.spm === 0)
      c.hold()
  }

  private startEdge() {
    const ms = this.settings().edgeSeconds * 1000
    this.clearEdge()
    this.edgeUntil = Date.now() + ms
    this.edgeTimer = setTimeout(() => {
      this.edgeTimer = null
      this.edgeUntil = 0
      this.pushMotion()
      this.emit()
    }, ms)
  }

  private clearEdge() {
    if (this.edgeTimer)
      clearTimeout(this.edgeTimer)
    this.edgeTimer = null
    this.edgeUntil = 0
  }

  // ─── Lead mode ────────────────────────────────────────────────────────────

  private tick() {
    if (!this.running || this.safeHold)
      return
    const s = this.settings()
    const now = Date.now()
    if (s.lead && s.sessionMinutes > 0 && now - this.startedAt >= this.sessionMin() * 60_000 && !this.finalSent) {
      if (this.busy)
        return
      this.finalSent = true
      this.endAfter = true
      void this.turn(finalLine(this.status()))
      return
    }
    if (!s.lead || this.busy || this.finalSent)
      return
    const quiet = (now - this.lastActivity) / 1000
    if (this.videoPlaying()) {
      // Talk over the video: ahead of a harder part, and now and then.
      const sc = this.ctx.player.script?.() ?? null
      if (sc?.next?.kind === 'harder' && sc.next.inS <= 6 && now - this.lastVideoNudge > 20_000) {
        this.lastVideoNudge = now
        void this.turn(videoEventLine(this.status(), `a harder part starts in ${sc.next.inS} s`))
        return
      }
      if (quiet >= s.quietSeconds * 1.5 && now - this.lastVideoNudge > s.quietSeconds * 1000) {
        this.lastVideoNudge = now
        void this.turn(tickLine(this.status(), quiet))
      }
      return
    }
    if (quiet >= s.quietSeconds)
      void this.turn(tickLine(this.status(), quiet))
  }

  // ─── Status and storage ───────────────────────────────────────────────────

  /** Is the voice usable: key, voice id, and does Fish know both? (A cheap lookup, no speech.) */
  async refreshVoice() {
    const s = this.settings()
    const id = this.voiceId()
    this.voiceTitle = ''
    if (!s.voiceOn)
      this.voiceState = 'off'
    else if (!s.fishKey.trim())
      this.voiceState = 'nokey'
    else if (!id)
      this.voiceState = 'novoice'
    else
      this.voiceState = 'checking'
    this.emit()
    if (this.voiceState !== 'checking')
      return
    try {
      const v = await voiceInfo(this.ctx.net.fetch, { key: s.fishKey.trim(), model: s.fishModel }, id)
      if (id !== this.voiceId())
        return
      this.voiceState = v ? 'ok' : 'badvoice'
      this.voiceTitle = v?.title ?? ''
      if (v)
        this.voiceFailUntil = 0
    }
    catch (e) {
      this.voiceState = /key/i.test(String(e)) ? 'token' : 'down'
    }
    this.emit()
  }

  async saveLog() {
    try {
      if (this.settings().saveLog)
        await this.ctx.storage.set('lastLog', clone(this.log.filter(e => !e.old).slice(-LOG_MAX)))
      else
        await this.ctx.storage.del('lastLog')
    }
    catch (e) {
      this.ctx.log('could not save the log', e)
    }
  }

  async loadLog() {
    try {
      if (!this.settings().saveLog)
        return
      const old = await this.ctx.storage.get<LogEntry[]>('lastLog')
      if (Array.isArray(old) && old.length && !this.log.length) {
        this.log = old.map(e => ({ ...e, id: this.nextId++, old: true, pending: false }))
        this.emit()
      }
    }
    catch {}
  }

  clearLog() {
    this.log = []
    void this.ctx.storage.del('lastLog')
    this.emit()
  }

  dispose() {
    this.ears.dispose()
    this.stop('playmate switched off')
    clearInterval(this.tickTimer)
    this.cutAll()
    this.speaker.close()
    this.listeners.clear()
  }
}
