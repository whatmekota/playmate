// Builds dist/index.js (one self-contained ES module) and the plugin zip
// (manifest.json + index.js at the root, deflated).
//   node build.mjs [--minify] [--public]
// Without --public, keys in a local .env (VENICE_API_KEY, ABLITERATION_API_KEY,
// FISH_API_KEY) are baked in as built-in keys, for your own copy: that zip
// (playmate.zip) carries them, so don't share it. The values are never printed.
// --public ignores .env entirely and writes release/playmate-<version>.zip and
// release/manifest.json, the files a GitHub release needs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const esbuild = await import('esbuild')
const PUBLIC = process.argv.includes('--public')

/** KEY=VALUE lines; # comments; optional quotes. Missing file -> {}. */
function readEnv(file) {
  const out = {}
  if (!existsSync(file))
    return out
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#'))
      continue
    const m = /^(?:export\s+)?([\w.]+)\s*=\s*(.*)$/.exec(t)
    if (!m)
      continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\'')))
      v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

const env = PUBLIC ? {} : readEnv(join(here, '.env'))
const keys = {
  venice: env.VENICE_API_KEY ?? '',
  abliteration: env.ABLITERATION_API_KEY ?? '',
  fish: env.FISH_API_KEY ?? '',
}
const baked = Object.values(keys).filter(Boolean).length

const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))

await esbuild.build({
  entryPoints: [join(here, 'src/index.ts')],
  outfile: join(here, 'dist/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  minify: process.argv.includes('--minify'),
  banner: { js: `// playmate ${manifest.version}` },
  define: { __PLAYMATE_KEYS__: JSON.stringify(keys) },
  logLevel: 'warning',
})

// ─── zip (deflate, no zip64) ─────────────────────────────────────────────────
function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  const time = 0
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const packed = deflateRawSync(data, { level: 9 })
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + packed.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

mkdirSync(join(here, 'dist'), { recursive: true })
const out = zip([
  ['manifest.json', readFileSync(join(here, 'manifest.json'))],
  ['index.js', readFileSync(join(here, 'dist/index.js'))],
])
if (PUBLIC) {
  mkdirSync(join(here, 'release'), { recursive: true })
  writeFileSync(join(here, 'release', `playmate-${manifest.version}.zip`), out)
  // The store in playhound reads this to show the plugin before downloading it.
  writeFileSync(join(here, 'release', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}
else {
  writeFileSync(join(here, 'playmate.zip'), out)
}
console.log(`playmate.zip: ${out.length} bytes (v${manifest.version}), ${baked} built-in key${baked === 1 ? '' : 's'}${baked ? ' (do not share this zip)' : ''}`)
