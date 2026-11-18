import type { Sample } from '../src/scope.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advance, IDLE_MS } from '../src/scope.ts'

test('positions as sent stay where they were sent; the line runs flat only once nothing comes', () => {
  const samples: Sample[] = [{ t: 1000, p: 0.2 }, { t: 1016, p: 0.4 }]
  advance(samples, 1030, () => 0.9)
  assert.deepEqual(samples, [{ t: 1000, p: 0.2 }, { t: 1016, p: 0.4 }])
  advance(samples, 1016 + IDLE_MS, () => 0.9)
  assert.deepEqual(samples.at(-1), { t: 1016 + IDLE_MS, p: 0.4 })
})

test('with nothing sent yet it starts where the stroke is, then holds the last one, and drops what left the window', () => {
  const samples: Sample[] = []
  advance(samples, 500, () => 0.5)
  assert.deepEqual(samples, [{ t: 500, p: 0.5 }])
  advance(samples, 500 + 7000, () => 0.6)
  assert.deepEqual(samples, [{ t: 7500, p: 0.5 }])
})
