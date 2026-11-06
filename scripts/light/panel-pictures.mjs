// Renders the small pictures on the tool panel's Mood, Look and Filter buttons into public/panel/.
// They show each look and filter in each pack at fixed settings; they are not live. Run again after a look or filter
// changes a lot:
//   node scripts/light/panel-pictures.mjs [--out public/panel] [--seed n] [--sheet file.jpg]
// --seed renders every look at that seed (to compare seeds); --sheet also writes a contact sheet of the results.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { startHarness } from './lib/harness.mjs'
import { raw } from './lib/images.mjs'

/** Look pictures: 16:9, drawn at 2x and saved at this size. */
const LOOK_SIZE = { width: 384, height: 216 }
/** The seed each look's picture uses, the same in every pack. */
const SEEDS = {
  'sunset.ramp': 1,
  'sunset.bands': 1,
  'sunset.blooms': 1,
  'contour.rim': 1,
  'contour.beam': 4,
  'contour.halo': 1,
  'contour.streaks': 1,
}
/**
 * Filter pictures show one look with the filter on, cropped so the filter's marks are large enough to see. The crop
 * is centered on the band edge two thirds of the way down, so it spans light and dark.
 */
const FILTER_LOOK = 'sunset.bands'
const FILTER_SIZE = { width: 192, height: 108 }
const FILTER_CENTER = { x: 0.5, y: 0.68 }
/**
 * For each filter: its strength, the frame it is drawn in, and how much of that frame's middle the picture shows
 * (as a share of its width), so ASCII shows a few rows of characters and Pixel a few rows of cells. Grain's specks
 * are about a pixel of a 1080p frame, so its picture is a small crop enlarged. None has no picture; the panel shows
 * an icon for it.
 */
const FILTERS = {
  grain: { strength: 1, frame: { width: 1920, height: 1080 }, share: 1 / 15 },
  ascii: { strength: 0, frame: { width: 768, height: 432 }, share: 0.25 },
  pixel: { strength: 0, frame: { width: 768, height: 432 }, share: 0.25 },
}

const argv = process.argv.slice(2)
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback)
const outDir = path.resolve(option('--out', 'public/panel'))
const seedOverride = option('--seed', null)
const sheetFile = option('--sheet', null)

const fileName = (id) => `${id.replace('.', '-')}`

await mkdir(outDir, { recursive: true })
const harness = await startHarness()
const written = []
try {
  const { PACKS } = await harness.ssr('/src/light/color/packs.ts')
  const { RECIPE_IDS, DEFAULT_CONTROLS } = await harness.ssr('/src/light/scene.ts')
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { withFilter } = await harness.ssr('/src/tool/filterControl.ts')
  for (const pack of PACKS) {
    for (const look of RECIPE_IDS) {
      const seed = seedOverride ? Number(seedOverride) : SEEDS[look]
      const scene = withFilter(buildScene(look, pack, seed, DEFAULT_CONTROLS, 16 / 9), { filter: 'none', strength: 0 })
      const image = await harness.render({ scene, ...LOOK_SIZE, supersample: 2 })
      const file = path.join(outDir, `${fileName(look)}-${pack.id}.webp`)
      await raw(image).webp({ quality: 82 }).toFile(file)
      written.push({ file, label: `${look} ${pack.id} s${seed}` })
    }
    const seed = seedOverride ? Number(seedOverride) : SEEDS[FILTER_LOOK]
    for (const [filter, spec] of Object.entries(FILTERS)) {
      const { width, height } = spec.frame
      const scene = withFilter(buildScene(FILTER_LOOK, pack, seed, DEFAULT_CONTROLS, width / height), { filter, strength: spec.strength })
      const image = await harness.render({ scene, width, height, supersample: 1 })
      const cropW = Math.round(width * spec.share)
      const cropH = Math.round((cropW * FILTER_SIZE.height) / FILTER_SIZE.width)
      const left = Math.min(width - cropW, Math.max(0, Math.round(width * FILTER_CENTER.x - cropW / 2)))
      const top = Math.min(height - cropH, Math.max(0, Math.round(height * FILTER_CENTER.y - cropH / 2)))
      const crop = { left, top, width: cropW, height: cropH }
      const file = path.join(outDir, `filter-${filter}-${pack.id}.webp`)
      await raw(image).extract(crop).resize(FILTER_SIZE.width, FILTER_SIZE.height, { kernel: 'cubic' }).webp({ quality: 86 }).toFile(file)
      written.push({ file, label: `${filter} ${pack.id}` })
    }
  }
} finally {
  await harness.close()
}
for (const { file } of written) console.log(path.relative(process.cwd(), file))

if (sheetFile) {
  const cols = 10
  const tileW = 192
  const tileH = 108
  const label = 18
  const rows = Math.ceil(written.length / cols)
  const composites = []
  for (const [i, { file, label: text }] of written.entries()) {
    const left = (i % cols) * (tileW + 6)
    const top = Math.floor(i / cols) * (tileH + label + 6)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${label}"><text x="2" y="13" font-family="Helvetica" font-size="12" fill="#ccc">${text}</text></svg>`
    composites.push({ input: Buffer.from(svg), left, top })
    composites.push({ input: await sharp(file).resize(tileW, tileH, { fit: 'cover' }).toBuffer(), left, top: top + label })
  }
  await sharp({ create: { width: cols * (tileW + 6) - 6, height: rows * (tileH + label + 6) - 6, channels: 3, background: '#161616' } })
    .composite(composites)
    .jpeg({ quality: 88 })
    .toFile(path.resolve(sheetFile))
  console.log(sheetFile)
}
