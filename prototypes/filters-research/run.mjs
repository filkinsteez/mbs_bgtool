// node run.mjs [shotId,...] [filter,...]
// Applies each filter at strengths 0.25, 0.5 and 1 to the tool shots, writes 8-bit PNGs
// (engine-style TPDF dither) to out/filtered/<shot>/<filter>-<strength>.png and checks
// that the mean colour is kept:
//   blur  - both images blurred in linear light (gaussian, sigma = 1% of the short side,
//           or one cell height for the cell filters, whichever is larger), Oklab distance;
//   thumb - both 8-bit images shrunk 8x by sharp in sRGB values (what most apps do when
//           they show an image small), Oklab distance.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { FILTERS } from './lib/filters.mjs'
import { decodeBuffer, readLinear, writeImage } from './lib/image.mjs'
import { gaussianBlur, oklabDiff, srgbThumb } from './lib/measure.mjs'
import { SHOTS } from './shots.mjs'

export const STRENGTHS = [0.25, 0.5, 1]
const CELL_ROWS = { ascii: 64, pixel: 72 }
const seedOf = (id) => Number(id.match(/-s(\d+)-/)[1])

const [shotArg, filterArg] = process.argv.slice(2)
const shots = shotArg ? SHOTS.filter((s) => shotArg.split(',').includes(s.id)) : SHOTS
const filters = filterArg ? filterArg.split(',') : Object.keys(FILTERS)
const root = new URL('./out/', import.meta.url).pathname
const metricsPath = `${root}metrics.json`
let metrics = {}
try {
  metrics = JSON.parse(readFileSync(metricsPath, 'utf8'))
} catch {}

for (const shot of shots) {
  const src = `${root}shots/${shot.id}.png`
  const img = await readLinear(src)
  const original8 = await sharp(src).removeAlpha().raw().toBuffer()
  const short = Math.min(img.w, img.h)
  const dir = `${root}filtered/${shot.id}/`
  mkdirSync(dir, { recursive: true })
  const seed = seedOf(shot.id)
  for (const name of filters) {
    const sigma = Math.max(0.01 * short, CELL_ROWS[name] ? short / CELL_ROWS[name] : 0)
    const blurA = gaussianBlur(img, sigma)
    const thumbA = await srgbThumb(original8, img.w, img.h, 8)
    for (const s of STRENGTHS) {
      const t0 = Date.now()
      const out = FILTERS[name](img, s, seed)
      const buf = await writeImage(out, `${dir}${name}-${s}.png`, seed)
      const back = decodeBuffer(buf, img.w, img.h)
      const blur = oklabDiff(blurA, gaussianBlur(back, sigma), Math.ceil(3 * sigma))
      const thumb = oklabDiff(thumbA, await srgbThumb(buf, img.w, img.h, 8), 2)
      metrics[`${shot.id}|${name}|${s}`] = { blurMean: blur.mean, blurP95: blur.p95, thumbMean: thumb.mean, thumbP95: thumb.p95, sigma }
      console.log(
        `${shot.id.padEnd(28)} ${name.padEnd(6)} ${String(s).padEnd(4)} blur ${blur.mean.toFixed(4)} (p95 ${blur.p95.toFixed(4)})  thumb ${thumb.mean.toFixed(4)} (p95 ${thumb.p95.toFixed(4)})  ${Date.now() - t0} ms`,
      )
    }
  }
}
let latest = {}
try {
  latest = JSON.parse(readFileSync(metricsPath, 'utf8'))
} catch {}
const mine = Object.fromEntries(Object.entries(metrics).filter(([k]) => shots.some((s) => k.startsWith(`${s.id}|`)) && filters.includes(k.split('|')[1])))
writeFileSync(metricsPath, JSON.stringify({ ...latest, ...mine }, null, 1))
