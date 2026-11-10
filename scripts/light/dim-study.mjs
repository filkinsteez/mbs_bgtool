// Dim warm light: each warm pack color from 0.05x to 1x nominal (evenly in stops) on black and on dark bases,
// rendered through the engine with lens, grain and dither off, with the paper toe off and at 1. Prints hex and
// Oklch L, C, h at whole stops below nominal, read back from the renders, and renders the contour.beam Elemental
// scenes whose light is Lime or Tan with the toe off and at 1.
// Usage: node scripts/light/dim-study.mjs [--out dir]
import path from 'node:path'
import { parseArgs } from './lib/args.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { composeRow, savePng } from './lib/images.mjs'

const args = parseArgs()
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'artifacts/dim-study')
const WIDTH = 1200
const ROW_HEIGHT = 90
const noLens = { bloom: 0, halation: 0, glare: 0 }

const harness = await startHarness()
try {
  const { DIM_ROWS, DIM_RAMP_LOW } = await harness.ssr('/scripts/light/harness/testPrograms.ts')
  const { linearToOklch } = await harness.ssr('/src/light/color/oklab.ts')
  const { srgbToLinear } = await harness.ssr('/src/light/color/srgb.ts')
  const hex = (bytes) => `#${bytes.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  const sheets = []
  for (const toe of [0, 1]) {
    const scene = { program: 'test.dimramps', lens: noLens, output: { grain: 0, toe } }
    const image = await harness.render({ scene, width: WIDTH, height: ROW_HEIGHT * DIM_ROWS.length, dither: false })
    await savePng(path.join(outDir, `dim-ramps-toe${toe}.png`), image)
    sheets.push({ image, caption: toe ? 'paper toe 1' : 'today (toe off)' })
    console.log(`\npaper toe ${toe}`)
    for (const [index, row] of DIM_ROWS.entries()) {
      const base = row.baseLevel > 0 ? `${row.base} x ${row.baseLevel}` : 'black'
      const cells = [0, 1, 2, 3, 4].map((stops) => {
        const x = Math.min(WIDTH - 1, Math.round((Math.log(2 ** -stops / DIM_RAMP_LOW) / Math.log(1 / DIM_RAMP_LOW)) * WIDTH))
        const i = ((index * ROW_HEIGHT + ROW_HEIGHT / 2) * WIDTH + x) * 4
        const bytes = [image.data[i], image.data[i + 1], image.data[i + 2]]
        const [L, C, h] = linearToOklch(bytes.map((v) => srgbToLinear(v / 255)))
        return `-${stops}: ${hex(bytes)} L${L.toFixed(2)} C${C.toFixed(3)} h${C > 0.01 ? h.toFixed(0) : '-'}`
      })
      console.log(`${row.light} on ${base.padEnd(16)} ${cells.join(' | ')}`)
    }
  }
  await composeRow(path.join(outDir, 'dim-ramps-before-after.png'), sheets)

  // Elemental beam scenes whose light is Lime or Tan, as the tool composes them.
  const info = await harness.info()
  if (info.recipeErrors['contour.beam']) {
    console.log(`\ncontour.beam did not load: ${info.recipeErrors['contour.beam'].split('\n')[0]}`)
  } else {
    const found = new Map()
    for (let seed = 1; seed <= 24 && found.size < 2; seed++) {
      const scene = await harness.call('compose', 'contour.beam', 'elemental', { intensity: 0.5, softness: 0.5, mood: 0.5 }, seed, 16 / 9)
      for (const light of ['#D6F26C', '#B8996E']) if (!found.has(light) && scene.colors.includes(light)) found.set(light, { seed, scene })
    }
    for (const [light, { seed, scene }] of found) {
      const renders = []
      for (const toe of [0, 1]) {
        const image = await harness.render({ scene: { ...scene, output: { ...(scene.output ?? {}), toe } }, width: 1280, height: 720 })
        renders.push({ image, caption: `contour.beam elemental seed ${seed}, toe ${toe}` })
      }
      const file = path.join(outDir, `beam-${light.slice(1).toLowerCase()}-before-after.png`)
      await composeRow(file, renders)
      console.log(`\n${light} beam (seed ${seed}): ${path.relative(ROOT, file)}`)
    }
  }
  console.log(`\nsheets: ${path.relative(ROOT, outDir)}/dim-ramps-before-after.png (rows in the order above; 0.05x left, 1x right)`)
} finally {
  await harness.close()
}
