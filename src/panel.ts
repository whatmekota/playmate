import type { FishVoice } from './fish'
import type { LogEntry, Playmate } from './session'
import type { PluginContext } from './types'
import { parseVoiceId, searchVoices, voiceInfo } from './fish'
import { DEFAULT_MAIN, languageName } from './prompt'
import { scope } from './scope'
import { suggestedVoices } from './voices'
import { PTT_KEYS } from './settings'
import { LOCAL_MODELS } from './stt-local'

/** The panel in the Plugins drawer. Built fresh each time it opens; the session lives on without it. */

type Kid = Node | string | null | undefined | false

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false)
      continue
    if (k === 'class')
      el.className = String(v)
    else if (k === 'text')
      el.textContent = String(v)
    else if (k === 'value')
      (el as HTMLInputElement).value = String(v)
    else if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2), v as EventListener)
    else
      el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const k of kids) {
    if (k)
      el.append(k)
  }
  return el
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function debounce(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null
  const run = () => {
    if (t)
      clearTimeout(t)
    t = null
    fn()
  }
  const call = () => {
    if (t)
      clearTimeout(t)
    t = setTimeout(run, ms)
  }
  call.flush = () => {
    if (t)
      run()
  }
  return call
}

export function mountPanel(el: HTMLElement, pm: Playmate, ctx: PluginContext): () => void {
  const cleanups: (() => void)[] = []
  const root = h('div', { class: 'pm' })
  el.append(root)
  let view: 'chat' | 'prompts' = 'chat'
  let teardownView: (() => void) | null = null

  function show(v: 'chat' | 'prompts') {
    teardownView?.()
    root.replaceChildren()
    view = v
    teardownView = v === 'chat' ? chatView(root, pm, ctx, () => show('prompts')) : promptsView(root, pm, ctx, () => show('chat'))
  }
  show(view)
  cleanups.push(() => teardownView?.())

  return () => {
    for (const c of cleanups) c()
    root.remove()
  }
}

// ─── Chat ───────────────────────────────────────────────────────────────────

/** How a sound tag looks in the log: its own style per kind, ru and en. */
const SFX: [RegExp, string][] = [
  [/стон|moan/i, 'moan'],
  [/шеп|whisper/i, 'whisper'],
  [/рыч|growl|snarl/i, 'growl'],
  [/скул|whimper|whin/i, 'whimper'],
  [/дыш|breath|pant|gasp/i, 'breath'],
  [/смеё|смех|хихик|хохоч|laugh|giggl|chuckl/i, 'laugh'],
  [/мурл|purr/i, 'purr'],
  [/фырк|snort|scoff|huff/i, 'snort'],
  [/вздых|sigh/i, 'sigh'],
]

const SVG = 'http://www.w3.org/2000/svg'
function svg(w: number, hgt: number, ...kids: SVGElement[]): SVGSVGElement {
  const el = document.createElementNS(SVG, 'svg')
  el.setAttribute('width', String(w))
  el.setAttribute('height', String(hgt))
  el.setAttribute('viewBox', `0 0 ${w} ${hgt}`)
  el.setAttribute('aria-hidden', 'true')
  el.append(...kids)
  return el
}
function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs))
    el.setAttribute(k, String(v))
  return el
}

/** A stroke shape drawn small: two cycles of it. */
function shapeIcon(shape: string): SVGSVGElement {
  const w = 22
  const hgt = 10
  const pts: string[] = []
  for (let x = 0; x <= w; x++) {
    const ph = (x / w) * 2 % 1
    let v: number
    if (shape === 'sharp')
      v = 1 - Math.abs(2 * ph - 1)
    else if (shape === 'saw')
      v = ph < 0.75 ? ph / 0.75 : 1 - ((ph - 0.75) / 0.25) ** 2 * (3 - 2 * (ph - 0.75) / 0.25)
    else if (shape === 'pulse')
      v = ph < 0.18 ? 1 - ph / 0.18 * 0.1 : ph < 0.5 ? 0.9 - (ph - 0.18) / 0.32 * 0.9 : 0
    else if (shape === 'ease') {
      const tri = 1 - Math.abs(2 * ph - 1)
      v = tri < 0.5 ? 2 * tri * tri : 1 - 2 * (1 - tri) ** 2
    }
    else
      v = (1 - Math.cos(Math.PI * 2 * ph)) / 2
    pts.push(`${x},${(1.5 + (1 - v) * (hgt - 3)).toFixed(1)}`)
  }
  return svg(w, hgt, svgEl('polyline', { 'points': pts.join(' '), 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }))
}

/** Where on the shaft the stroke sits: a little track with a dot. */
function posIcon(frac: number): SVGSVGElement {
  const y = 1.5 + (1 - frac) * 9
  return svg(6, 12,
    svgEl('rect', { x: 2.25, y: 0.5, width: 1.5, height: 11, rx: 0.75, fill: 'currentColor', opacity: 0.3 }),
    svgEl('circle', { cx: 3, cy: y.toFixed(1), r: 2.4, fill: 'currentColor' }),
  )
}

/** Stroke length as a small bar. */
function depthBar(pct: number): HTMLElement {
  const bar = h('span', { class: 'pm-mv-bar' })
  bar.append(h('i', {}))
  ;(bar.firstChild as HTMLElement).style.width = `${Math.max(4, Math.min(100, pct))}%`
  return bar
}

/**
 * A movement tag as a little picture of what it does: speed with a depth bar,
 * a position dot, a stroke shape, edge and stop. Hotter the closer the speed
 * is to her top speed.
 */
function moveEl(label: string, held: 'lost' | 'video' | null, top: number): HTMLElement {
  const lost = !!held
  const v = label.toLowerCase().trim()
  const el = h('span', { class: 'pm-mv', title: label })
  if (held) {
    el.dataset.lost = held
    el.title = held === 'video'
      ? `${label}: not applied, the video's script drives the device`
      : `${label}: not applied, no control of the device`
  }
  const num = (re: RegExp) => {
    const m = v.match(re)
    return m ? Number(m[1]) : Number.NaN
  }
  const heatOf = (spm: number) => {
    if (!Number.isFinite(spm))
      return
    const f = spm / (top || 1)
    el.dataset.heat = f >= 0.7 ? 'hot' : f >= 0.4 ? 'warm' : 'cool'
  }
  let m: RegExpMatchArray | null
  if ((m = v.match(/^move\s*[:=]?\s*(\d+)%?[\s,]+(\d+)/))) {
    const spm = Number(m[1])
    const depth = Number(m[2])
    heatOf(spm)
    el.append(h('b', { text: String(spm) }), h('small', { text: '/min' }), depthBar(depth))
    if (!lost)
      el.title = `Speed ${spm}/min, depth ${depth}%`
  }
  else if (Number.isFinite(num(/^speed\s*[:=]?\s*(\d+)/))) {
    const spm = num(/^speed\s*[:=]?\s*(\d+)/)
    heatOf(spm)
    el.append(h('b', { text: String(spm) }), h('small', { text: '/min' }))
    if (!lost)
      el.title = `Speed ${spm}/min`
  }
  else if (Number.isFinite(num(/^depth\s*[:=]?\s*(\d+)/))) {
    const depth = num(/^depth\s*[:=]?\s*(\d+)/)
    el.append(h('small', { text: 'depth' }), depthBar(depth))
    if (!lost)
      el.title = `Depth ${depth}%`
  }
  else if ((m = v.match(/^pos\s*[:=]?\s*(low|bottom|mid|middle|high|top|\d+)/))) {
    const word = m[1]
    const frac = /low|bottom/.test(word) ? 0.1 : /mid/.test(word) ? 0.5 : /high|top/.test(word) ? 0.9 : Math.max(0, Math.min(1, Number(word) / 100))
    el.append(posIcon(frac), h('small', { text: /^\d/.test(word) ? `${word}%` : word.replace('bottom', 'low').replace('middle', 'mid').replace('top', 'high') }))
    if (!lost)
      el.title = `Position: ${word}`
  }
  else if ((m = v.match(/^shape\s*[:=]?\s*(sine|ease|pulse|saw|sharp)/))) {
    el.append(shapeIcon(m[1]), h('small', { text: m[1] }))
    if (!lost)
      el.title = `Stroke shape: ${m[1]}`
  }
  else if (/^edge/.test(v)) {
    el.dataset.kind = 'edge'
    el.append(svg(8, 9, svgEl('rect', { x: 0.5, y: 0.5, width: 2.4, height: 8, rx: 0.8, fill: 'currentColor' }), svgEl('rect', { x: 5.1, y: 0.5, width: 2.4, height: 8, rx: 0.8, fill: 'currentColor' })), h('small', { text: 'edge' }))
    if (!lost)
      el.title = 'Edge: a sudden stop, then holding still'
  }
  else if ((m = v.match(/^(?:more|extend|longer|prolong)\s*[:=]?\s*(\d+)?/))) {
    const min = m[1] ?? '10'
    el.dataset.kind = 'more'
    el.append(h('b', { text: `+${min}` }), h('small', { text: 'min' }))
    if (!lost)
      el.title = `Session made ${min} min longer`
  }
  else if ((m = v.match(/^(?:play|video|pick)\b\s*(.*)$/))) {
    el.dataset.kind = 'play'
    const q = m[1].trim() || 'something'
    el.append(h('b', { text: '▶' }), h('small', { text: q.length > 28 ? `${q.slice(0, 27)}…` : q }))
    if (!lost)
      el.title = `Puts on: ${q}`
  }
  else if (/^stop/.test(v)) {
    el.dataset.kind = 'stop'
    el.append(svg(8, 8, svgEl('rect', { x: 0.5, y: 0.5, width: 7, height: 7, rx: 1.2, fill: 'currentColor' })), h('small', { text: 'stop' }))
    if (!lost)
      el.title = 'Stop: holding still'
  }
  else {
    el.append(h('small', { text: label }))
  }
  return el
}

/** Text said in the heat of it: word by word, so each word can twitch on its own. */
function heatEl(text: string, heat: 'hot' | 'held'): HTMLElement {
  const el = h('span', { 'class': 'pm-heat', 'data-heat': heat })
  text.split(/(\s+)/).forEach((w, i) => {
    if (!w.trim()) {
      el.append(w)
      return
    }
    const s = document.createElement('span')
    s.textContent = w
    s.style.setProperty('--i', String(i))
    el.append(s)
  })
  return el
}

function sfxEl(label: string): HTMLElement {
  const fx = SFX.find(([re]) => re.test(label))?.[1] ?? 'other'
  const el = h('span', { 'class': 'pm-sfx', 'data-fx': fx, 'title': 'Performed by the voice' })
  // One span per letter, so the wavy kinds can move letter by letter.
  ;[...label].forEach((ch, i) => {
    const s = document.createElement('span')
    s.textContent = ch
    s.style.setProperty('--i', String(i))
    el.append(s)
  })
  return el
}

function chatView(root: HTMLElement, pm: Playmate, ctx: PluginContext, toPrompts: () => void): () => void {
  const startBtn = h('button', { class: 'pm-btn pm-primary', type: 'button' })
  const retakeBtn = h('button', { class: 'pm-btn', type: 'button', text: 'Take back', title: 'Something else took the stroke generator; take it back' })
  const charSel = h('select', { 'class': 'pm-sel pm-grow', 'aria-label': 'Character' })
  const leadBox = h('input', { type: 'checkbox' })
  const lead = h('label', { class: 'pm-switch', title: 'It runs the session by itself' }, leadBox, 'Lead')

  const dot = () => h('span', { class: 'pm-dot' })
  const brainDot = dot()
  const brainText = h('span')
  const brainSt = h('span', { class: 'pm-st' }, brainDot, brainText)
  const voiceDot = dot()
  const voiceText = h('span')
  const voiceSt = h('span', { class: 'pm-st' }, voiceDot, voiceText)
  const devDot = dot()
  const devText = h('span')
  const clock = h('span', { class: 'pm-clock' })
  const status = h('div', { class: 'pm-status' }, brainSt, voiceSt, h('span', { class: 'pm-st' }, devDot, devText), h('span', { class: 'pm-grow' }), clock)

  const meter = (label: string) => {
    const val = h('b')
    const bar = h('i')
    return { el: h('div', { class: 'pm-meter' }, h('div', { class: 'pm-meter-top' }, h('span', { text: label }), val), h('div', { class: 'pm-bar' }, bar)), val, bar }
  }
  const speed = meter('Speed')
  const depth = meter('Depth')
  const motionNote = h('div', { class: 'pm-motion-note' })
  const live = scope(pm, ctx)
  const motion = h('div', { class: 'pm-motion' }, live.el, speed.el, depth.el, motionNote)

  const log = h('div', { 'class': 'pm-log', 'role': 'log', 'aria-live': 'polite' })
  const input = h('input', { 'class': 'pm-in', 'type': 'text', 'placeholder': 'Say something…', 'aria-label': 'Message' })
  const sendBtn = h('button', { class: 'pm-btn', type: 'button', text: 'Send' })
  const micBtn = h('button', { 'class': 'pm-btn pm-mic', 'type': 'button', 'aria-label': 'Hold to talk' })
  micBtn.append(svg(14, 14,
    svgEl('rect', { 'x': 4.5, 'y': 1, 'width': 5, 'height': 8, 'rx': 2.5, 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': 1.4 }),
    svgEl('path', { 'd': 'M2.5 6.5a4.5 4.5 0 0 0 9 0M7 11v2', 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
  ))
  const camBtn = h('button', { 'class': 'pm-btn pm-mic', 'type': 'button', 'aria-label': 'Show her the video', 'title': 'Show her the video now (with what you typed, if anything)' })
  camBtn.append(svg(15, 14,
    svgEl('rect', { 'x': 1, 'y': 3.5, 'width': 13, 'height': 9, 'rx': 2, 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': 1.4 }),
    svgEl('path', { 'd': 'M5 3.5l1-2h3l1 2', 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }),
    svgEl('circle', { 'cx': 7.5, 'cy': 8, 'r': 2.3, 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': 1.4 }),
  ))
  /** What push-to-talk is doing, or why it can't, above the text box. */
  const earsLine = h('div', { class: 'pm-ears' })
  const promptsLink = h('button', { class: 'pm-link', type: 'button', text: 'Prompts' })
  const settingsLink = h('button', { class: 'pm-link', type: 'button', text: 'Settings' })
  const clearLink = h('button', { class: 'pm-link', type: 'button', text: 'Clear log' })
  const saveAudio = h('button', { class: 'pm-link', type: 'button', text: 'Save audio', title: 'The last two minutes of her voice exactly as Fish sent it, as a WAV file' })

  const wrap = h('div', { class: 'pm-view' },
    h('div', { class: 'pm-row' }, startBtn, retakeBtn, charSel, lead),
    status,
    motion,
    log,
    earsLine,
    h('div', { class: 'pm-row' }, input, camBtn, micBtn, sendBtn),
    h('div', { class: 'pm-row pm-foot' }, promptsLink, settingsLink, h('span', { class: 'pm-grow' }), saveAudio, clearLink),
  )
  root.append(wrap)

  startBtn.addEventListener('click', () => (pm.running ? pm.stop() : pm.start()))
  retakeBtn.addEventListener('click', () => pm.start())
  leadBox.addEventListener('change', () => pm.setLead(leadBox.checked))
  charSel.addEventListener('change', () => pm.selectChar(charSel.value))
  promptsLink.addEventListener('click', toPrompts)
  settingsLink.addEventListener('click', () => ctx.ui.openSettings())
  clearLink.addEventListener('click', () => pm.clearLog())
  saveAudio.addEventListener('click', () => {
    const blob = pm.speaker.savedAudio()
    if (!blob) {
      ctx.ui.toast('Nothing to save yet', { detail: 'Her voice is kept once she has spoken.' })
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `playmate-voice-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.wav`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  })
  const send = () => {
    const t = input.value
    input.value = ''
    pm.send(t)
  }
  sendBtn.addEventListener('click', send)
  camBtn.addEventListener('click', () => {
    if (pm.showFrame(input.value))
      input.value = ''
  })

  // ─── Push-to-talk ─────────────────────────────────────────────────────────
  const ears = pm.ears
  const localModel = () => pm.settings().sttLocalModel
  const needsInstall = () => pm.settings().sttEngine === 'local' && !ears.localInstalled[localModel()]
  if (pm.settings().sttEngine === 'local')
    void ears.checkLocal(localModel())
  micBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0)
      return
    if (needsInstall()) {
      if (ears.install)
        ears.cancelInstall()
      else
        void ears.installLocal(localModel())
      return
    }
    micBtn.setPointerCapture(e.pointerId)
    void ears.down()
  })
  const micUp = () => void ears.up()
  micBtn.addEventListener('pointerup', micUp)
  micBtn.addEventListener('pointercancel', micUp)
  micBtn.addEventListener('lostpointercapture', micUp)

  // The key: held anywhere in the window, except while typing in a box.
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(?:input|textarea|select)$/i.test(t.tagName))
  let keyHeld = false
  const onKeyDown = (e: KeyboardEvent) => {
    const s = pm.settings()
    if (s.sttEngine === 'off' || e.code !== s.pttKey || typing(e.target) || e.ctrlKey && e.code !== 'ControlRight' || e.metaKey)
      return
    // Ours: keep playhound's own shortcuts off this key.
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.repeat || keyHeld || needsInstall())
      return
    keyHeld = true
    void ears.down()
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (!keyHeld || e.code !== pm.settings().pttKey)
      return
    e.preventDefault()
    e.stopImmediatePropagation()
    keyHeld = false
    void ears.up()
  }
  // Letting go of the window counts as letting go of the key.
  const onBlur = () => {
    if (keyHeld) {
      keyHeld = false
      void ears.up()
    }
  }
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('blur', onBlur)

  function renderEars() {
    const s = pm.settings()
    const keyName = PTT_KEYS.find(k => k.value === s.pttKey)?.label ?? s.pttKey
    micBtn.style.display = s.sttEngine === 'off' ? 'none' : ''
    camBtn.style.display = pm.visionOn() && ctx.player.state().title ? '' : 'none'
    micBtn.dataset.state = ears.install ? 'installing' : ears.state
    let line = ''
    let tone = ''
    if (s.sttEngine === 'off') {
      line = ''
    }
    else if (ears.install) {
      line = `Installing whisper… ${Math.round(ears.install.fraction * 100)}% · ${ears.install.text} (click the mic to cancel)`
      tone = 'busy'
    }
    else if (needsInstall()) {
      const m = LOCAL_MODELS.find(x => x.id === localModel())
      line = `Whisper isn't installed here yet. Click the mic to download ${m ? `${m.label}` : 'it'}.`
      tone = 'warn'
    }
    else if (ears.state === 'recording' || ears.state === 'opening') {
      line = 'Listening… let go to send'
      tone = 'rec'
    }
    else if (ears.state === 'transcribing') {
      line = 'Hearing you…'
      tone = 'busy'
    }
    else if (ears.error) {
      line = ears.error
      tone = 'bad'
    }
    else if (!ears.enabled) {
      line = 'Speech recognition isn\'t set up; see Settings.'
      tone = 'warn'
    }
    else {
      line = `Hold ${keyName} or the mic to talk`
    }
    earsLine.textContent = line
    earsLine.dataset.tone = tone
    micBtn.title = needsInstall() ? 'Install whisper on this PC' : `Hold to talk (or hold ${keyName})`
  }
  renderEars()
  const offEars = ears.onChange(renderEars)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      send()
    }
  })

  let charSig = ''
  function renderChars() {
    const cur = pm.character().id
    const sig = `${cur}|${pm.chars.map(c => `${c.id}:${c.name}`).join(',')}`
    if (sig === charSig)
      return
    charSig = sig
    charSel.replaceChildren(...pm.chars.map(c => h('option', { value: c.id, text: c.name || c.id })))
    charSel.value = cur
  }

  function renderStatus() {
    const s = pm.settings()
    startBtn.textContent = pm.running ? 'Stop' : 'Start'
    startBtn.classList.toggle('pm-primary', !pm.running)
    retakeBtn.style.display = pm.motionLost ? '' : 'none'
    leadBox.checked = s.lead
    clock.textContent = pm.running ? `${mmss(Date.now() - pm.startedAt)} / ${pm.sessionMin()}:00` : ''
    renderChars()

    const b = pm.brainState === 'error' ? ['bad', 'brain error'] : pm.brainState === 'thinking' ? ['busy', 'thinking'] : pm.speaking ? ['busy', 'speaking'] : [pm.running ? 'ok' : '', s.brainKind === 'api' ? 'API' : 'local']
    brainDot.dataset.s = b[0]
    brainText.textContent = b[1]
    brainSt.title = pm.brainError || ''
    const v = ({
      off: ['', 'voice off'],
      unknown: ['', 'voice'],
      checking: ['busy', 'voice…'],
      ok: ['ok', pm.voiceTitle ? `voice: ${pm.voiceTitle}` : 'voice'],
      down: ['bad', 'voice down'],
      token: ['bad', 'voice: bad key'],
      nokey: ['warn', 'voice: no key'],
      novoice: ['warn', 'voice: none set'],
      badvoice: ['bad', 'voice: not found'],
    } as Record<string, string[]>)[pm.voiceState]
    voiceDot.dataset.s = v[0]
    voiceText.textContent = v[1]
    voiceSt.title = v[1]
    const r = ctx.motion.readout()
    const d = pm.safeHold ? ['warn', 'safe word'] : pm.motionLost ? ['warn', 'motion lost'] : !r.device ? ['', 'no device'] : pm.control?.active ? ['ok', 'device'] : ['', 'device idle']
    devDot.dataset.s = d[0]
    devText.textContent = d[1]

    const lim = pm.limits()
    const m = pm.motion
    const edging = pm.edgeUntil > Date.now()
    const still = edging || pm.safeHold
    speed.val.textContent = pm.safeHold ? 'stopped' : edging ? 'edge' : `${m.spm}/min`
    speed.bar.style.width = `${lim.maxSpm && !still ? Math.min(100, (m.spm / lim.maxSpm) * 100) : 0}%`
    depth.val.textContent = `${m.depth}%`
    depth.bar.style.width = `${m.depth}%`
    motionNote.textContent = pm.safeHold
      ? 'stopped by the safe word; talk to carry on'
      : edging
        ? `holding still ${Math.ceil((pm.edgeUntil - Date.now()) / 1000)} s, then back to ${m.spm}/min`
        : `pos ${m.pos}% · ${m.shape} · max ${lim.maxSpm}/min · device ${Math.round(r.spm)}/min`
    camBtn.style.display = pm.visionOn() && ctx.player.state().title ? '' : 'none'
    // Her video's script has the device: show that instead.
    if (pm.videoPlaying()) {
      const sc = ctx.player.script?.() ?? null
      if (sc) {
        speed.val.textContent = `${sc.spm}/min`
        speed.bar.style.width = `${Math.round(sc.level * 100)}%`
      }
      const next = sc?.next ? ` · ${sc.next.kind === 'harder' ? 'harder' : 'easier'} in ${sc.next.inS} s` : ''
      motionNote.textContent = `▶ ${pm.videoTitle} · the script drives${next}`
    }
  }

  let sig = ''
  function renderLog() {
    const last = pm.log.at(-1)
    const next = `${pm.log.length}:${pm.log[0]?.id}:${last?.id}:${last?.parts.length}:${last?.pending}`
    if (next === sig)
      return
    sig = next
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40
    log.replaceChildren()
    if (!pm.log.length) {
      log.append(h('div', { class: 'pm-empty', text: `Press Start, or just type to ${pm.character().name || 'your partner'}. Lead mode lets it run the session.` }))
      return
    }
    for (const e of pm.log)
      log.append(entryEl(e))
    if (nearBottom || last?.who === 'you')
      log.scrollTop = log.scrollHeight
  }

  function entryEl(e: LogEntry) {
    const div = h('div', { 'class': 'pm-msg', 'data-who': e.who, 'data-error': e.error, 'data-old': e.old, 'data-pending': e.pending })
    // Her words take on the heat of the stroke she set: pale and glowing,
    // twitching, past 70% of her top speed; ghostly while she holds an edge.
    const top = pm.limits().maxSpm || 1
    let heat: 'hot' | 'held' | null = null
    for (const p of e.parts) {
      if (p.t === 'chip' && p.kind === 'move') {
        const v = p.v.toLowerCase()
        const n = Number((v.match(/^(?:move|speed)\s*[:=]?\s*(\d+)/) ?? [])[1])
        if (/^edge/.test(v))
          heat = 'held'
        else if (/^stop/.test(v))
          heat = null
        else if (Number.isFinite(n))
          heat = n >= top * 0.7 ? 'hot' : null
      }
      if (p.t === 'chip' && p.kind === 'sound') {
        div.append(sfxEl(p.v), ' ')
      }
      else if (p.t === 'chip' && (p.kind === 'move' || p.kind === 'lost' || p.kind === 'video')) {
        div.append(moveEl(p.v, p.kind === 'move' ? null : p.kind, top), ' ')
      }
      else if (p.t !== 'chip' && heat && e.who !== 'you') {
        div.append(heatEl(p.v, heat), ' ')
      }
      else if (p.t === 'chip') {
        const title = p.kind === 'lost' ? 'Not applied: no control of the device' : p.kind === 'unknown' ? 'Not a known tag; dropped' : p.kind === 'sound' ? 'Performed by the voice' : ''
        div.append(h('span', { 'class': 'pm-chip', 'data-k': p.kind, 'text': p.v, 'title': title }), ' ')
      }
      else {
        div.append(`${p.v} `)
      }
    }
    return div
  }

  const render = () => {
    renderStatus()
    renderLog()
    renderEars()
  }
  render()
  const off = pm.onChange(render)
  const offSettings = ctx.settings.onChange(render)
  const timer = setInterval(renderStatus, 500)
  requestAnimationFrame(() => {
    log.scrollTop = log.scrollHeight
  })
  return () => {
    off()
    offSettings()
    offEars()
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onKeyUp, true)
    window.removeEventListener('blur', onBlur)
    if (keyHeld)
      void ears.up()
    clearInterval(timer)
    live.stop()
  }
}

// ─── Prompts ────────────────────────────────────────────────────────────────

function promptsView(root: HTMLElement, pm: Playmate, ctx: PluginContext, toChat: () => void): () => void {
  let editId = pm.character().id
  const fishCfg = () => {
    const s = pm.settings()
    return { key: s.fishKey.trim(), model: s.fishModel }
  }

  // Main prompt
  const mainArea = h('textarea', { 'class': 'pm-ta', 'rows': 9, 'spellcheck': 'false', 'aria-label': 'Main prompt' })
  mainArea.value = pm.mainPrompt()
  const mainReset = h('button', { class: 'pm-link', type: 'button', text: 'Reset to default' })
  const saveMain = debounce(() => pm.setMain(mainArea.value), 600)
  mainArea.addEventListener('input', saveMain)
  mainArea.addEventListener('blur', () => saveMain.flush())
  mainReset.addEventListener('click', () => {
    if (pm.main !== null && !window.confirm('Put the main prompt back to the default?'))
      return
    pm.resetMain()
    mainArea.value = DEFAULT_MAIN
  })

  // Character
  const charSel = h('select', { 'class': 'pm-sel pm-grow', 'aria-label': 'Character to edit' })
  const newBtn = h('button', { class: 'pm-btn pm-sm', type: 'button', text: 'New' })
  const delBtn = h('button', { class: 'pm-btn pm-sm pm-danger', type: 'button', text: 'Delete' })
  const useBtn = h('button', { class: 'pm-btn pm-sm', type: 'button', text: 'Use' })
  const nameIn = h('input', { 'class': 'pm-in', 'type': 'text', 'aria-label': 'Name' })
  // A plain list (a typed box with suggestions only offered what matched what was already in it).
  const LANG_CODES = ['en', 'ru', 'uk', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'ja', 'ko', 'zh']
  const langIn = h('select', { 'class': 'pm-sel', 'aria-label': 'Language' })
  const fillLangs = (cur: string) => {
    langIn.replaceChildren(
      h('option', { value: '', text: `Same as Settings (${languageName(pm.settings().language || 'en')})` }),
      ...LANG_CODES.map(c => h('option', { value: c, text: `${languageName(c)} (${c})` })),
      ...(cur && !LANG_CODES.includes(cur) ? [h('option', { value: cur, text: cur })] : []),
    )
    langIn.value = cur
  }
  const voiceIn = h('input', { 'class': 'pm-in', 'type': 'text', 'placeholder': 'Voice id or fish.audio/m/… link', 'aria-label': 'Voice' })
  const suggested = h('div', { class: 'pm-row pm-suggest' })
  const voiceNote = h('div', { class: 'pm-note' })
  const promptArea = h('textarea', { 'class': 'pm-ta', 'rows': 12, 'spellcheck': 'false', 'aria-label': 'Character prompt' })
  const charReset = h('button', { class: 'pm-link', type: 'button', text: 'Reset this character' })

  // Voice search
  const q = h('input', { 'class': 'pm-in', 'type': 'search', 'placeholder': 'Search the Fish voice library', 'aria-label': 'Search voices' })
  const onlyLang = h('input', { type: 'checkbox', checked: true })
  const onlyLangLabel = h('label', { class: 'pm-switch' }, onlyLang, h('span'))
  const searchBtn = h('button', { class: 'pm-btn pm-sm', type: 'button', text: 'Search' })
  const results = h('div', { class: 'pm-results' })

  const wrap = h('div', { class: 'pm-view pm-scroll' },
    h('div', { class: 'pm-row' }, h('button', { class: 'pm-link', type: 'button', text: '← Back', onclick: toChat }), h('span', { class: 'pm-title pm-grow', text: 'Prompts' }), h('button', { class: 'pm-link', type: 'button', text: 'Settings', onclick: () => ctx.ui.openSettings() })),
    h('div', { class: 'pm-sec' },
      h('div', { class: 'pm-row' }, h('span', { class: 'pm-label pm-grow', text: 'Main prompt' }), mainReset),
      h('div', { class: 'pm-note', text: 'Who it is in general, tone, consent. Every character gets it.' }),
      mainArea,
    ),
    h('div', { class: 'pm-sec' },
      h('div', { class: 'pm-row' }, h('span', { class: 'pm-label', text: 'Character' }), charSel, useBtn, newBtn, delBtn),
      h('label', { class: 'pm-field' }, h('span', { text: 'Name' }), nameIn),
      h('label', { class: 'pm-field' }, h('span', { text: 'Language' }), langIn),
      h('label', { class: 'pm-field' }, h('span', { text: 'Voice' }), voiceIn),
      voiceNote,
      suggested,
      h('div', { class: 'pm-row' }, q, searchBtn),
      h('div', { class: 'pm-row' }, onlyLangLabel),
      results,
      h('div', { class: 'pm-row' }, h('span', { class: 'pm-label pm-grow', text: 'Personality and style' }), charReset),
      promptArea,
    ),
  )
  root.append(wrap)

  const editing = () => pm.chars.find(c => c.id === editId) ?? pm.chars[0]
  const effLang = () => editing().language.trim() || pm.settings().language || 'en'

  /** One-click voices for the character's language. */
  function fillSuggested() {
    const list = suggestedVoices(effLang())
    suggested.style.display = list.length ? '' : 'none'
    suggested.replaceChildren(
      h('span', { class: 'pm-note', text: 'Suggested:' }),
      ...list.map((v) => {
        const b = h('button', { 'class': 'pm-vchip', 'type': 'button', 'title': v.note, 'aria-pressed': String(v.id === editing().voice) })
        b.append(h('span', { text: v.title }))
        b.addEventListener('click', () => {
          voiceIn.value = v.id
          pm.updateChar(editId, { voice: v.id })
          fillSuggested()
          void checkVoice()
        })
        return b
      }),
    )
  }

  function fill() {
    const c = editing()
    editId = c.id
    charSel.replaceChildren(...pm.chars.map(x => h('option', { value: x.id, text: `${x.name || x.id}${x.id === pm.character().id ? ' (in use)' : ''}` })))
    charSel.value = c.id
    nameIn.value = c.name
    fillLangs(c.language)
    voiceIn.value = c.voice
    promptArea.value = c.prompt
    const isDefault = pm.isDefaultChar(c.id)
    delBtn.style.display = isDefault ? 'none' : ''
    charReset.style.display = isDefault ? '' : 'none'
    useBtn.style.display = c.id === pm.character().id ? 'none' : ''
    ;(onlyLangLabel.lastChild as HTMLElement).textContent = `Only ${languageName(effLang())} voices`
    results.replaceChildren()
    fillSuggested()
    void checkVoice()
  }

  let voiceCheck = 0
  async function checkVoice() {
    const n = ++voiceCheck
    const raw = voiceIn.value.trim()
    const id = parseVoiceId(raw)
    if (!raw) {
      voiceNote.textContent = pm.settings().defaultVoice ? 'Uses the fallback voice from Settings.' : 'No voice: it will show text only.'
      return
    }
    if (!id) {
      voiceNote.textContent = 'That is not a voice id or a fish.audio/m/… link.'
      return
    }
    if (!fishCfg().key) {
      voiceNote.textContent = `Voice ${id}. Add the Fish Audio key in Settings to check it.`
      return
    }
    voiceNote.textContent = 'Checking…'
    try {
      const v = await voiceInfo(ctx.net.fetch, fishCfg(), id)
      if (n === voiceCheck)
        voiceNote.textContent = v ? `${v.title}${v.languages.length ? ` · ${v.languages.join(', ')}` : ''}` : 'Fish Audio has no public voice with that id.'
    }
    catch (e) {
      if (n === voiceCheck)
        voiceNote.textContent = `Couldn't check: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  const save = debounce(() => pm.updateChar(editId, { name: nameIn.value, language: langIn.value.trim(), prompt: promptArea.value }), 600)
  for (const x of [nameIn, promptArea]) {
    x.addEventListener('input', save)
    x.addEventListener('blur', () => save.flush())
  }
  langIn.addEventListener('change', () => {
    save.flush()
    fill()
  })
  voiceIn.addEventListener('change', () => {
    const raw = voiceIn.value.trim()
    const id = parseVoiceId(raw)
    if (id && id !== raw)
      voiceIn.value = id
    pm.updateChar(editId, { voice: id ?? raw })
    fillSuggested()
    void checkVoice()
  })
  charSel.addEventListener('change', () => {
    save.flush()
    editId = charSel.value
    fill()
  })
  useBtn.addEventListener('click', () => {
    save.flush()
    pm.selectChar(editId)
    fill()
  })
  newBtn.addEventListener('click', () => {
    save.flush()
    editId = pm.addChar().id
    fill()
    nameIn.focus()
    nameIn.select()
  })
  delBtn.addEventListener('click', () => {
    if (!window.confirm(`Delete ${editing().name || 'this character'}?`))
      return
    pm.deleteChar(editId)
    editId = pm.character().id
    fill()
  })
  charReset.addEventListener('click', () => {
    if (!window.confirm(`Put ${editing().name} back to the default?`))
      return
    pm.resetChar(editId)
    fill()
  })

  async function search() {
    results.replaceChildren(h('div', { class: 'pm-note', text: 'Searching…' }))
    try {
      const list = await searchVoices(ctx.net.fetch, fishCfg(), q.value, { language: onlyLang.checked ? effLang() : undefined })
      results.replaceChildren(...(list.length ? list.map(resultEl) : [h('div', { class: 'pm-note', text: 'Nothing found.' })]))
    }
    catch (e) {
      results.replaceChildren(h('div', { class: 'pm-note pm-bad', text: e instanceof Error ? e.message : String(e) }))
    }
  }
  function resultEl(v: FishVoice) {
    const use = h('button', { class: 'pm-btn pm-sm', type: 'button', text: 'Use' })
    use.addEventListener('click', () => {
      voiceIn.value = v.id
      pm.updateChar(editId, { voice: v.id })
      fillSuggested()
      voiceNote.textContent = `${v.title}${v.languages.length ? ` · ${v.languages.join(', ')}` : ''}`
    })
    return h('div', { class: 'pm-result' },
      h('div', { class: 'pm-grow' },
        h('div', { class: 'pm-result-title', text: v.title }),
        h('div', { class: 'pm-note', text: [v.languages.join(', '), `♥ ${v.likes}`, v.author && `by ${v.author}`].filter(Boolean).join(' · ') }),
      ),
      use,
    )
  }
  searchBtn.addEventListener('click', () => void search())
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void search()
    }
  })
  onlyLang.addEventListener('change', () => {
    if (results.childElementCount)
      void search()
  })

  fill()
  return () => {
    saveMain.flush()
    save.flush()
  }
}
