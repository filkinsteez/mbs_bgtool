// Renders reference presets at the target size and writes compare sheets and metrics.
// Usage: node scripts/light/audit.mjs --ref <id>[,<id>...] | --all
//          [--preset <path>] [--size WxH ...] [--export4k] [--ss 1|2] [--out <dir>]
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { list, parseArgs, parseSize } from './lib/args.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { composeCompare, composeSheet, cropRgba, loadRgba, resizeRgba, savePng, zoom } from './lib/images.mjs'
import { loadReferences, presetPathFor, readPreset } from './lib/references.mjs'

const args = parseArgs()
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'artifacts/light-audit')
const sizes = list(args.size).map(parseSize)
const supersample = args.ss ? Number(args.ss) : 2
const requested = list(args.ref)
if (!args.all && requested.length === 0) {
  console.error('Give --ref <id>[,<id>...] or --all')
  process.exit(2)
}
if (args.preset && requested.length !== 1) {
  console.error('--preset needs exactly one --ref')
  process.exit(2)
}

/** Top-left corners of the smoothest ramp, the brightest window and the darkest window that still has a gradient, searched on a 1/8 copy. */
async function findCrops(image, cropSize) {
  const factor = 8
  const w = Math.max(1, Math.round(image.width / factor))
  const h = Math.max(1, Math.round(image.height / factor))
  const small = await resizeRgba(image, w, h, 'cubic')
  const luma = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) luma[i] = 0.2126 * small.data[i * 4] + 0.7152 * small.data[i * 4 + 1] + 0.0722 * small.data[i * 4 + 2]
  const win = Math.min(Math.floor(cropSize / factor), w, h)
  // Summed-area tables of luma and of local gradient magnitude.
  const sat = (values) => {
    const table = new Float64Array((w + 1) * (h + 1))
    for (let y = 0; y < h; y++) {
      let row = 0
      for (let x = 0; x < w; x++) {
        row += values[y * w + x]
        table[(y + 1) * (w + 1) + x + 1] = table[y * (w + 1) + x + 1] + row
      }
    }
    return (x, y, s) => table[(y + s) * (w + 1) + x + s] - table[y * (w + 1) + x + s] - table[(y + s) * (w + 1) + x] + table[y * (w + 1) + x]
  }
  const gradient = new Float64Array(w * h)
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      gradient[y * w + x] = Math.abs(luma[y * w + x + 1] - luma[y * w + x]) + Math.abs(luma[(y + 1) * w + x] - luma[y * w + x])
    }
  }
  const lumaSum = sat(luma)
  const gradientSum = sat(gradient)
  let smooth = null
  let bright = null
  let dark = null
  let darkest = null
  for (let y = 0; y + win <= h; y += 2) {
    for (let x = 0; x + win <= w; x += 2) {
      const mean = lumaSum(x, y, win) / (win * win)
      const energy = gradientSum(x, y, win)
      const corners = [luma[y * w + x], luma[y * w + x + win - 1], luma[(y + win - 1) * w + x], luma[(y + win - 1) * w + x + win - 1]]
      const candidate = { x: x * factor, y: y * factor, mean, energy, range: Math.max(...corners) - Math.min(...corners) }
      if (candidate.range >= 3 && (!smooth || energy < smooth.energy)) smooth = candidate
      if (!bright || mean > bright.mean) bright = candidate
      if (candidate.range >= 2 && (!dark || mean < dark.mean)) dark = candidate
      if (!darkest || mean < darkest.mean) darkest = candidate
    }
  }
  return { smooth: smooth ?? darkest, bright, dark: dark ?? darkest }
}

async function writeContactSheet(references) {
  const entries = []
  for (const ref of references) {
    const renderFile = path.join(outDir, ref.id, 'render.png')
    if (!existsSync(renderFile)) continue
    let caption = ref.id
    const metricsFile = path.join(outDir, ref.id, 'metrics.json')
    if (existsSync(metricsFile)) {
      const { metrics } = JSON.parse(await readFile(metricsFile, 'utf8'))
      caption += `  dE ${metrics.deltaE.mean.toFixed(3)} / p95 ${metrics.deltaE.p95.toFixed(3)}`
    }
    entries.push({ images: [ref.file, renderFile], caption })
  }
  if (entries.length === 0) return null
  const file = path.join(outDir, 'contact-sheet.png')
  await composeSheet(file, entries, { height: 440, imageWidth: 300, columns: 4 })
  return file
}

const started = Date.now()
const harness = await startHarness()
try {
  const { source, references, presetDir } = await loadReferences(harness)
  const { HEATMAP_MAX } = await harness.ssr('/src/light/audit/metrics.ts')
  const { formatFalloff } = await harness.ssr('/src/light/audit/falloff.ts')
  const ids = args.all ? references.map((r) => r.id) : requested
  console.log(`references from ${source}; auditing ${ids.length}`)
  const { recipeErrors } = await harness.info()
  for (const [recipe, message] of Object.entries(recipeErrors)) console.warn(`${recipe} did not load, its references will fail: ${message}`)
  const timings = []
  const failures = []
  for (const id of ids) {
    const ref = references.find((r) => r.id === id)
    if (!ref) {
      console.warn(`${id}: not in the reference list, skipped`)
      continue
    }
    const presetFile = typeof args.preset === 'string' ? path.resolve(ROOT, args.preset) : presetPathFor(presetDir, id)
    if (!existsSync(presetFile)) {
      console.warn(`${id}: no preset at ${path.relative(ROOT, presetFile)}, skipped`)
      continue
    }
    const preset = await readPreset(presetFile)
    if (ref.recipe && preset.scene.recipe !== ref.recipe) {
      console.warn(`${id}: preset uses ${preset.scene.recipe}, the reference list says ${ref.recipe}`)
    }
    const refStart = Date.now()
    const target = await loadRgba(ref.file)
    harness.putBlob('target', target)
    let result
    try {
      result = await harness.call('audit', {
        scene: preset.scene,
        width: target.width,
        height: target.height,
        supersample,
        targetKey: 'target',
        ignore: ref.ignore,
        cornerRadius: ref.cornerRadius,
        upload: 'render',
        heatmapUpload: 'heatmap',
        falloff: ref.mood === 'contour',
      })
    } catch (error) {
      failures.push(id)
      console.warn(`${id}: failed: ${String(error instanceof Error ? error.message : error).split('\n')[0]}`)
      continue
    }
    const render = { width: target.width, height: target.height, data: harness.takeUpload('render') }
    const heatmap = { width: target.width, height: target.height, data: harness.takeUpload('heatmap') }
    const dir = path.join(outDir, id)
    await savePng(path.join(dir, 'render.png'), render)
    const falloffLine = result.falloff ? formatFalloff(result.falloff) : null
    await composeCompare(path.join(dir, 'compare.png'), {
      target,
      render,
      heatmap,
      rows: result.rows,
      heatmapMax: HEATMAP_MAX,
      notes: falloffLine ? [`${falloffLine} (distances from the brightest light, short-side units)`] : [],
    })

    const extra = []
    for (const size of sizes) {
      const image = await harness.render({ scene: preset.scene, ...size, supersample })
      const file = path.join(dir, `render-${size.width}x${size.height}.png`)
      await savePng(file, image)
      extra.push(path.relative(ROOT, file))
    }
    let export4k = null
    if (args.export4k) {
      const scale = 3840 / Math.max(target.width, target.height)
      const size = { width: Math.round(target.width * scale), height: Math.round(target.height * scale) }
      const image = await harness.render({ scene: preset.scene, ...size, supersample: 2 })
      await savePng(path.join(dir, 'export-4k.png'), image)
      const cropSize = 768
      const crops = await findCrops(image, cropSize)
      const written = {}
      for (const [name, at] of Object.entries(crops)) {
        const crop = await cropRgba(image, at.x, at.y, Math.min(cropSize, image.width - at.x), Math.min(cropSize, image.height - at.y))
        await savePng(path.join(dir, `crop-${name}.png`), crop)
        await savePng(path.join(dir, `crop-${name}-contrast4x.png`), await zoom(crop, 1, 4, 128))
        written[name] = { x: at.x, y: at.y, size: cropSize }
      }
      export4k = { ...size, renderMs: Math.round(image.ms), crops: written }
    }

    const seconds = (Date.now() - refStart) / 1000
    timings.push(seconds)
    const { metrics } = result
    await writeFile(
      path.join(dir, 'metrics.json'),
      JSON.stringify(
        {
          id,
          preset: path.relative(ROOT, presetFile),
          target: path.relative(ROOT, ref.file),
          referenceSource: source,
          recipe: preset.scene.recipe,
          supersample,
          metrics,
          falloff: result.falloff,
          timing: { renderMs: Math.round(result.renderMs), metricsMs: Math.round(result.metricsMs), totalSeconds: seconds },
          extraRenders: extra,
          export4k,
        },
        null,
        2,
      ),
    )
    console.log(
      `${id.padEnd(28)} dE mean ${metrics.deltaE.mean.toFixed(4)} p95 ${metrics.deltaE.p95.toFixed(4)}  rows ${metrics.rowProfileDeltaE.mean.toFixed(4)}  cols ${metrics.columnProfileDeltaE.mean.toFixed(4)}  ` +
        `grain ${metrics.grain.target.toFixed(2)}/${metrics.grain.render.toFixed(2)}  ${seconds.toFixed(1)} s`,
    )
    if (falloffLine) console.log(`${''.padEnd(28)} ${falloffLine}`)
  }
  const sheet = await writeContactSheet(references)
  if (sheet) console.log(`contact sheet: ${path.relative(ROOT, sheet)}`)
  const files = await readdir(outDir).catch(() => [])
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s (${timings.length} references, ${files.length} entries in ${path.relative(ROOT, outDir)}/)`)
  if (failures.length > 0) {
    console.warn(`failed: ${failures.join(', ')}`)
    process.exitCode = 1
  }
} finally {
  await harness.close()
}
