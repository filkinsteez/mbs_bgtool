// How directional the poster's texture is against ours, in the poster's four color areas: the share of high-pass
// energy in the main peak and in both peaks, and the share of 3-7 px energy within 15 deg of the main angle.
// Ours: the screened frame nearest in color to each area (render.mjs first).
// Usage: node prototypes/print-screen/direction.mjs [--label text] [--strengths 0.5,1]
import { writeFileSync } from 'node:fs'
import { aroundWindow, loadFrames, loadImage, nearestWindow, POSTER_AREAS, POSTER_FILE, posterTarget } from './lib/areas.mjs'
import { applyScreen } from './lib/screen.mjs'
import { directionality, planes } from './lib/spectrum.mjs'

const out = new URL('./out/', import.meta.url).pathname
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const label = arg('label', 'now')
const strengths = arg('strengths', '0.5,1').split(',').map(Number)

const poster = await loadImage(POSTER_FILE)
const posterY = planes(poster).Y
const frames = await loadFrames(`${out}renders/`)

const fmt = (d) =>
  `peak ${(d.peakShare * 100).toFixed(1)} %, both peaks ${(d.bothShare * 100).toFixed(1)} %, within 15 deg ${(d.dirShare * 100).toFixed(1)} % (main ${d.main.periodPx.toFixed(2)} px at ${d.main.angleDeg.toFixed(0)} deg, second ${d.second ? `${d.second.periodPx.toFixed(2)} px at ${d.second.angleDeg.toFixed(0)} deg` : '-'})`
const lines = [`Direction (${label}); a texture with no direction has 17 % within 15 deg`]
const rows = []
for (const area of POSTER_AREAS) {
  const target = posterTarget(poster, area)
  const p = directionality(posterY, poster.width, area.band)
  const best = nearestWindow(frames, target)
  const rect = aroundWindow(best, best.frame.image)
  const row = { area: area.name, posterL: target[0], poster: p, frame: best.frame.name, window: { x: best.x, y: best.y, deltaE: best.deltaE, stdL: best.stdL, L: best.c[0] }, ours: {} }
  lines.push(`== ${area.name} (poster L ${target[0].toFixed(2)}): poster ${fmt(p)}`)
  for (const s of strengths) {
    const screened = applyScreen(best.frame.image, s, best.frame.seed)
    const d = directionality(planes(screened).Y, screened.width, rect)
    row.ours[s] = d
    lines.push(`   ours ${s} (${best.frame.name}, L ${best.c[0].toFixed(2)}, deltaE ${best.deltaE.toFixed(3)}, L spread ${best.stdL.toFixed(3)}): ${fmt(d)}`)
  }
  rows.push(row)
}
console.log(lines.join('\n'))
writeFileSync(`${out}direction-${label}.txt`, lines.join('\n') + '\n')
writeFileSync(`${out}direction-${label}.json`, JSON.stringify(rows, null, 1))
