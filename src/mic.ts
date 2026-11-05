import { downmix, encodeWav, resample } from './wav'

/** Push-to-talk recording. */
export class Mic {
  private rec: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private wantStop = false
  private opening: Promise<void> | null = null

  get recording() {
    return !!this.rec || !!this.opening
  }

  start(): Promise<void> {
    if (this.rec || this.opening)
      return this.opening ?? Promise.resolve()
    this.wantStop = false
    this.chunks = []
    this.opening = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
        if (this.wantStop) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        this.stream = stream
        const rec = new MediaRecorder(stream)
        rec.ondataavailable = (e) => {
          if (e.data.size)
            this.chunks.push(e.data)
        }
        rec.start()
        this.rec = rec
        this.startedAt = Date.now()
      }
      finally {
        this.opening = null
      }
    })()
    return this.opening
  }

  /** Stop and hand back the clip; null if there was none or it was too short to be speech. */
  async stop(): Promise<Blob | null> {
    this.wantStop = true
    if (this.opening)
      await this.opening.catch(() => {})
    const rec = this.rec
    if (!rec)
      return null
    const long = Date.now() - this.startedAt >= 300
    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }))
      rec.stop()
    })
    this.release()
    return long && blob.size ? blob : null
  }

  cancel() {
    this.wantStop = true
    try {
      if (this.rec && this.rec.state !== 'inactive')
        this.rec.stop()
    }
    catch {}
    this.release()
  }

  private release() {
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.rec = null
    this.chunks = []
  }
}

/** A recorded clip (webm/opus etc.) -> 16 kHz mono WAV. */
export async function toWav16k(blob: Blob, ac: BaseAudioContext): Promise<Uint8Array> {
  const decoded = await ac.decodeAudioData(await blob.arrayBuffer())
  const chans: Float32Array[] = []
  for (let c = 0; c < decoded.numberOfChannels; c++)
    chans.push(decoded.getChannelData(c))
  return encodeWav(resample(downmix(chans), decoded.sampleRate, 16000), 16000)
}

/** A recorded clip -> mono 16 kHz samples (for whisper on this PC). */
export async function toPcm16k(blob: Blob, ac: BaseAudioContext): Promise<Float32Array> {
  const decoded = await ac.decodeAudioData(await blob.arrayBuffer())
  const chans: Float32Array[] = []
  for (let c = 0; c < decoded.numberOfChannels; c++)
    chans.push(decoded.getChannelData(c))
  return resample(downmix(chans), decoded.sampleRate, 16000)
}
