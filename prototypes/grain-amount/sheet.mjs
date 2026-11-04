// Grain amounts on looks next to the riso prints, as 1:1 crops. Renders Ramp, Bands and Halo (Bold, seed 3, controls
// at 0.5) at a short side of --short (925 is the riso tiles' scale, 1210 the preview canvas at 2x DPR), picks each
// look's flattest mid-tone window from its grain-free render, and crops it at each amount. With --power p a second
// row per look shows strength s passed as s^p (what an amount curve of s^p would give with the same engine).
// Usage: node prototypes/grain-amount/sheet.mjs [--short 925] [--power 0.6] [--out artifacts/grain-amount/sheet.jpg]
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { ROOT, startHarness } from '../../scripts/light/lib/harness.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const short = Number(args.short ?? 925)
const power = args.power ? Number(args.power) : null
const out = path.resolve(ROOT, args.out ?? `artifacts/grain-amount/sheet-${short}${power ? `-pow${power}` : ''}.jpg`)
const AMOUNTS = [0.1, 0.25, 0.5, 0.75, 1]
const LOOKS = ['sunset.ramp', 'sunset.bands', 'contour.halo']
const RISO = ['sunset-green-riso', 'sunset-blue-riso']
const CROP = 240
const CAPTION = 22
const width = Math.round((short * 16) / 9)
const height = short

const lightness = (r, g, b) => {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [lr, lg, lb] = [r, g, b].map((v) => lin(v / 255))
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
}

/** The CROP window, on a 40 px grid, whose Oklab L is nearest 0.6 and flattest. */
function pickWindow(data, w, h, channels) {
  let best = { x: 0, y: 0, score: Infinity }
  for (let y = 0; y + CROP <= h; y += 40) {
    for (let x = 0; x + CROP <= w; x += 40) {
      let sum = 0
      let sum2 = 0
      let n = 0
      for (let yy = y; yy < y + CROP; yy += 6) {
        for (let xx = x; xx < x + CROP; xx += 6) {
          const p = (yy * w + xx) * channels
          const L = lightness(data[p], data[p + 1], data[p + 2])
          sum += L
          sum2 += L * L
          n++
        }
      }
      const mean = sum / n
      const score = Math.abs(mean - 0.6) + 2 * Math.sqrt(Math.max(0, sum2 / n - mean * mean))
      if (score < best.score) best = { x, y, score }
    }
  }
  return best
}

const cropOf = (data, w, channels, x, y) => {
  const outBuf = Buffer.alloc(CROP * CROP * 3)
  for (let yy = 0; yy < CROP; yy++) for (let xx = 0; xx < CROP; xx++) for (let c = 0; c < 3; c++) outBuf[(yy * CROP + xx) * 3 + c] = data[((y + yy) * w + x + xx) * channels + c]
  return outBuf
}

const label = (text, w) => Buffer.from(`<svg width="${w}" height="${CAPTION}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="Helvetica" font-size="14" fill="#ddd">${text}</text></svg>`)

const rows = []
const harness = await startHarness()
try {
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  for (const look of LOOKS) {
    const scene = { ...buildScene(look, getPack('bold'), 3, { intensity: 0.5, softness: 0.5, mood: 0.5 }, width / height), recipe: look }
    const render = async (grain) => harness.render({ scene: { ...scene, output: { ...scene.output, grain } }, width, height, supersample: 2 })
    const plain = await render(0)
    const at = pickWindow(plain.data, width, height, 4)
    for (const curve of power ? ['linear', 'power'] : ['linear']) {
      const cells = []
      for (const amount of AMOUNTS) {
        const strength = curve === 'power' ? amount ** power : amount
        const image = await render(strength)
        cells.push({ crop: cropOf(image.data, width, 4, at.x, at.y), text: `${look.split('.')[1]} ${amount}${curve === 'power' ? ` (s^${power})` : ''}` })
      }
      rows.push(cells)
    }
  }
} finally {
  await harness.close()
}
const risoCells = []
for (const id of RISO) {
  const { data, info } = await sharp(path.join(ROOT, 'public/references/awe/sunset', `${id}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = pickWindow(data, info.width, info.height, 3)
  risoCells.push({ crop: cropOf(data, info.width, 3, at.x, at.y), text: `${id.replace('sunset-', '')} (925 px)` })
}
const columns = AMOUNTS.length + 1
const sheetWidth = columns * CROP
const sheetHeight = rows.length * (CROP + CAPTION)
const composites = []
rows.forEach((cells, r) => {
  const riso = risoCells[r % risoCells.length]
  ;[...cells, riso].forEach((cell, c) => {
    const top = r * (CROP + CAPTION)
    composites.push({ input: label(cell.text, CROP), left: c * CROP, top })
    composites.push({ input: cell.crop, raw: { width: CROP, height: CROP, channels: 3 }, left: c * CROP, top: top + CAPTION })
  })
})
mkdirSync(path.dirname(out), { recursive: true })
await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 3, background: '#000' } }).composite(composites).jpeg({ quality: 92 }).toFile(out)
console.log(`Wrote ${path.relative(ROOT, out)} (${sheetWidth}x${sheetHeight}), renders at ${width}x${height} 2x`)
