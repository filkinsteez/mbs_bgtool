// One sheet: for each of the poster's four color areas, the poster next to our frame with the print screen at 1 and
// 0.5 and with the tool's Grain at 1, all as 1:1 crops (no zoom) on the nearest even area of our frames; below, Ramp,
// Bands and Blooms at 1080p with the screen, shrunk. Only our renders go through the screen; the poster is only shown
// and measured. Captions: texture strength (high-pass RMS, as strength.mjs) and direction (as direction.mjs).
// Usage: node prototypes/print-screen/sheets.mjs (after render.mjs)
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { measureGrain } from '../../scripts/light/lib/grain.mjs'
import { aroundWindow, CROP, cropImage, loadFrames, loadImage, nearestWindow, POSTER_AREAS, POSTER_FILE, posterTarget } from './lib/areas.mjs'
import { applyScreen } from './lib/screen.mjs'
import { directionality, planes } from './lib/spectrum.mjs'

const root = new URL('../../', import.meta.url).pathname
const out = new URL('./out/', import.meta.url).pathname
mkdirSync(`${out}sheets`, { recursive: true })

/** Strength and direction of the texture over `rect` of an image. */
function texture(image, rect) {
  const m = measureGrain(cropImage(image, rect), { hpSigma: 0.0065 * 960, structure: 0.04, minBin: 300 })
  const d = directionality(planes(image).Y, image.width, rect)
  return { stdL: m.stdL, stdY: m.stdY, peakShare: d.peakShare, bothShare: d.bothShare, dirShare: d.dirShare }
}
const numbers = (t) => `${(t.stdL * 100).toFixed(2)} % L; main peak ${(t.peakShare * 100).toFixed(1)} %, within 15° ${(t.dirShare * 100).toFixed(0)} %`

function textSvg(lines, width, size = 13) {
  const esc = (t) => t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
  const height = lines.length * (size + 5) + 4
  const text = lines.map((t, i) => `<text x="1" y="${(i + 1) * (size + 5) - 3}" fill="${i === 0 ? '#e6e6e6' : '#a0a0a0'}" font-family="Helvetica, Arial, sans-serif" font-size="${size}">${esc(t)}</text>`).join('')
  return { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${text}</svg>`), height }
}
const raw = (image) => sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })

const poster = await loadImage(POSTER_FILE)
const frames = await loadFrames(`${out}renders/`)
for (const frame of frames) frame.grain = await loadImage(`${out}renders/${frame.name}-grain1.png`)

const gap = 12
const columns = 4
const width = gap + columns * (CROP.width + gap)
const composites = []
let top = gap
const head = textSvg(
  [
    'Film poster against our print screen: 1:1 crops, no zoom (what a viewer sees at 100 %)',
    'Print screen 1 is the poster’s amount. Grain 1 is the tool’s Grain at its top (the riso prints). A texture with no direction has 17 % within 15°.',
  ],
  width - 2 * gap,
  15,
)
composites.push({ ...head, left: gap, top })
top += head.height + gap
const record = []
for (const area of POSTER_AREAS) {
  const target = posterTarget(poster, area)
  const best = nearestWindow(frames, target)
  const { frame } = best
  const rect = aroundWindow(best, frame.image)
  const window = [best.x, best.y, CROP.width, CROP.height]
  const screened = { 1: applyScreen(frame.image, 1, frame.seed), 0.5: applyScreen(frame.image, 0.5, frame.seed) }
  const panels = [
    { title: `Poster, ${area.name} (L ${target[0].toFixed(2)})`, image: poster, crop: [area.crop[0], area.crop[1], CROP.width, CROP.height], t: texture(poster, area.band) },
    { title: 'Ours, print screen 1', image: screened[1], crop: window, t: texture(screened[1], rect) },
    { title: 'Ours, print screen 0.5', image: screened[0.5], crop: window, t: texture(screened[0.5], rect) },
    { title: 'Ours, Grain 1 (the tool now)', image: frame.grain, crop: window, t: texture(frame.grain, rect) },
  ]
  const label = `${frame.name.replace('bands-', 'Bands ').replace('-i0', ', Intensity 0').replace('-i25', ', Intensity 0.25').replace(/-s(\d+)/, ' seed $1')}`
  const rowTitle = textSvg([`${area.name[0].toUpperCase()}${area.name.slice(1)}: ours is ${label} (L ${best.c[0].toFixed(2)}, ΔE ${best.deltaE.toFixed(3)} from the poster crop)`], width - 2 * gap, 14)
  composites.push({ ...rowTitle, left: gap, top })
  top += rowTitle.height + 2
  const captions = panels.map((p) => textSvg([p.title, numbers(p.t)], CROP.width, 12))
  const captionHeight = Math.max(...captions.map((c) => c.height))
  for (const [i, p] of panels.entries()) {
    const left = gap + i * (CROP.width + gap)
    composites.push({ ...captions[i], left, top })
    composites.push({ input: await raw(cropImage(p.image, p.crop)).png().toBuffer(), left, top: top + captionHeight })
  }
  top += captionHeight + CROP.height + gap * 2
  record.push({ area: area.name, frame: frame.name, window: { x: best.x, y: best.y, deltaE: best.deltaE, stdL: best.stdL }, panels: panels.map((p) => ({ title: p.title, ...p.t })) })
}

// Full frames at 1080p with the screen at 1, shrunk to a quarter.
const full = ['ramp-bold-s1-1080p', 'bands-bold-s1-1080p', 'blooms-bold-s1-1080p']
const small = { width: 480, height: 270 }
const fullGap = Math.floor((width - full.length * small.width) / (full.length + 1))
const fullTitle = textSvg(['Ramp, Bands and Blooms (Bold, seed 1) at 1080p with the print screen at 1, shrunk to a quarter'], width - 2 * gap, 14)
composites.push({ ...fullTitle, left: gap, top })
top += fullTitle.height + 2
for (const [i, name] of full.entries()) {
  const frame = await loadImage(`${out}renders/${name}.png`)
  const shrunk = await raw(applyScreen(frame, 1, 1)).resize(small.width, small.height, { kernel: 'lanczos3' }).png().toBuffer()
  composites.push({ input: shrunk, left: fullGap + i * (small.width + fullGap), top })
}
top += small.height + gap
const file = `${out}sheets/print-vs-poster.jpg`
await sharp({ create: { width, height: top, channels: 3, background: '#161616' } })
  .composite(composites)
  .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
  .toFile(file)
writeFileSync(`${out}sheets/numbers.json`, JSON.stringify(record, null, 1))
console.log(`wrote ${file.replace(root, '')}`)
for (const r of record) console.log(`${r.area} (${r.frame}, deltaE ${r.window.deltaE.toFixed(3)}): ${r.panels.map((p) => `${p.title}: ${numbers(p)}`).join(' | ')}`)
