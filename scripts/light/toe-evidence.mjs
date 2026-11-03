// The paper toe on every recipe's pack output: the tool's scene (the recipe's compose, controls at 0.5) for the
// three packs at 16:9 and seeds 1-4, rendered with output.toe 0 and 1, side by side with 3x crops of the window
// the toe changes most. Prints the mean Oklab ΔE between the two per scene and the mean inside that window.
// With --preset <path> it renders that one preset instead, at --size (default 960x640), toe 0 and 1.
// Usage: node scripts/light/toe-evidence.mjs [--recipe <id>[,<id>...]] [--seeds 1,2,3,4] [--preset <path> [--size WxH]] [--out dir]
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs, parseSize } from './lib/args.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { composeRow, cropRgba, zoom } from './lib/images.mjs'
import { readPreset } from './lib/references.mjs'

/** Rows of captioned panels (one composeRow each), stacked into one sheet. */
async function composeRows(file, rows) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toe-evidence-'))
  try {
    const files = []
    for (const [i, panels] of rows.entries()) {
      files.push(path.join(dir, `${i}.png`))
      await composeRow(files[i], panels)
    }
    const metas = await Promise.all(files.map((rowFile) => sharp(rowFile).metadata()))
    const gap = 8
    let top = 0
    const composites = files.map((input, i) => {
      const placed = { input, left: 0, top }
      top += metas[i].height + gap
      return placed
    })
    await mkdir(path.dirname(file), { recursive: true })
    await sharp({ create: { width: Math.max(...metas.map((m) => m.width)), height: top - gap, channels: 3, background: '#161616' } })
      .composite(composites)
      .png()
      .toFile(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const args = parseArgs()
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'artifacts/toe-evidence')
const presetFile = typeof args.preset === 'string' ? path.resolve(ROOT, args.preset) : null
const recipes = presetFile
  ? []
  : list(args.recipe).length
    ? list(args.recipe)
    : ['sunset.ramp', 'sunset.bands', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']
const seeds = list(args.seeds).length ? list(args.seeds).map(Number) : [1, 2, 3, 4]
const PACKS = ['bold', 'elemental', 'atmospheric']
const SIZE = { width: 640, height: 360 }
const WINDOW = { width: 160, height: 90 }

const harness = await startHarness()
try {
  const info = await harness.info()
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  const { linearToOklab } = await harness.ssr('/src/light/color/oklab.ts')
  const { srgbToLinear } = await harness.ssr('/src/light/color/srgb.ts')
  const oklab = (image) => {
    const out = new Float32Array(image.width * image.height * 3)
    for (let i = 0; i < image.width * image.height; i++) {
      const lab = linearToOklab([0, 1, 2].map((k) => srgbToLinear(image.data[i * 4 + k] / 255)))
      out.set(lab, i * 3)
    }
    return out
  }
  /** Renders a scene at toe 0 and 1 and finds the window of `win` the toe changes most. */
  const pair = async (scene, size, win) => {
    const renders = []
    for (const toe of [0, 1]) renders.push(await harness.render({ scene: { ...scene, output: { ...(scene.output ?? {}), toe } }, ...size }))
    const a = oklab(renders[0])
    const b = oklab(renders[1])
    const w = size.width
    const h = size.height
    // Summed-area table of the per-pixel ΔE, then the window with the largest mean.
    const table = new Float64Array((w + 1) * (h + 1))
    let total = 0
    for (let y = 0; y < h; y++) {
      let row = 0
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2])
        total += d
        row += d
        table[(y + 1) * (w + 1) + x + 1] = table[y * (w + 1) + x + 1] + row
      }
    }
    const at = (yy, xx) => table[yy * (w + 1) + xx]
    let best = { mean: -1, x: 0, y: 0 }
    for (let y = 0; y + win.height <= h; y += 10) {
      for (let x = 0; x + win.width <= w; x += 10) {
        const mean = (at(y + win.height, x + win.width) - at(y, x + win.width) - at(y + win.height, x) + at(y, x)) / (win.width * win.height)
        if (mean > best.mean) best = { mean, x, y }
      }
    }
    const crops = await Promise.all(renders.map(async (image) => zoom(await cropRgba(image, best.x, best.y, win.width, win.height), 3)))
    return { renders, crops, best, mean: total / (w * h) }
  }
  if (presetFile) {
    const preset = await readPreset(presetFile)
    const size = args.size ? parseSize(args.size) : { width: 960, height: 640 }
    const result = await pair(preset.scene, size, { width: Math.round(size.width / 4), height: Math.round(size.height / 4) })
    const file = path.join(outDir, `${preset.id}.png`)
    await composeRows(file, [
      [
        { image: result.renders[0], caption: `${preset.id}, toe 0` },
        { image: result.renders[1], caption: 'toe 1' },
      ],
      [
        { image: result.crops[0], caption: `toe 0, 3x at ${result.best.x},${result.best.y}` },
        { image: result.crops[1], caption: 'toe 1, 3x' },
      ],
    ])
    console.log(`${preset.id}: ${path.relative(ROOT, file)}; mean ΔE ${result.mean.toFixed(4)}, window ${result.best.mean.toFixed(4)}`)
  }
  for (const recipe of recipes) {
    if (info.recipeErrors[recipe]) {
      console.log(`${recipe}: did not load: ${info.recipeErrors[recipe].split('\n')[0]}`)
      continue
    }
    const rows = []
    const summary = []
    for (const pack of PACKS) {
      for (const seed of seeds) {
        const scene = buildScene(recipe, getPack(pack), seed, { intensity: 0.5, softness: 0.5, mood: 0.5 }, 16 / 9)
        const { renders, crops, best, mean } = await pair(scene, SIZE, WINDOW)
        const label = `${pack} seed ${seed}`
        rows.push([
          { image: renders[0], caption: `${recipe} ${label}, toe 0` },
          { image: renders[1], caption: 'toe 1' },
          { image: crops[0], caption: `toe 0, 3x at ${best.x},${best.y}` },
          { image: crops[1], caption: 'toe 1, 3x' },
        ])
        summary.push(`${label}: mean ΔE ${mean.toFixed(4)}, window ${best.mean.toFixed(4)}`)
      }
    }
    const file = path.join(outDir, `${recipe}.png`)
    await composeRows(file, rows)
    console.log(`${recipe}: ${path.relative(ROOT, file)}\n  ${summary.join('\n  ')}`)
  }
} finally {
  await harness.close()
}
