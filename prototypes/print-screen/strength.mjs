// Texture strength, poster against ours, in the poster's four color areas: the high-pass RMS of the grain
// measurement (scripts/light/lib/grain.mjs: each plane minus its blur at 0.0065 of the short side, edges masked),
// with the same settings for both. The poster: its band per area. Ours: the screened frame nearest in color, over
// 384 x 256 px around the nearest window (as direction.mjs). Prints the amplitude at which ours matches the poster.
// Usage: node prototypes/print-screen/strength.mjs [--strengths 0,0.5,1]
import { writeFileSync } from 'node:fs'
import { measureGrain } from '../../scripts/light/lib/grain.mjs'
import { aroundWindow, cropImage, loadFrames, loadImage, nearestWindow, POSTER_AREAS, POSTER_FILE, posterTarget } from './lib/areas.mjs'
import { applyScreen, SCREEN } from './lib/screen.mjs'

const out = new URL('./out/', import.meta.url).pathname
const argv = process.argv.slice(2)
const strengths = (argv.includes('--strengths') ? argv[argv.indexOf('--strengths') + 1] : '0,0.5,1').split(',').map(Number)

const poster = await loadImage(POSTER_FILE)
const frames = await loadFrames(`${out}renders/`)
const measure = (image) => measureGrain(image, { hpSigma: 0.0065 * 960, structure: 0.04, minBin: 300 })
const fmt = (m) => `L ${(m.stdL * 100).toFixed(2)} %, luma ${m.stdY.toFixed(2)} cv (measured ${(m.usedShare * 100).toFixed(0)} %)`

const lines = [`Texture strength (high-pass RMS), amp ${SCREEN.amp} at strength 1`]
const rows = []
for (const area of POSTER_AREAS) {
  const target = posterTarget(poster, area)
  const p = measure(cropImage(poster, area.band))
  const best = nearestWindow(frames, target)
  const rect = aroundWindow(best, best.frame.image)
  const row = { area: area.name, posterL: target[0], poster: { stdL: p.stdL, stdY: p.stdY }, frame: best.frame.name, ours: {} }
  lines.push(`== ${area.name} (poster L ${target[0].toFixed(2)}): poster ${fmt(p)}`)
  for (const s of strengths) {
    const m = measure(cropImage(applyScreen(best.frame.image, s, best.frame.seed), rect))
    row.ours[s] = { stdL: m.stdL, stdY: m.stdY }
    lines.push(`   ours ${s} (${best.frame.name}, L ${best.c[0].toFixed(2)}, deltaE ${best.deltaE.toFixed(3)}, L spread ${best.stdL.toFixed(3)}): ${fmt(m)}; poster / ours ${(p.stdL / m.stdL).toFixed(2)} in L, ${(p.stdY / m.stdY).toFixed(2)} in luma`)
  }
  rows.push(row)
}
if (strengths.includes(1)) {
  const ratios = rows.map((r) => r.poster.stdL / r.ours[1].stdL)
  const geo = Math.exp(ratios.reduce((s, v) => s + Math.log(v), 0) / ratios.length)
  lines.push(`Matching amp (geometric mean of poster / ours in L over the four areas): ${(SCREEN.amp * geo).toFixed(4)}`)
}
console.log(lines.join('\n'))
writeFileSync(`${out}strength.txt`, lines.join('\n') + '\n')
writeFileSync(`${out}strength.json`, JSON.stringify(rows, null, 1))
