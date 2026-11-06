// Renders the small pictures on the tool panel's Mood and Look buttons into public/panel/ (Filter and Format show
// icons and shapes drawn in the page). They show each look in one pack at fixed settings, and the panel shows the same
// pictures whichever pack is picked; they are not live. Run again after a look changes a lot:
//   node scripts/light/panel-pictures.mjs [--out public/panel] [--seed n] [--sheet file.jpg]
// --seed renders every look at that seed (to compare seeds); --sheet also writes a contact sheet of the results.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { startHarness } from './lib/harness.mjs'
import { raw } from './lib/images.mjs'

/** Look pictures: 16:9, drawn at 2x and saved at this size. */
const LOOK_SIZE = { width: 384, height: 216 }
/** The pack every picture is drawn in (owner, 2026-11-06). */
const PACK_ID = 'atmospheric'
/** The seed each look's picture uses. */
const SEEDS = {
  'sunset.ramp': 1,
  'sunset.bands': 1,
  'sunset.blooms': 1,
  'contour.rim': 1,
  'contour.beam': 4,
  'contour.halo': 1,
  'contour.streaks': 1,
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
  const pack = PACKS.find((p) => p.id === PACK_ID)
  for (const look of RECIPE_IDS) {
    const seed = seedOverride ? Number(seedOverride) : SEEDS[look]
    const scene = withFilter(buildScene(look, pack, seed, DEFAULT_CONTROLS, 16 / 9), { filter: 'none', strength: 0 })
    const image = await harness.render({ scene, ...LOOK_SIZE, supersample: 2 })
    const file = path.join(outDir, `${fileName(look)}.webp`)
    await raw(image).webp({ quality: 82 }).toFile(file)
    written.push({ file, label: `${look} ${pack.id} s${seed}` })
  }
} finally {
  await harness.close()
}
for (const { file } of written) console.log(path.relative(process.cwd(), file))

if (sheetFile) {
  const cols = 7
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
