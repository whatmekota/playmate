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
export default async function activate(ctx: PluginContext) {
  const pm = new Playmate(ctx)
  await pm.loadPrompts()

  ctx.ui.style(CSS)
  ctx.ui.settings(fields(ctx, ctx.net.fetch, {
    maxAppSpm: () => ctx.motion.readout().maxSpm,
    characters: async () => pm.chars.map(c => ({ value: c.id, label: c.name || c.id })),
  }))
  ctx.ui.panel({ title: 'playmate', mount: el => mountPanel(el, pm, ctx) })

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
