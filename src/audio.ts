import type { TtsStream } from './fish'
import { SAMPLE_RATE } from './fish'
import { encodeWav, PcmDecoder } from './wav'

/** A short fade where the stream ran dry, so a late chunk doesn't click. */
const FADE_S = 0.006
/** Extra head start after a sentence ran dry, and its cap, seconds. */
const EXTRA_STEP_S = 0.5
const EXTRA_MAX_S = 1.5
/** How much of what Fish sent is kept for "Save audio", seconds. */
const KEEP_S = 120

/**
 * WebAudio playback of streamed TTS: chunks are scheduled back to back as
 * they arrive, after a short prebuffer. cut() stops everything at once
 * (barge-in, stop, panic).
 */
export class Speaker {
  /** The voice's analyser, once anything has played; null before. */
  get analyser(): AnalyserNode | null {
    return this.ac && this.ac.state !== 'closed' ? this.an : null
  }

  private ac: AudioContext | null = null
  private an: AnalyserNode | null = null
  private sources = new Set<AudioBufferSourceNode>()
  private gen = 0
  private wakers = new Set<() => void>()
  /** Grows when the stream runs dry, so later sentences start with more in hand. */
  private extra = 0
  /** The last KEEP_S seconds of raw audio as received (before any fades). */
  private kept: Float32Array[] = []
  private keptLen = 0
  /** Times the audio ran dry this session. */
  dryRuns = 0

  audio(): AudioContext {
    if (!this.ac || this.ac.state === 'closed') {
      // At Fish's own rate: chunks play as they came, with no resampling of
      // each little buffer on its own (which leaves a tiny step at every join).
      try {
        this.ac = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'playback' })
      }
      catch {
        this.ac = new AudioContext({ latencyHint: 'playback' })
      }
      // Everything she says passes through this on its way out, for the
      // panel's spectrogram.
      this.an = this.ac.createAnalyser()
      this.an.fftSize = 1024
      this.an.smoothingTimeConstant = 0.55
      this.an.connect(this.ac.destination)
    }
    if (this.ac.state === 'suspended')
      this.ac.resume().catch(() => {})
    return this.ac
  }

  /**
   * Play one sentence. `onStart` fires when its first audio is scheduled (or
   * at once if it has none). Resolves when it has played out or been cut.
   */
  async play(s: TtsStream, onStart: () => void): Promise<void> {
    const gen = this.gen
    const ac = this.audio()
    const dec = new PcmDecoder()
    const need = (s.prebuffer + this.extra) * s.rate
    const fade = Math.max(1, Math.round(FADE_S * s.rate))
    let pending: Float32Array[] = []
    let pendingLen = 0
    let started = false
    let next = 0
    // The last few ms of what came in are held back until the next chunk
    // arrives, so they join it seamlessly; if it is late, they go out faded.
    let tail: Float32Array | null = null
    let dried = false
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const emit = (samples: Float32Array) => {
      if (!samples.length)
        return
      const buf = ac.createBuffer(1, samples.length, s.rate)
      buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
      const src = ac.createBufferSource()
      src.buffer = buf
      src.connect(this.an ?? ac.destination)
      const at = Math.max(next, ac.currentTime + 0.04)
      src.start(at)
      next = at + buf.duration
      this.sources.add(src)
      src.onended = () => this.sources.delete(src)
    }
    const flush = (ranDry: boolean) => {
      if (flushTimer)
        clearTimeout(flushTimer)
      flushTimer = null
      if (!tail || gen !== this.gen)
        return
      for (let i = 0; i < tail.length; i++)
        tail[i] *= 1 - i / tail.length
      emit(tail)
      tail = null
      if (ranDry) {
        dried = true
        this.dryRuns++
        this.extra = Math.min(EXTRA_MAX_S, this.extra + EXTRA_STEP_S)
        console.warn(`[playmate] voice ran dry mid-sentence (${this.dryRuns} this session); head start now ${(s.prebuffer + this.extra).toFixed(1)} s`)
      }
    }
    const schedule = (samples: Float32Array) => {
      if (flushTimer)
        clearTimeout(flushTimer)
      let data = samples
      if (tail) {
        data = new Float32Array(tail.length + samples.length)
        data.set(tail)
        data.set(samples, tail.length)
        tail = null
      }
      else if (dried) {
        // Coming back after running dry: fade in instead of starting mid-wave.
        data = samples.slice()
        for (let i = 0; i < Math.min(fade, data.length); i++)
          data[i] *= i / fade
        dried = false
      }
      if (data.length > fade * 2) {
        tail = data.slice(data.length - fade)
        emit(data.subarray(0, data.length - fade))
      }
      else {
        tail = data.slice()
      }
      // If nothing more comes before what is scheduled runs out, let the
      // held tail out faded rather than stopping dead.
      const leftMs = (next - ac.currentTime) * 1000
      flushTimer = setTimeout(() => flush(true), Math.max(0, leftMs - 30))
    }
    const begin = () => {
      started = true
      onStart()
      if (pendingLen) {
        const all = new Float32Array(pendingLen)
        let o = 0
        for (const p of pending) {
          all.set(p, o)
          o += p.length
        }
        pending = []
        pendingLen = 0
        schedule(all)
      }
    }
    try {
      for (;;) {
        const { done, value } = await s.reader.read()
        if (gen !== this.gen || done || !value)
          break
        const f = dec.push(value)
        if (!f.length)
          continue
        this.keep(f, s.rate)
        if (started) {
          schedule(f)
        }
        else {
          pending.push(f)
          pendingLen += f.length
          if (pendingLen >= need)
            begin()
        }
      }
    }
    catch (e) {
      if (flushTimer)
        clearTimeout(flushTimer)
      if (gen === this.gen)
        throw e
    }
    if (gen !== this.gen) {
      if (flushTimer)
        clearTimeout(flushTimer)
      s.abort()
      return
    }
    if (!started)
      begin()
    flush(false)
    await this.until(() => next - ac.currentTime, gen)
  }

  private keep(samples: Float32Array, rate: number) {
    this.kept.push(samples)
    this.keptLen += samples.length
    while (this.kept.length > 1 && this.keptLen - this.kept[0].length > KEEP_S * rate) {
      this.keptLen -= this.kept[0].length
      this.kept.shift()
    }
  }

  /** The last couple of minutes of her voice exactly as Fish sent it, as a WAV; null if nothing yet. */
  savedAudio(): Blob | null {
    if (!this.keptLen)
      return null
    const all = new Float32Array(this.keptLen)
    let o = 0
    for (const k of this.kept) {
      all.set(k, o)
      o += k.length
    }
    return new Blob([encodeWav(all, SAMPLE_RATE) as BlobPart], { type: 'audio/wav' })
  }

  /** Wait while `left()` seconds remain, or until cut. Gives up a little after it should have ended. */
  private until(left: () => number, gen: number): Promise<void> {
    const deadline = Date.now() + Math.max(0, left()) * 1000 + 1500
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t)
        this.wakers.delete(done)
        resolve()
      }
      let t: ReturnType<typeof setTimeout>
      const check = () => {
        const l = left()
        if (gen !== this.gen || l <= 0.005 || Date.now() > deadline)
          return done()
        t = setTimeout(check, Math.min(250, l * 1000 + 5))
      }
      this.wakers.add(done)
      check()
    })
  }

  /** A pause that cut() ends early (pacing text when there is no voice). */
  pause(ms: number): Promise<void> {
    const gen = this.gen
    const end = Date.now() + ms
    return this.until(() => (end - Date.now()) / 1000, gen)
  }

  cut() {
    this.gen++
    for (const s of this.sources) {
      try {
        s.stop()
      }
      catch {}
    }
    this.sources.clear()
    for (const w of [...this.wakers]) w()
  }

  get playing() {
    return this.sources.size > 0
  }

  close() {
    this.cut()
    this.ac?.close().catch(() => {})
    this.ac = null
  }
}
