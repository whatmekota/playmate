import type { PluginContext } from './types'
import { mountPanel } from './panel'
import { Playmate } from './session'
import { fields } from './settings'
import { CSS } from './style'

/**
 * playmate: an AI partner that talks (Fish Audio voice) and drives the
 * stroker through movement tags in its replies. Typing in; lead mode lets it
 * run a session by itself.
 */
/** The rail button's icon: a speech bubble with a heart in it. */
const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 2.8h10.8a1.1 1.1 0 0 1 1.1 1.1v6.4a1.1 1.1 0 0 1-1.1 1.1H7.2l-3.1 2.4v-2.4H2.6a1.1 1.1 0 0 1-1.1-1.1V3.9a1.1 1.1 0 0 1 1.1-1.1z"/><path d="M8 9.1C6.5 8.1 5.7 7.3 5.7 6.4c0-.7.5-1.2 1.1-1.2.5 0 .9.3 1.2.8.3-.5.7-.8 1.2-.8.6 0 1.1.5 1.1 1.2 0 .9-.8 1.7-2.3 2.7z"/></svg>'

export default async function activate(ctx: PluginContext) {
  const pm = new Playmate(ctx)
  await pm.loadPrompts()

  ctx.ui.style(CSS)
  ctx.ui.settings(fields(ctx, ctx.net.fetch, {
    maxAppSpm: () => ctx.motion.readout().maxSpm,
    characters: async () => pm.chars.map(c => ({ value: c.id, label: c.name || c.id })),
  }))
  ctx.ui.panel({ title: 'playmate', icon: ICON, mount: el => mountPanel(el, pm, ctx) })

  const offPanic = ctx.safety.onPanic(() => pm.panic())
  // Voice settings changed: check the voice again (debounced; keys are typed).
  let voiceTimer: ReturnType<typeof setTimeout> | null = null
  let lastVoice = ''
  const offSettings = ctx.settings.onChange((v) => {
    const sig = [v.voiceOn, v.fishKey, v.fishModel, v.defaultVoice, v.character].join('|')
    if (sig === lastVoice)
      return
    lastVoice = sig
    if (voiceTimer)
      clearTimeout(voiceTimer)
    voiceTimer = setTimeout(() => void pm.refreshVoice(), 800)
  })
  void pm.loadLog()
  void pm.refreshVoice()

  return () => {
    if (voiceTimer)
      clearTimeout(voiceTimer)
    offPanic()
    offSettings()
    pm.dispose()
  }
}
