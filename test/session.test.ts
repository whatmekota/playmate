import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Playmate } from '../src/session.ts'

/** Just enough of playhound for the session's bookkeeping. */
function fakeCtx(player: { playing: boolean, hasScript: boolean, title: string | null }) {
  const sets: unknown[] = []
  const noop = () => () => {}
  const ctx: any = {
    manifest: { id: 'playmate', name: 'playmate', version: '0' },
    settings: { get: () => undefined, all: () => ({}), set: () => {}, onChange: noop },
    storage: { get: async () => undefined, set: async () => {}, del: async () => {} },
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
    asset: () => null,
    log: () => {},
  }
  return { ctx, sets }
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
