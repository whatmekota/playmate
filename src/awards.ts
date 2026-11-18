import type { PluginAchievement, PluginContext } from './types'

/** playmate's own achievements, in playhound's Stats → Achievements. */
export const AWARDS: PluginAchievement[] = [
  { id: 'first-session', title: 'First date', description: 'Start a session with playmate', icon: '💬' },
  { id: 'out-loud', title: 'Out loud', description: 'Talk to her with push-to-talk', icon: '🎙️' },
  { id: 'her-pick', title: 'Her pick', description: 'Let her put on a video from your library', icon: '🎬' },
  { id: 'edges', title: 'On the edge', description: 'Let her hold you on the edge 10 times', icon: '⏸️', target: 10, tier: 2 },
  { id: 'all-the-way', title: 'All the way', description: 'Let her lead a session to the end', icon: '👑', tier: 2 },
]

/**
 * Earning them. Never throws: an achievement must not get in the way of a
 * session. Counts are kept in the plugin's storage, one at a time.
 */
export class Awards {
  private chain: Promise<void> = Promise.resolve()

  constructor(private ctx: Pick<PluginContext, 'achievements' | 'storage' | 'log'>) {}

  define() {
    try {
      this.ctx.achievements.define(AWARDS)
    }
    catch (e) {
      this.ctx.log('could not define achievements', e)
    }
  }

  unlock(id: string) {
    try {
      this.ctx.achievements.unlock(id)
    }
    catch {}
  }

  /** One more toward a counted one; resolves once it is stored and reported. */
  count(id: string): Promise<void> {
    this.chain = this.chain.then(async () => {
      const key = `count:${id}`
      const n = ((await this.ctx.storage.get<number>(key)) ?? 0) + 1
      await this.ctx.storage.set(key, n)
      this.ctx.achievements.progress(id, n)
    }).catch(() => {})
    return this.chain
  }
}
