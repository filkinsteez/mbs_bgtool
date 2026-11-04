// Audit sheets from engine-check.mjs output (out/engine/s50, out/engine/s100):
//   out/engine/sheet-full.jpg   every look: off | ASCII 0.5 | ASCII 1, 1920x1080 frames shown at 600 px
//   out/engine/sheet-crops.jpg  1:1 crops at 1080 next to the Figma tile scaled to the same 41.5 px rows
import path from 'node:path'
import sharp from 'sharp'
import { OUT, ROOT } from './lib/server.mjs'

const dir = path.join(OUT, 'engine')
const NAMES = ['ramp-bold-s1', 'bands-elemental-s3', 'blooms-atmospheric-s2', 'rim-bold-s1', 'halo-elemental-s2', 'beam-atmospheric-s1', 'streaks-bold-s3']

async function caption(input, width, text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="26"><rect width="100%" height="100%" fill="#111"/><text x="6" y="18" font-family="Menlo" font-size="14" fill="#ddd">${text}</text></svg>`
  const meta = await sharp(input).metadata()
  return sharp({ create: { width, height: meta.height + 26, channels: 3, background: '#111' } })
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      { input: await sharp(input).png().toBuffer(), left: 0, top: 26 },
    ])
    .png()
    .toBuffer()
}

async function grid(cells, columns, cellW, gap = 6) {
  const metas = await Promise.all(cells.map((c) => sharp(c).metadata()))
  const rowH = Math.max(...metas.map((m) => m.height))
  const rows = Math.ceil(cells.length / columns)
  return sharp({ create: { width: columns * cellW + (columns - 1) * gap, height: rows * rowH + (rows - 1) * gap, channels: 3, background: '#000' } })
    .composite(cells.map((input, i) => ({ input, left: (i % columns) * (cellW + gap), top: Math.floor(i / columns) * (rowH + gap) })))
    .png()
    .toBuffer()
}

const W = 600
const full = []
for (const name of NAMES) {
  for (const [label, file] of [
    ['off', path.join(dir, 's100', `${name}-1080-off.jpg`)],
    ['ASCII 0.5', path.join(dir, 's50', `${name}-1080.jpg`)],
    ['ASCII 1', path.join(dir, 's100', `${name}-1080.jpg`)],
  ]) {
    full.push(await caption(await sharp(file).resize({ width: W }).png().toBuffer(), W, `${name}  ${label}`))
  }
}
await sharp(await grid(full, 3, W)).jpeg({ quality: 86 }).toFile(path.join(dir, 'sheet-full.jpg'))

// 1:1 crops, 480 x 300 at 1080 (41.5 px rows). The tile's 4x export has 67.6 px rows.
const CW = 480
const CH = 300
const tile = await sharp(path.join(ROOT, 'artifacts/ascii/figma/44-275-ascii-tile-4x.png'))
  .flatten({ background: '#fff' })
  .resize({ width: Math.round((2176 * (1080 / 26)) / 67.6) })
  .png()
  .toBuffer()
const tileMeta = await sharp(tile).metadata()
const crops = [
  await caption(await sharp(tile).extract({ left: 20, top: tileMeta.height - CH - 10, width: CW, height: CH }).png().toBuffer(), CW, 'Figma 44:275, same row height'),
  await caption(await sharp(tile).extract({ left: 20, top: 10, width: CW, height: CH }).png().toBuffer(), CW, 'Figma 44:275, top rows'),
]
const SPOTS = [
  ['ramp-bold-s1', 700, 120],
  ['ramp-bold-s1', 300, 600],
  ['bands-elemental-s3', 600, 180],
  ['blooms-atmospheric-s2', 200, 300],
  ['halo-elemental-s2', 1100, 700],
  ['rim-bold-s1', 150, 760],
  ['beam-atmospheric-s1', 700, 260],
  ['streaks-bold-s3', 900, 500],
]
for (const [name, x, y] of SPOTS) {
  const input = await sharp(path.join(dir, 's100', `${name}-1080.jpg`)).extract({ left: x, top: y, width: CW, height: CH }).png().toBuffer()
  crops.push(await caption(input, CW, `${name} ASCII 1, 1:1 at 1080`))
}
await sharp(await grid(crops, 2, CW)).jpeg({ quality: 90 }).toFile(path.join(dir, 'sheet-crops.jpg'))
console.log('wrote', path.join(dir, 'sheet-full.jpg'), path.join(dir, 'sheet-crops.jpg'))
