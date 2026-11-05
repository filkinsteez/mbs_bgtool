// Grain as fine specks with a Density slider: one sheet of 1:1 crops (no zoom) of Bands Bold, Ramp Atmospheric and
// Rim Bold at the 4K export size and at a 1600 px preview size, at Density 0.1, 0.25, 0.5, 0.75 and 1, next to the
// grain before this change at 1 and the deck's grain picture (slide 44:204, shown only, never rendered from), and a
// 4x crop of the speck size.
// Usage: node prototypes/grain-density/sheet.mjs --before   (with the old grain in the tree: saves its crops)
//        node prototypes/grain-density/sheet.mjs            (renders the densities and writes the sheet)
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { measureGrain } from '../../scripts/light/lib/grain.mjs'
import { ROOT, startHarness } from '../../scripts/light/lib/harness.mjs'
import { cropRgba, loadRgba, raw, resizeRgba } from '../../scripts/light/lib/images.mjs'

const dir = path.join(ROOT, 'prototypes/grain-density')
const out = path.join(dir, 'out')
const cropDir = path.join(out, 'crops')
mkdirSync(cropDir, { recursive: true })
const before = process.argv.includes('--before')

const FRAMES = [
  { name: 'Bands Bold', look: 'sunset.bands', pack: 'bold' },
  { name: 'Ramp Atmospheric', look: 'sunset.ramp', pack: 'atmospheric' },
  { name: 'Rim Bold', look: 'contour.rim', pack: 'bold' },
]
const SIZES = [
  { name: '4K export', width: 3840, height: 2160 },
  { name: '1600 px preview', width: 1600, height: 900 },
]
const DENSITIES = [0.1, 0.25, 0.5, 0.75, 1]
const CROP = 200
/** Where the crops sit, as fractions of the frame (the crop's centre): a mid-tone area of each frame. */
const AT = { 'Bands Bold': [0.5, 0.42], 'Ramp Atmospheric': [0.5, 0.5], 'Rim Bold': [0.62, 0.55] }
const key = (f, s, label) => `${f.look}-${f.pack}-${s.width}-${label}`

function cropAt(image, frame) {
  const [fx, fy] = AT[frame.name]
  const x = Math.round(fx * image.width - CROP / 2)
  const y = Math.round(fy * image.height - CROP / 2)
  return cropRgba(image, x, y, CROP, CROP)
}

async function render(harness, f, s, grain) {
  const scene = await harness.call('compose', f.look, f.pack, { intensity: 0.5, softness: 0.5, mood: 0.5 }, 1, s.width / s.height)
  return harness.render({ scene: { ...scene, output: { ...scene.output, grain } }, width: s.width, height: s.height })
}

const harness = await startHarness()
try {
  for (const f of FRAMES) {
    for (const s of SIZES) {
      for (const [label, grain] of before ? [['before1', 1]] : [['d0', 0], ...DENSITIES.map((d) => [`d${d}`, d])]) {
        const image = await render(harness, f, s, grain)
        await raw(await cropAt(image, f)).png().toFile(path.join(cropDir, `${key(f, s, label)}.png`))
        // The speck size: 64 px of the 4K and preview renders at Density 0.5, enlarged 4x.
        if (!before && label === 'd0.5' && f.name === 'Bands Bold') {
          const small = await cropRgba(await cropAt(image, f), 68, 68, 64, 64)
          await raw(await resizeRgba(small, 256, 256, 'nearest')).png().toFile(path.join(cropDir, `zoom-${s.width}.png`))
        }
      }
    }
  }
} finally {
  await harness.close()
}
if (before) {
  console.log(`saved the old grain's crops in ${path.relative(ROOT, cropDir)}`)
  process.exit(0)
}

// The sheet.
const GAP = 10
const escapeXml = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
function text(lines, width, size = 12) {
  const height = lines.length * (size + 5) + 4
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines
    .map((t, i) => `<text x="1" y="${(i + 1) * (size + 5) - 3}" fill="${i === 0 ? '#e6e6e6' : '#a0a0a0'}" font-family="Helvetica, Arial, sans-serif" font-size="${size}">${escapeXml(t)}</text>`)
    .join('')}</svg>`
  return { input: Buffer.from(svg), height }
}
const stdLine = (image) => {
  const m = measureGrain(image, { hpSigma: 6, minBin: 200, structure: 0 })
  return `L ${(m.stdL * 100).toFixed(2)} %, ${m.stdY.toFixed(1)} code values`
}

const columns = ['grain before, 1', ...DENSITIES.map((d) => `Density ${d}`)]
const deck = await loadRgba(path.join(ROOT, 'prototypes/grain-study/results/deck-grain-layer.png'))
// The deck picture's 1:1 output panels (peach and blue), 192 px each.
const deckPanels = [await cropRgba(deck, 409, 53, 190, 190), await cropRgba(deck, 409, 271, 190, 190)]
const width = GAP + (columns.length + 1) * (CROP + GAP)
const composites = []
let top = GAP
const head = text(
  [
    'Grain as fine specks: 1:1 crops, no zoom. Each speck is one pixel at 1080 px on the short side; Density sets how many.',
    'Columns: the grain before this change at 1, then Density 0.1 to 1. Right: the deck’s grain picture (slide 44:204) at 1:1, a visual target only.',
  ],
  width - 2 * GAP,
  14,
)
composites.push({ ...head, left: GAP, top })
top += head.height + GAP
let deckShown = 0
for (const f of FRAMES) {
  for (const s of SIZES) {
    const title = text([`${f.name}, ${s.name} (${s.width} x ${s.height})`], width - 2 * GAP, 13)
    composites.push({ ...title, left: GAP, top })
    top += title.height
    const labels = [['before1', columns[0]], ...DENSITIES.map((d, i) => [`d${d}`, columns[i + 1]])]
    let captionHeight = 0
    const cells = []
    for (const [label, caption] of labels) {
      const file = path.join(cropDir, `${key(f, s, label)}.png`)
      if (!existsSync(file)) continue
      const image = await loadRgba(file)
      const c = text([caption, stdLine(image)], CROP, 11)
      captionHeight = Math.max(captionHeight, c.height)
      cells.push({ image, c })
    }
    cells.forEach(({ image, c }, i) => {
      const left = GAP + i * (CROP + GAP)
      composites.push({ ...c, left, top })
      composites.push({ input: image.data, raw: { width: CROP, height: CROP, channels: 4 }, left, top: top + captionHeight })
    })
    if (deckShown < deckPanels.length && s.width === 3840) {
      const left = GAP + columns.length * (CROP + GAP)
      const c = text([`deck grain picture, ${deckShown === 0 ? 'peach' : 'blue'}`, stdLine(deckPanels[deckShown])], CROP, 11)
      composites.push({ ...c, left, top })
      composites.push({ input: deckPanels[deckShown].data, raw: { width: 190, height: 190, channels: 4 }, left, top: top + captionHeight })
      deckShown++
    }
    top += captionHeight + CROP + GAP
  }
}
const zoomTitle = text(['The speck size: 64 px of Bands Bold at Density 0.5, enlarged 4x (nearest neighbour). Left: 4K export, right: 1600 px preview.'], width - 2 * GAP, 13)
composites.push({ ...zoomTitle, left: GAP, top })
top += zoomTitle.height
for (const [i, w] of [3840, 1600].entries()) {
  composites.push({ input: path.join(cropDir, `zoom-${w}.png`), left: GAP + i * (256 + GAP), top })
}
top += 256 + GAP
const file = path.join(dir, 'results/grain-density.jpg')
mkdirSync(path.dirname(file), { recursive: true })
await sharp({ create: { width, height: top, channels: 3, background: '#161616' } }).composite(composites).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(file)
console.log(`wrote ${path.relative(ROOT, file)}`)
if (process.argv.includes('--clean')) rmSync(out, { recursive: true, force: true })
