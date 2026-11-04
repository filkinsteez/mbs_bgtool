// ASCII prototype runner.
//   node prototypes/ascii/run.mjs frames [--only name,...]           tool frames from src/light at HEAD -> out/frames/*.png
//   node prototypes/ascii/run.mjs glyphs                              stage glyphs next to Optimistic VF -> out/glyphs/compare.png
//   node prototypes/ascii/run.mjs filter --name v1 [--strength 1] [--knobs '{"mode":0}'] [--only name,...]
//                                                                     -> out/filtered/<name>/<frame>.jpg and sheet.jpg
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { OUT, startPrototype } from './lib/server.mjs'

export const FRAMES = [
  { name: 'ramp-bold-s1', recipe: 'sunset.ramp', pack: 'bold', seed: 1 },
  { name: 'ramp-elemental-s2', recipe: 'sunset.ramp', pack: 'elemental', seed: 2 },
  { name: 'ramp-atmospheric-s3', recipe: 'sunset.ramp', pack: 'atmospheric', seed: 3 },
  { name: 'bands-bold-s2', recipe: 'sunset.bands', pack: 'bold', seed: 2 },
  { name: 'bands-elemental-s3', recipe: 'sunset.bands', pack: 'elemental', seed: 3 },
  { name: 'bands-atmospheric-s1', recipe: 'sunset.bands', pack: 'atmospheric', seed: 1 },
  { name: 'blooms-bold-s1', recipe: 'sunset.blooms', pack: 'bold', seed: 1 },
  { name: 'blooms-atmospheric-s2', recipe: 'sunset.blooms', pack: 'atmospheric', seed: 2 },
  { name: 'rim-bold-s1', recipe: 'contour.rim', pack: 'bold', seed: 1 },
  { name: 'halo-elemental-s2', recipe: 'contour.halo', pack: 'elemental', seed: 2 },
  { name: 'beam-atmospheric-s1', recipe: 'contour.beam', pack: 'atmospheric', seed: 1 },
  { name: 'streaks-bold-s3', recipe: 'contour.streaks', pack: 'bold', seed: 3 },
  { name: 'ramp-bold-s4-9x16', recipe: 'sunset.ramp', pack: 'bold', seed: 4, width: 1080, height: 1920 },
  { name: 'rim-elemental-s3-9x16', recipe: 'contour.rim', pack: 'elemental', seed: 3, width: 1080, height: 1920 },
]

function parse(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true
      else {
        args[a.slice(2)] = next
        i++
      }
    } else args._.push(a)
  }
  return args
}

const args = parse(process.argv.slice(2))
const command = args._[0]
const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null
const frameDir = path.join(OUT, 'frames')

async function readRgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/** Stacks PNG buffers top to bottom on black, each at its own size. */
async function stack(buffers, gap = 6) {
  const metas = await Promise.all(buffers.map((b) => sharp(b).metadata()))
  const width = Math.max(...metas.map((m) => m.width))
  const height = metas.reduce((s, m) => s + m.height, 0) + gap * (buffers.length - 1)
  let y = 0
  const layers = buffers.map((input, i) => {
    const layer = { input, left: 0, top: y }
    y += metas[i].height + gap
    return layer
  })
  return sharp({ create: { width, height, channels: 3, background: '#000' } }).composite(layers).png().toBuffer()
}

async function label(buffer, width, text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28"><rect width="100%" height="100%" fill="#111"/><text x="8" y="19" font-family="Menlo" font-size="15" fill="#eee">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`
  const img = sharp(buffer)
  const meta = await img.metadata()
  return sharp({ create: { width, height: meta.height + 28, channels: 3, background: '#111' } })
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      { input: await img.toBuffer(), left: 0, top: 28 },
    ])
    .png()
    .toBuffer()
}

const proto = await startPrototype()
try {
  if (command === 'frames') {
    fs.mkdirSync(frameDir, { recursive: true })
    for (const f of FRAMES) {
      if (only && !only.has(f.name)) continue
      const width = f.width ?? 1920
      const height = f.height ?? 1080
      const key = proto.nextKey('frame')
      const result = await proto.call('renderFrame', { recipe: f.recipe, pack: f.pack, seed: f.seed, width, height, supersample: 2, key })
      await sharp(proto.take(key), { raw: { width, height, channels: 4 } }).removeAlpha().png().toFile(path.join(frameDir, `${f.name}.png`))
      console.log(`${f.name} ${width}x${height} ${result.ms.toFixed(0)} ms ${result.colors.join(' ')}`)
    }
  } else if (command === 'glyphs') {
    const dir = path.join(OUT, 'glyphs')
    const ramp = await proto.call('ramp')
    console.log('ink per glyph (cell share):', ramp.byGlyph.map((c, i) => `${' .:-=+*#%@'[i]} ${(c * 100).toFixed(2)}%`).join(', '))
    console.log('sorted ramp:', JSON.stringify(ramp.order.map((i) => ' .:-=+*#%@'[i]).join('')), ramp.coverage.map((c) => (c * 100).toFixed(2)).join(' '))
    // Same layout as glyphs.mjs (400 px font, 440 x 640 cells, baseline 460 px from the top), glyphs 1..9.
    const key = proto.nextKey('sdf')
    const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const sheet = await proto.call('sdfGlyphs', { ids, em: 400, cellW: 440, cellH: 640, baselineFromBottom: 640 - 460, key })
    const sdf = await sharp(proto.take(key), { raw: { width: sheet.width, height: sheet.height, channels: 4 } }).removeAlpha().png().toBuffer()
    const font = await sharp(path.join(dir, 'optimistic.png')).removeAlpha().extract({ left: 0, top: 0, width: sheet.width, height: 640 }).png().toBuffer()
    const top = await label(font, sheet.width, 'Optimistic VF Regular 400 px (canvas fillText)')
    const bottom = await label(sdf, sheet.width, 'ASCII stage glyphs, 400 px per em, 0.6 em cells')
    await sharp(await stack([top, bottom])).resize({ width: 2200 }).jpeg({ quality: 90 }).toFile(path.join(dir, 'compare.jpg'))
    console.log('wrote', path.join(dir, 'compare.jpg'))
  } else if (command === 'filter') {
    const name = typeof args.name === 'string' ? args.name : 'v1'
    const strength = args.strength !== undefined ? Number(args.strength) : 1
    const knobs = typeof args.knobs === 'string' ? JSON.parse(args.knobs) : {}
    const dir = path.join(OUT, 'filtered', name)
    fs.mkdirSync(dir, { recursive: true })
    const tiles = []
    for (const f of FRAMES) {
      if (only && !only.has(f.name)) continue
      const file = path.join(frameDir, `${f.name}.png`)
      if (!fs.existsSync(file)) continue
      const frame = await readRgba(file)
      const frameKey = proto.nextKey('in')
      proto.putBlob(frameKey, frame)
      const key = proto.nextKey('out')
      const result = await proto.call('filter', { frameKey, strength, seed: f.seed, knobs, key })
      const out = sharp(proto.take(key), { raw: { width: frame.width, height: frame.height, channels: 4 } }).removeAlpha()
      const png = await out.png().toBuffer()
      await sharp(png).jpeg({ quality: 92 }).toFile(path.join(dir, `${f.name}.jpg`))
      tiles.push({ name: f.name, png, width: frame.width, height: frame.height })
      console.log(`${f.name} grid ${result.grid.cols}x${result.grid.rows} cell ${result.grid.cellW.toFixed(2)}x${result.grid.cellH.toFixed(2)} ${result.ms.toFixed(1)} ms`)
    }
    // Sheet: original and filtered, each 640 px wide (landscape) or 320 px (portrait).
    const rows = []
    for (const t of tiles) {
      const w = t.width >= t.height ? 640 : 300
      const original = await sharp(path.join(frameDir, `${t.name}.png`)).resize({ width: w }).png().toBuffer()
      const filtered = await sharp(t.png).resize({ width: w }).png().toBuffer()
      const pair = await sharp({ create: { width: 2 * w + 8, height: Math.round((t.height / t.width) * w), channels: 3, background: '#111' } })
        .composite([
          { input: original, left: 0, top: 0 },
          { input: filtered, left: w + 8, top: 0 },
        ])
        .png()
        .toBuffer()
      rows.push(await label(pair, 2 * w + 8, `${t.name}  ${name} strength ${strength}`))
    }
    if (rows.length) {
      await sharp(await stack(rows)).jpeg({ quality: 85 }).toFile(path.join(dir, 'sheet.jpg'))
      console.log('wrote', path.join(dir, 'sheet.jpg'))
    }
  } else if (command === 'crops') {
    // 1:1 crops of filtered frames next to the Figma tile scaled to the same row height.
    //   crops --names v1,v2 --frame ramp-bold-s1 --at x,y [--size 640x400]
    const names = String(args.names ?? 'v1').split(',')
    const frameName = String(args.frame ?? 'ramp-bold-s1')
    const [x, y] = String(args.at ?? '0,0').split(',').map(Number)
    const [w, h] = String(args.size ?? '640x400').split('x').map(Number)
    const meta = await sharp(path.join(frameDir, `${frameName}.png`)).metadata()
    const rowPx = Math.min(meta.width, meta.height) / 26
    // The 4x tile export has 67.6 px rows (13 px x 1.3 x 4); scale it to this frame's row height.
    const tileFile = path.join(path.dirname(OUT), '../../artifacts/ascii/figma/44-275-ascii-tile-4x.png')
    const scale = rowPx / 67.6
    const tile = await sharp(tileFile).flatten({ background: '#fff' }).resize({ width: Math.round(2176 * scale) }).png().toBuffer()
    const tileMeta = await sharp(tile).metadata()
    const tileCrop = await sharp(tile).extract({ left: 0, top: Math.max(0, tileMeta.height - h), width: Math.min(w, tileMeta.width), height: Math.min(h, tileMeta.height) }).png().toBuffer()
    const parts = [await label(tileCrop, w, `Figma 44:275 at ${rowPx.toFixed(1)} px rows (bottom)`)]
    parts.push(await label(await sharp(path.join(frameDir, `${frameName}.png`)).extract({ left: x, top: y, width: w, height: h }).png().toBuffer(), w, `${frameName} unfiltered`))
    for (const name of names) {
      const file = path.join(OUT, 'filtered', name, `${frameName}.jpg`)
      if (!fs.existsSync(file)) continue
      parts.push(await label(await sharp(file).extract({ left: x, top: y, width: w, height: h }).png().toBuffer(), w, `${frameName} ${name}`))
    }
    const dir = path.join(OUT, 'crops')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${frameName}-${x}-${y}-${names.join('+')}.jpg`)
    // Side by side, two per row.
    const rows = []
    for (let i = 0; i < parts.length; i += 2) {
      const pair = parts.slice(i, i + 2)
      const metas = await Promise.all(pair.map((p) => sharp(p).metadata()))
      rows.push(
        await sharp({ create: { width: w * 2 + 8, height: Math.max(...metas.map((m) => m.height)), channels: 3, background: '#000' } })
          .composite(pair.map((p, k) => ({ input: p, left: k * (w + 8), top: 0 })))
          .png()
          .toBuffer(),
      )
    }
    await sharp(await stack(rows)).jpeg({ quality: 90 }).toFile(file)
    console.log('wrote', file)
  } else {
    console.log('usage: run.mjs frames | glyphs | filter --name v1 [--strength 1] [--knobs json] [--only a,b] | crops --names a,b --frame f --at x,y')
  }
} finally {
  await proto.close()
}
