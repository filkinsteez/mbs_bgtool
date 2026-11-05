// The top of the Density slider: Bands Bold, Rim Bold and Beam Atmospheric as whole frames and as 1:1 crops of the
// 1600 x 900 preview (1x) and the 3840 x 2160 export (2x) around the same point of the frame, at densities 0, 0.5,
// 0.75 and 1. Renders through the engine's chain (src/light at HEAD with the working tree's ASCII files on top).
//   node prototypes/ascii/top.mjs [--densities 0,0.5,0.75,1] [--name top]
//   -> out/<name>/sheet.jpg; also prints the 4K export's render time with ASCII off and on at each density
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { column, row } from './fidelity.mjs'
import { OUT, startPrototype } from './lib/server.mjs'

const LOOKS = [
  { name: 'bands-bold-s1', recipe: 'sunset.bands', pack: 'bold', seed: 1, at: [0.5, 0.45] },
  { name: 'rim-bold-s1', recipe: 'contour.rim', pack: 'bold', seed: 1, at: [0.25, 0.83] },
  { name: 'beam-atmospheric-s1', recipe: 'contour.beam', pack: 'atmospheric', seed: 1, at: [0.5, 0.62] },
]
const argv = process.argv.slice(2)
const arg = (key, fallback) => (argv.includes(`--${key}`) ? argv[argv.indexOf(`--${key}`) + 1] : fallback)
const densities = String(arg('densities', '0,0.5,0.75,1')).split(',').map(Number)
const name = String(arg('name', 'top'))
const dir = path.join(OUT, name)
fs.mkdirSync(dir, { recursive: true })
const W = 480
const H = 270

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

/** A W x H crop centred on frame point (u, v), kept inside the frame. */
async function cropAt(image, width, height, [u, v]) {
  const left = Math.min(width - W, Math.max(0, Math.round(u * width - W / 2)))
  const top = Math.min(height - H, Math.max(0, Math.round(v * height - H / 2)))
  return sharp(image, { raw: { width, height, channels: 4 } }).removeAlpha().extract({ left, top, width: W, height: H }).png().toBuffer()
}

const rowsAt = (d) => Math.round(13 * 8 ** Math.min(1, Math.max(0, d)))
const proto = await startPrototype()
try {
  const rows = []
  for (const look of LOOKS) {
    for (const d of densities) {
      const ascii = Math.max(d, 1e-4)
      const take = async (width, height, supersample) => {
        const key = proto.nextKey('top')
        await proto.call('renderFrame', { ...look, width, height, supersample, output: { ascii }, key })
        return proto.take(key)
      }
      const preview = await take(1600, 900, 1)
      const exported = await take(3840, 2160, 2)
      const whole = await sharp(preview, { raw: { width: 1600, height: 900, channels: 4 } }).removeAlpha().resize({ width: W }).png().toBuffer()
      const label = `${look.name} ${d} (${rowsAt(d)} rows)`
      rows.push(
        await row(
          [
            await caption(whole, W, `${label} whole`),
            await caption(await cropAt(preview, 1600, 900, look.at), W, `${label} 1600 preview 1:1`),
            await caption(await cropAt(exported, 3840, 2160, look.at), W, `${label} 4K export 1:1`),
          ],
          W,
        ),
      )
      console.log('rendered', label)
    }
  }
  await sharp(await column(rows)).jpeg({ quality: 88 }).toFile(path.join(dir, 'sheet.jpg'))
  console.log('wrote', path.join(dir, 'sheet.jpg'))
  for (const d of densities) {
    const t = await proto.call('timeFrame', { ...LOOKS[2], width: 3840, height: 2160, supersample: 2, outputs: [{ ascii: 0 }, { ascii: Math.max(d, 1e-4) }], runs: 5 })
    console.log(`4K export, ${LOOKS[2].name}, density ${d}: ASCII off ${t[0].ms} ms, on ${t[1].ms} ms`)
  }
} finally {
  await proto.close()
}
