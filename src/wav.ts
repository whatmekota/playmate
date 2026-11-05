/** Audio helpers: mono 16 kHz WAV for /asr, and s16le PCM from /tts. */

export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1)
    return channels[0]
  const n = Math.min(...channels.map(c => c.length))
  const out = new Float32Array(n)
  for (const c of channels) {
    for (let i = 0; i < n; i++)
      out[i] += c[i] / channels.length
  }
  return out
}

/** To another sample rate: averaging when going down (a box filter, against aliasing), linear when going up. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || !input.length)
    return input
  const ratio = from / to
  const n = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(n)
  if (ratio > 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio)
      const b = Math.min(input.length, Math.max(a + 1, Math.floor((i + 1) * ratio)))
      let sum = 0
      for (let j = a; j < b; j++)
        sum += input[j]
      out[i] = sum / (b - a)
    }
  }
  else {
    for (let i = 0; i < n; i++) {
      const x = i * ratio
      const a = Math.floor(x)
      const b = Math.min(input.length - 1, a + 1)
      out[i] = input[a] + (input[b] - input[a]) * (x - a)
    }
  }
  return out
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(bytes.buffer)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      bytes[o + i] = s.charCodeAt(i)
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF), true)
  }
  return bytes
}

/** s16le chunks (which may split a sample) -> float samples. */
export class PcmDecoder {
  private carry: number | null = null
  push(chunk: Uint8Array): Float32Array {
    let bytes = chunk
    if (this.carry !== null) {
      bytes = new Uint8Array(chunk.length + 1)
      bytes[0] = this.carry
      bytes.set(chunk, 1)
      this.carry = null
    }
    const n = bytes.length >> 1
    if (bytes.length & 1)
      this.carry = bytes[bytes.length - 1]
    const out = new Float32Array(n)
    const v = new DataView(bytes.buffer, bytes.byteOffset, n * 2)
    for (let i = 0; i < n; i++)
      out[i] = v.getInt16(i * 2, true) / 32768
    return out
  }
}
