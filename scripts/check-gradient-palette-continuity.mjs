import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stage = process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-')
if (!/^[a-zA-Z0-9_-]+$/.test(stage)) throw Error('Use letters, numbers, underscores or hyphens for the evidence stage.')
const directory = path.join(root, '.devshots/gradient-palette-continuity', stage)
await mkdir(directory, { recursive: true })

const watchedFiles = [
  'src/core/lab/gradients/palette.ts', 'src/core/lab/gradients/render.ts',
  'src/core/lab/gradients/source.ts', 'src/core/lab/gradients/shader.ts',
  'src/core/lab/gradients/families.ts', 'src/core/lab/gradients/diffusion.ts',
  'src/core/lab/gradients/flow.ts', 'src/core/lab/gradients/flowSource.ts',
  'src/core/lab/gradients/smear.ts', 'src/core/lab/gradients/color.ts',
  'src/features/background-generator/palette/registry.ts', 'scripts/fixtures/rendered-loop.png',
]
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(watchedFiles.map(async file => [
    file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex'),
  ])))
}
const before = await sourceHashes()
const startedAt = new Date().toISOString()
const server = await createServer({
  configFile: false, root, logLevel: 'error',
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 0, watch: null },
})
let browser
const results = [], runtimeErrors = []
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  })
  const page = await browser.newPage()
  page.on('pageerror', error => runtimeErrors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/look-thumbnails.html`)
  await page.waitForFunction(() => document.documentElement.dataset.thumbnails === 'ready')
  await page.evaluate(async () => {
    const image = new Image()
    image.src = '/scripts/fixtures/rendered-loop.png'
    await image.decode()
    const { createLabSourceFromImage } = await import('/src/core/lab/sourceCache.ts')
    window.paletteContinuitySource = createLabSourceFromImage(image, image.naturalWidth, image.naturalHeight)
  })

  const cases = []
  for (const mode of ['2d', '3d']) for (const palette of ['bold', 'primary']) {
    for (const style of ['diffusion', 'halo', 'flow', 'smear']) {
      for (const position of ['first', 'middle', 'last']) cases.push({ kind: 'removal', mode, palette, style, position, seed: 1913 })
    }
  }
  for (const palette of ['blues', 'primary', 'atmospheric']) {
    for (const style of ['diffusion', 'halo', 'flow', 'smear']) {
      for (const seed of [1913, 9027]) cases.push({ kind: 'roles', mode: '3d', palette, style, seed })
    }
  }

  for (const scenario of cases) {
    const result = await page.evaluate(scenario => {
      const { createDefaultBackgroundRecipe, colorMixForPack, PALETTE_PACKS, renderExample } = window
      const pack = PALETTE_PACKS.find(p => p.id === scenario.palette)
      if (!pack) throw Error(`Missing actual palette: ${scenario.palette}`)
      const recipe = createDefaultBackgroundRecipe(scenario.seed)
      recipe.palette = { packId: pack.id, mix: colorMixForPack(pack), ground: pack.colors.at(-1), ink: pack.colors[0] }
      recipe.look = {
        version: 'gradients', id: scenario.style, detail: .5,
        gradient: { softness: .65, distortion: .45, grain: 0, depth: .45, reflow: .5 },
      }
      recipe.motion = { ...recipe.motion, enabled: false, amount: 0 }
      const source = scenario.mode === '3d' ? window.paletteContinuitySource : null
      const render = input => {
        const canvas = renderExample(input, source, 320)
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        return { canvas, data }
      }
      const difference = (a, b) => {
        let max = 0, sum = 0, changedPixels = 0
        for (let i = 0; i < a.length; i += 4) {
          let pixelMax = 0
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(a[i + c] - b[i + c])
            sum += d; max = Math.max(max, d); pixelMax = Math.max(pixelMax, d)
          }
          if (pixelMax > 1) changedPixels++
        }
        return { maxChannel: max, meanChannel: sum / (a.length * .75), fractionPixelsOverOne: changedPixels / (a.length / 4) }
      }
      const comparison = (frames, a, b) => {
        const width = a.canvas.width, height = a.canvas.height
        const diff = document.createElement('canvas')
        diff.width = width; diff.height = height
        const dc = diff.getContext('2d'), data = dc.createImageData(width, height)
        for (let i = 0; i < data.data.length; i += 4) {
          for (let c = 0; c < 3; c++) data.data[i + c] = Math.min(255, Math.abs(a.data[i + c] - b.data[i + c]) * 8)
          data.data[i + 3] = 255
        }
        dc.putImageData(data, 0, 0)
        const panels = [...frames, { label: 'Difference x8', canvas: diff }]
        const sheet = document.createElement('canvas')
        sheet.width = width * panels.length; sheet.height = height + 32
        const ctx = sheet.getContext('2d')
        ctx.fillStyle = '#101214'; ctx.fillRect(0, 0, sheet.width, sheet.height)
        panels.forEach((panel, i) => {
          ctx.drawImage(panel.canvas, i * width, 0)
          ctx.fillStyle = '#FFFFFF'; ctx.font = '12px sans-serif'
          ctx.fillText(panel.label, i * width + 8, height + 21)
        })
        return sheet.toDataURL()
      }

      if (scenario.kind === 'roles') {
        const swapped = structuredClone(recipe)
        ;[swapped.palette.ink, swapped.palette.ground] = [recipe.palette.ground, recipe.palette.ink]
        const a = render(recipe), b = render(swapped), metrics = difference(a.data, b.data)
        return {
          scenario, passed: metrics.meanChannel > 3,
          requirement: 'Swapping source-frame ink/ground changes final RGB by more than 3 bytes on average.',
          metrics, recipes: { original: recipe, swapped },
          evidence: comparison([{ label: 'Original roles', canvas: a.canvas }, { label: 'Swapped roles', canvas: b.canvas }], a, b),
        }
      }

      const row = scenario.position === 'first' ? 0 : scenario.position === 'last' ? recipe.palette.mix.length - 1 : Math.floor(recipe.palette.mix.length / 2)
      const removedColor = recipe.palette.mix[row].color
      const absent = structuredClone(recipe)
      absent.palette.packId = 'custom'
      absent.palette.mix.splice(row, 1)
      // Match ColorsPanel's role replacements when a row reaches zero.
      if (absent.palette.ink === removedColor) absent.palette.ink = absent.palette.mix[0].color
      if (absent.palette.ground === removedColor) absent.palette.ground = absent.palette.mix.at(-1).color
      const zero = structuredClone(absent)
      zero.palette.mix.splice(row, 0, { color: removedColor, enabled: true, ratio: 0 })
      const disabled = structuredClone(absent)
      disabled.palette.mix.splice(row, 0, { color: removedColor, enabled: false, ratio: 999 })
      const trace = structuredClone(recipe)
      trace.palette.packId = 'custom'
      trace.palette.mix[row].ratio = .0001
      const a = render(absent), b = render(trace), z = render(zero), d = render(disabled)
      const traceMetrics = difference(a.data, b.data)
      const zeroMetrics = difference(a.data, z.data)
      const disabledMetrics = difference(a.data, d.data)
      const checks = {
        traceContinuity: traceMetrics.maxChannel <= 1 || traceMetrics.meanChannel <= .1,
        zeroExcluded: zeroMetrics.maxChannel === 0,
        disabledExcluded: disabledMetrics.maxChannel === 0,
      }
      return {
        scenario, row, removedColor, checks, passed: Object.values(checks).every(Boolean),
        requirement: 'Trace weight .0001 vs absent: max channel <=1 OR mean channel <=0.1. Zero and disabled rows: exact exclusion.',
        metrics: { trace: traceMetrics, zero: zeroMetrics, disabled: disabledMetrics },
        recipes: { absent, trace, zero, disabled },
        evidence: comparison([{ label: 'Color absent', canvas: a.canvas }, { label: 'Weight 0.0001', canvas: b.canvas }, { label: 'Weight zero', canvas: z.canvas }], a, b),
      }
    }, scenario)

    const name = [scenario.kind, scenario.mode, scenario.palette, scenario.style, scenario.position, scenario.seed].filter(Boolean).join('-')
    const { evidence, ...record } = result
    await writeFile(path.join(directory, `${name}.png`), Buffer.from(evidence.split(',')[1], 'base64'))
    await writeFile(path.join(directory, `${name}.json`), JSON.stringify(record, null, 2))
    results.push({ name, ...record })
    const metric = result.scenario.kind === 'roles' ? result.metrics : result.metrics.trace
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${name}: mean ${metric.meanChannel.toFixed(4)}, max ${metric.maxChannel}`)
  }
} finally {
  const after = await sourceHashes()
  const changedFiles = watchedFiles.filter(file => before[file] !== after[file])
  const failures = results.filter(result => !result.passed)
  const report = {
    startedAt, finishedAt: new Date().toISOString(), fixture: 'scripts/fixtures/rendered-loop.png',
    dimensions: '320x180', expectedCases: 72, completedCases: results.length,
    stableSourceSnapshot: changedFiles.length === 0, changedFiles, before, after,
    runtimeErrors, failures: failures.map(result => result.name), results,
  }
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  const summary = [
    `${results.length}/72 cases completed; ${failures.length} failed.`,
    `Stable renderer snapshot: ${changedFiles.length === 0}.`,
    ...failures.map(result => `${result.name}: ${JSON.stringify(result.metrics)}`),
    ...runtimeErrors.map(error => `Browser error: ${error}`),
    ...(changedFiles.length ? [`Renderer changed during run: ${changedFiles.join(', ')}. Rerun before interpreting this report.`] : []),
  ].join('\n')
  await writeFile(path.join(directory, 'summary.txt'), summary)
  console.log(`${summary}\nEvidence: ${directory}`)
  if (failures.length || runtimeErrors.length || changedFiles.length || results.length !== 72) process.exitCode = 1
  await browser?.close()
  await server.close()
}
