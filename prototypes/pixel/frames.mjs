// Renders the tool's scenes (controls at 0.5, no filter, no grain) through the engine harness and saves them as
// PNG, the input for the Pixel filter prototype. The prototype never touches the engine.
//
//   node prototypes/pixel/frames.mjs [--looks ramp,rim] [--packs bold] [--seeds 1,2] [--sizes 1920x1080,1080x1920]
//     [--out prototypes/pixel/out/frames]
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { parseArgs } from '../../scripts/light/lib/args.mjs'
import { ROOT, startHarness } from '../../scripts/light/lib/harness.mjs'

const LOOKS = {
  ramp: 'sunset.ramp',
  bands: 'sunset.bands',
  blooms: 'sunset.blooms',
  rim: 'contour.rim',
  halo: 'contour.halo',
  beam: 'contour.beam',
  streaks: 'contour.streaks',
}

const args = parseArgs(process.argv.slice(2))
const list = (value, fallback) => (typeof value === 'string' ? value.split(',').filter(Boolean) : fallback)
const looks = list(args.looks, Object.keys(LOOKS))
const packs = list(args.packs, ['bold', 'elemental', 'atmospheric'])
const seeds = list(args.seeds, ['1']).map(Number)
const sizes = list(args.sizes, ['1920x1080']).map((s) => s.split('x').map(Number))
const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join(ROOT, 'prototypes/pixel/out/frames'))
await fs.mkdir(outDir, { recursive: true })

const harness = await startHarness()
try {
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  const { recipeErrors } = await harness.info()
  for (const look of looks) {
    const recipe = LOOKS[look]
    if (!recipe) throw new Error(`Unknown look ${look}`)
    if (recipeErrors[recipe]) {
      console.log(`skip ${look}: ${recipeErrors[recipe]}`)
      continue
    }
    for (const pack of packs) {
      for (const seed of seeds) {
        for (const [width, height] of sizes) {
          const scene = buildScene(recipe, getPack(pack), seed, { intensity: 0.5, softness: 0.5, mood: 0.5 }, width / height)
          scene.output = { ...scene.output, grain: 0 }
          const image = await harness.render({ scene, width, height, supersample: 2 })
          const file = path.join(outDir, `${look}-${pack}-s${seed}-${width}x${height}.png`)
          await sharp(image.data, { raw: { width, height, channels: 4 } }).removeAlpha().png({ compressionLevel: 6 }).toFile(file)
          console.log(`${path.relative(ROOT, file)} ${image.ms.toFixed(0)} ms`)
        }
      }
    }
  }
} finally {
  await harness.close()
}
