import type { Playmate } from './session'
import type { PluginContext } from './types'

/**
 * The panel's live picture: the stroke's position over the last few seconds
 * (like playhound's Motion panel), and under it her voice as a waveform in
 * a pinkish grey, full height, which only fills in while she talks. Both
 * scroll at the same rate.
 */
const WINDOW_MS = 6000

export function scope(pm: Playmate, ctx: PluginContext): { el: HTMLElement, stop: () => void } {
  const trace = document.createElement('canvas')
  trace.className = 'pm-trace'
  const spec = document.createElement('canvas')
  spec.className = 'pm-voice'
  spec.title = 'Her voice'
  const el = document.createElement('div')
  el.className = 'pm-scope'
  el.setAttribute('aria-hidden', 'true')
  el.append(trace, spec)

  const samples: { t: number, p: number }[] = []
  let colors = { accent: '#d946ef', grid: 'rgba(255,255,255,.07)', voice: [190, 150, 200] as number[] }
  let wave: Float32Array<ArrayBuffer> | null = null
  let raf = 0
  let lastT = 0
  let carry = 0
  let frame = 0

  function readColors() {
    const cs = getComputedStyle(el)
    const accent = cs.getPropertyValue('--accent').trim() || colors.accent
    const grid = cs.getPropertyValue('--border').trim() || colors.grid
    // The voice in a pinkish grey: a little of the accent in the text's grey.
    const a = rgb(accent) ?? [217, 70, 239]
    const t = rgb(cs.getPropertyValue('--text').trim()) ?? [200, 200, 205]
    colors = { accent, grid, voice: a.map((v, i) => Math.round(v * 0.3 + t[i] * 0.7)) }
  }

  function fit(c: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth
    const h = c.clientHeight
    const W = Math.round(w * dpr)
    const H = Math.round(h * dpr)
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    return { w, h, dpr }
  }

  function drawTrace(now: number) {
    const { w, h, dpr } = fit(trace)
    const g = trace.getContext('2d')
    if (!g || !w)
      return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const inset = 5
    const y = (p: number) => inset + (1 - p) * (h - inset * 2)
    const x = (t: number) => w - ((now - t) / WINDOW_MS) * w
    g.strokeStyle = colors.grid
    g.lineWidth = 1
    g.setLineDash([3, 4])
    for (const p of [0, 0.5, 1]) {
      g.beginPath()
      g.moveTo(0, Math.round(y(p)) + 0.5)
      g.lineTo(w, Math.round(y(p)) + 0.5)
      g.stroke()
    }
    g.setLineDash([])
    if (samples.length < 2)
      return
    const path = () => {
      g.beginPath()
      samples.forEach((s, i) => (i ? g.lineTo(x(s.t), y(s.p)) : g.moveTo(x(s.t), y(s.p))))
    }
    const last = samples[samples.length - 1]
    path()
    g.save()
    g.lineTo(x(last.t), h)
    g.lineTo(x(samples[0].t), h)
    g.closePath()
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, colors.accent)
    grad.addColorStop(1, 'transparent')
    g.globalAlpha = 0.18
    g.fillStyle = grad
    g.fill()
    g.restore()
    path()
    g.strokeStyle = colors.accent
    g.lineWidth = 1.75
    g.lineJoin = 'round'
    g.stroke()
    g.beginPath()
    g.arc(x(last.t) - 3, y(last.p), 3, 0, Math.PI * 2)
    g.fillStyle = colors.accent
    g.fill()
  }

  function drawSpec(dt: number) {
    const { w } = fit(spec)
    const g = spec.getContext('2d')
    if (!g || !w)
      return
    carry += (dt * w) / WINDOW_MS
    const shift = Math.floor(carry)
    if (!shift)
      return
    carry -= shift
    const W = spec.width
    const H = spec.height
    const px = Math.min(W, Math.round(shift * (W / w)))
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalCompositeOperation = 'copy'
    g.drawImage(spec, -px, 0)
    g.globalCompositeOperation = 'source-over'

    const an = pm.speaker.analyser
    if (!an)
      return
    if (!wave || wave.length !== an.fftSize)
      wave = new Float32Array(an.fftSize)
    an.getFloatTimeDomainData(wave)
    // Peak and loudness of what is playing right now, as one column centred
    // on the middle line: the peak faint, the loudness solid inside it.
    let peak = 0
    let sum = 0
    for (const v of wave) {
      const a = Math.abs(v)
      if (a > peak)
        peak = a
      sum += v * v
    }
    const rms = Math.sqrt(sum / wave.length)
    if (peak < 0.004)
      return
    const [r, gr, b] = colors.voice
    const mid = H / 2
    // A little lift so quiet speech still reads; loud parts reach the edges.
    const ph = Math.min(1, peak * 1.3) * mid
    const rh = Math.min(1, rms * 3.2) * mid
    g.fillStyle = `rgba(${r},${gr},${b},0.35)`
    g.fillRect(W - px, mid - ph, px, ph * 2)
    g.fillStyle = `rgba(${r},${gr},${b},0.9)`
    g.fillRect(W - px, mid - rh, px, Math.max(1, rh * 2))
  }

  function tick(now: number) {
    const dt = lastT ? Math.min(250, now - lastT) : 0
    lastT = now
    samples.push({ t: now, p: ctx.motion.readout().pos })
    while (samples.length && now - samples[0].t > WINDOW_MS)
      samples.shift()
    if (frame++ % 30 === 0)
      readColors()
    drawTrace(now)
    drawSpec(dt)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    el,
    stop: () => cancelAnimationFrame(raf),
  }
}

/** #rgb, #rrggbb or rgb()/rgba() to [r, g, b]. */
function rgb(c: string): number[] | null {
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const s = hex[1].length === 3 ? [...hex[1]].map(x => x + x).join('') : hex[1]
    return [0, 2, 4].map(i => Number.parseInt(s.slice(i, i + 2), 16))
  }
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (m)
    return m[1].split(/[\s,/]+/).slice(0, 3).map(Number)
  return null
}
