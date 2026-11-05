import type { FetchFn } from './brain'
import type { SttCfg } from './stt'
import type { LocalModelId } from './stt-local'
import { Mic } from './mic'
import { transcribe } from './stt'
import * as local from './stt-local'

export type EarsState = 'idle' | 'opening' | 'recording' | 'transcribing'

/**
 * Push-to-talk: hold to record, let go to transcribe. Also installs the local
 * whisper model on request. Talks to the session through two callbacks:
 * `onBargeIn` when you start talking (cut her off), `onText` with what you said.
 */
export class Ears {
  state: EarsState = 'idle'
  error = ''
  /** Local whisper: installed, and a running install's progress. */
  localInstalled: Record<string, boolean> = {}
  install: { model: LocalModelId, fraction: number, text: string } | null = null
  private mic = new Mic()
  private ctrl: AbortController | null = null
  private installCtrl: AbortController | null = null
  private listeners = new Set<() => void>()

  constructor(
    private fetchFn: FetchFn,
    private cfg: () => SttCfg | null,
    private language: () => string,
    private audio: () => BaseAudioContext,
    private onBargeIn: () => void,
    private onText: (text: string) => void,
    private log: (...a: unknown[]) => void,
  ) {}

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) {
      try {
        fn()
      }
      catch {}
    }
  }

  get enabled() {
    return !!this.cfg()
  }

  /** Whether the configured engine can be used now (local needs its model installed). */
  ready(): boolean {
    const c = this.cfg()
    if (!c)
      return false
    return c.kind !== 'local' || !!this.localInstalled[c.model]
  }

  async checkLocal(model: LocalModelId) {
    try {
      this.localInstalled[model] = await local.isInstalled(model)
    }
    catch {
      this.localInstalled[model] = false
    }
    this.emit()
  }

  async installLocal(model: LocalModelId) {
    if (this.install)
      return
    this.installCtrl = new AbortController()
    this.install = { model, fraction: 0, text: 'Starting…' }
    this.error = ''
    this.emit()
    try {
      await local.install(model, (fraction, text) => {
        if (this.install) {
          this.install = { model, fraction, text }
          this.emit()
        }
      }, this.installCtrl.signal)
      this.localInstalled[model] = true
    }
    catch (e) {
      if (!this.installCtrl?.signal.aborted)
        this.error = `Install failed: ${e instanceof Error ? e.message : String(e)}`
    }
    finally {
      this.install = null
      this.installCtrl = null
      this.emit()
    }
  }

  cancelInstall() {
    this.installCtrl?.abort()
  }

  async removeLocal(model: LocalModelId) {
    await local.remove(model)
    this.localInstalled[model] = false
    this.emit()
  }

  /** Start recording (key or button down). */
  async down() {
    if (this.state === 'opening' || this.state === 'recording')
      return
    if (!this.ready())
      return
    // Talking over a transcription still in flight: drop it.
    this.ctrl?.abort()
    this.onBargeIn()
    this.error = ''
    this.state = 'opening'
    this.emit()
    try {
      await this.mic.start()
      if (this.state === 'opening') {
        this.state = 'recording'
        this.emit()
      }
    }
    catch (e) {
      this.state = 'idle'
      this.error = e instanceof Error && e.name === 'NotAllowedError' ? 'The microphone is blocked' : `Microphone: ${e instanceof Error ? e.message : String(e)}`
      this.emit()
    }
  }

  /** Stop recording and transcribe (key or button up). */
  async up() {
    if (this.state !== 'opening' && this.state !== 'recording')
      return
    const clip = await this.mic.stop()
    const c = this.cfg()
    if (!clip || !c) {
      this.state = 'idle'
      this.emit()
      return
    }
    this.state = 'transcribing'
    this.emit()
    const ctrl = new AbortController()
    this.ctrl = ctrl
    try {
      const text = await transcribe(this.fetchFn, c, clip, this.audio(), this.language(), ctrl.signal)
      if (ctrl.signal.aborted)
        return
      if (text)
        this.onText(text)
      else
        this.error = 'Didn\'t catch that'
    }
    catch (e) {
      if (!ctrl.signal.aborted) {
        this.error = e instanceof Error ? e.message : String(e)
        this.log('speech recognition failed', e)
      }
    }
    finally {
      if (this.ctrl === ctrl) {
        this.ctrl = null
        this.state = 'idle'
        this.emit()
      }
    }
  }

  /** Drop whatever is going on (panic, stop, deactivate). */
  cancel() {
    this.ctrl?.abort()
    this.ctrl = null
    this.mic.cancel()
    if (this.state !== 'idle') {
      this.state = 'idle'
      this.emit()
    }
  }

  dispose() {
    this.cancel()
    this.installCtrl?.abort()
    local.dispose()
  }
}
