// The tool's ASCII output next to the deck's ASCII tile (Figma 44:275, the moodboard example) at 1:1, at densities
// 0.25, 0.5 and 0.75. The tile is scaled to the same row height as each render, so glyphs are compared at one size.
// Renders go through the engine's chain from a copy of src/light at HEAD with the working tree's ASCII files on top.
//   node prototypes/ascii/fidelity.mjs --name before --committed   (the ASCII files as committed at HEAD)
//   node prototypes/ascii/fidelity.mjs --name after                (the working tree's ASCII files)
//   -> out/fidelity/<name>/d<density>.jpg (tile | Ramp | Halo | Beam at 1:1, then each at 3x), the crops as PNG and
//      each full frame at 960 px as JPEG
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { OUT, ROOT, startPrototype } from './lib/server.mjs'

export const LOOKS = [
  { name: 'ramp-bold-s1', recipe: 'sunset.ramp', pack: 'bold', seed: 1, at: [1080, 690] },
  { name: 'halo-elemental-s2', recipe: 'contour.halo', pack: 'elemental', seed: 2, at: [1150, 640] },
  { name: 'beam-atmospheric-s1', recipe: 'contour.beam', pack: 'atmospheric', seed: 1, at: [640, 300] },
]
export const DENSITIES = [0.25, 0.5, 0.75]
export const rowsAt = (d) => Math.round(13 * 4 ** Math.min(1, Math.max(0, d)))
const CW = 420
const CH = 279
const ZOOM = 3

const argv = process.argv.slice(2)
const name = argv.includes('--name') ? argv[argv.indexOf('--name') + 1] : 'before'
const dir = path.join(OUT, 'fidelity', name)
fs.mkdirSync(dir, { recursive: true })

async function caption(input, width, text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="Menlo" font-size="12" fill="#ddd">${text}</text></svg>`
  const meta = await sharp(input).metadata()
  return sharp({ create: { width, height: meta.height + 22, channels: 3, background: '#111' } })
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      { input: await sharp(input).png().toBuffer(), left: 0, top: 22 },
    ])
    .png()
    .toBuffer()
}

export async function row(cells, cellW, gap = 6) {
  const metas = await Promise.all(cells.map((c) => sharp(c).metadata()))
  const h = Math.max(...metas.map((m) => m.height))
  return sharp({ create: { width: cells.length * cellW + (cells.length - 1) * gap, height: h, channels: 3, background: '#000' } })
    .composite(cells.map((input, i) => ({ input, left: i * (cellW + gap), top: 0 })))
    .png()
    .toBuffer()
}

export async function column(parts, gap = 6) {
  const metas = await Promise.all(parts.map((p) => sharp(p).metadata()))
  const width = Math.max(...metas.map((m) => m.width))
  let y = 0
  const layers = parts.map((input, i) => {
    const layer = { input, left: 0, top: y }
    y += metas[i].height + gap
    return layer
  })
  return sharp({ create: { width, height: y - gap, channels: 3, background: '#000' } }).composite(layers).png().toBuffer()
}

/** The tile at the row height of `rows` rows on a 1080 short side, cropped where all ten glyphs mix. */
export async function tileCrop(rows) {
  const rowPx = 1080 / rows
  const tile = await sharp(path.join(ROOT, 'artifacts/ascii/figma/44-275-ascii-tile-4x.png'))
    .flatten({ background: '#fff' })
    .resize({ width: Math.round((2176 * rowPx) / 67.6) })
    .png()
    .toBuffer()
  const meta = await sharp(tile).metadata()
  const w = Math.min(CW, meta.width - 10)
  const h = Math.min(CH, meta.height - 10)
  const crop = await sharp(tile).extract({ left: 8, top: Math.round(meta.height * 0.45), width: w, height: Math.min(h, meta.height - Math.round(meta.height * 0.45) - 2) }).png().toBuffer()
  return sharp({ create: { width: CW, height: CH, channels: 3, background: '#fff' } }).composite([{ input: crop, left: 0, top: 0 }]).png().toBuffer()
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const proto = await startPrototype({ overlay: !argv.includes('--committed') })
  try {
    for (const d of DENSITIES) {
      const rows = rowsAt(d)
      const tile = await tileCrop(rows)
      const ones = [await caption(tile, CW, `Figma 44:275 at ${rows} rows`)]
      const zooms = [await caption(await sharp(tile).extract({ left: 0, top: 0, width: CW / ZOOM, height: CH / ZOOM }).resize({ width: CW, kernel: 'nearest' }).png().toBuffer(), CW, `tile ${ZOOM}x`)]
      for (const look of LOOKS) {
        const key = proto.nextKey('fidelity')
        await proto.call('renderFrame', { ...look, width: 1920, height: 1080, supersample: 2, output: { ascii: d }, key })
        const frame = sharp(proto.take(key), { raw: { width: 1920, height: 1080, channels: 4 } }).removeAlpha()
        const [x, y] = look.at
        const crop = await frame.clone().extract({ left: x, top: y, width: CW, height: CH }).png().toBuffer()
        await sharp(crop).toFile(path.join(dir, `${look.name}-d${d}.png`))
        await frame.clone().resize({ width: 960 }).jpeg({ quality: 88 }).toFile(path.join(dir, `${look.name}-d${d}-full.jpg`))
        ones.push(await caption(crop, CW, `${look.name} density ${d} (${rows} rows) 1:1`))
        zooms.push(await caption(await sharp(crop).extract({ left: 0, top: 0, width: CW / ZOOM, height: CH / ZOOM }).resize({ width: CW, kernel: 'nearest' }).png().toBuffer(), CW, `${look.name} ${ZOOM}x`))
      }
      await sharp(await column([await row(ones, CW), await row(zooms, CW)])).jpeg({ quality: 90 }).toFile(path.join(dir, `d${d}.jpg`))
      console.log('wrote', path.join(dir, `d${d}.jpg`))
    }
  } finally {
    await proto.close()
  }
}
