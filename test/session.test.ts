import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Playmate } from '../src/session.ts'

/** Just enough of playhound for the session's bookkeeping. */
function fakeCtx(player: { playing: boolean, hasScript: boolean, title: string | null, audible?: boolean | null }, settings: Record<string, unknown> = {}) {
  const sets: unknown[] = []
  const unlocked: string[] = []
  const progress: [string, number][] = []
  const stored = new Map<string, unknown>()
  const noop = () => () => {}
  const ctx: any = {
    manifest: { id: 'playmate', name: 'playmate', version: '0' },
    settings: { get: () => undefined, all: () => settings, set: () => {}, onChange: noop },
    storage: { get: async (k: string) => stored.get(k), set: async (k: string, v: unknown) => void stored.set(k, v), del: async (k: string) => void stored.delete(k) },
    ui: { settings: () => {}, panel: () => {}, openPanel: () => {}, openSettings: () => {}, style: () => {}, toast: () => {} },
    player: { state: () => ({ ...player, time: 0, duration: 100 }), onChange: noop, script: () => null, frame: () => null },
    library: { list: async () => [], analyse: async () => {}, onChange: noop },
    playback: { play: async () => true, pause: () => {}, resume: () => {}, onEnded: noop },
    motion: {
      take: () => ({ active: true, set: (t: unknown) => sets.push(t), hold: () => {}, release: () => {} }),
      readout: () => ({ spm: 0, depth: 0, pos: 0.5, maxSpm: 150, device: true }),
    },
    safety: { panicked: () => false, onPanic: noop },
    net: { fetch: async () => new Response('') },
    achievements: { define: () => {}, unlock: (id: string) => unlocked.push(id) > 0, progress: (id: string, n: number) => progress.push([id, n]), unlocked: () => ({}) },
    asset: () => null,
    log: () => {},
  }
  return { ctx, sets, unlocked, progress }
}

test('movement tags wait while her video plays, and are reported as held for it', () => {
  const { ctx, sets } = fakeCtx({ playing: true, hasScript: true, title: 'clip.mp4' })
  const pm = new Playmate(ctx, { tickMs: 1e9 })
  pm.control = ctx.motion.take()
  pm.videoId = 'clip.mp4'
  const before = { ...pm.motion }
  assert.equal(pm.apply([{ kind: 'speed', value: 90 }]), 'video')
  assert.deepEqual(pm.motion, before)
  assert.equal(sets.length, 0)
  // More time still counts mid-video.
  assert.equal(pm.apply([{ kind: 'more', minutes: 5 }]), 'video')
  pm.dispose()
})

test('without a video they go through', () => {
  const { ctx, sets } = fakeCtx({ playing: false, hasScript: false, title: null })
  const pm = new Playmate(ctx, { tickMs: 1e9 })
  pm.control = ctx.motion.take()
  assert.equal(pm.apply([{ kind: 'speed', value: 90 }]), null)
  assert.equal(pm.motion.spm, 90)
  assert.equal(sets.length, 1)
  pm.dispose()
})

test('a scripted video he put on himself counts too, and pausing it gives the device back', () => {
  const player = { playing: true, hasScript: true, title: 'his.mp4' }
  const { ctx, sets } = fakeCtx(player)
  const pm = new Playmate(ctx, { tickMs: 1e9 })
  pm.control = ctx.motion.take()
  assert.equal(pm.apply([{ kind: 'speed', value: 90 }]), 'video')
  assert.equal(sets.length, 0)
  assert.equal(pm.currentVideoTitle(), 'his')
  player.playing = false
  assert.equal(pm.apply([{ kind: 'speed', value: 90 }]), null)
  assert.equal(sets.length, 1)
  pm.dispose()
})

test('over a video with its own sound she waits twice as long before talking over it', () => {
  // Quiet after 20 s by default: 30 s over a video, 60 s while its sound is heard.
  for (const [audible, quietS, talks] of [[false, 35, true], [null, 35, true], [true, 35, false], [true, 65, true]] as const) {
    const { ctx } = fakeCtx({ playing: true, hasScript: true, title: 'clip.mp4', audible }, { lead: true })
    const pm = new Playmate(ctx, { tickMs: 1e9 })
    const any = pm as any
    pm.running = true
    pm.startedAt = Date.now()
    pm.lastActivity = Date.now() - quietS * 1000
    any.tick()
    assert.equal(any.lastVideoNudge > 0, talks, `audible ${audible}, ${quietS} s quiet`)
    pm.dispose()
  }
})

test('her edges count toward On the edge, one at a time, kept in storage', async () => {
  const { ctx, progress } = fakeCtx({ playing: false, hasScript: false, title: null })
  const pm = new Playmate(ctx, { tickMs: 1e9 })
  pm.control = ctx.motion.take()
  pm.apply([{ kind: 'edge' }])
  pm.apply([{ kind: 'edge' }])
  await pm.awards.count('edges')
  assert.deepEqual(progress, [['edges', 1], ['edges', 2], ['edges', 3]])
  assert.equal(await ctx.storage.get('count:edges'), 3)
  pm.dispose()
})

test('starting a session earns First date', () => {
  const { ctx, unlocked } = fakeCtx({ playing: false, hasScript: false, title: null })
  const pm = new Playmate(ctx, { tickMs: 1e9 })
  pm.start()
  assert.ok(unlocked.includes('first-session'))
  pm.dispose()
})
