// Fits a reference preset's numbers (and optionally colors, in Oklab) to its target with Nelder-Mead.
// Usage: node scripts/light/fit.mjs --ref <id> [--params a,b,c | all] [--colors [all | slot,slot]]
//          [--lens bloom,bloomRadius,...] [--iters 400] [--restarts 2] [--size 256]
//          [--weights image,rows,columns] [--preset <path>] [--write] [--out <dir>]
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { list, parseArgs } from './lib/args.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { composeCompare, loadRgba, savePng } from './lib/images.mjs'
import { loadReferences, presetPathFor, readPreset } from './lib/references.mjs'

const args = parseArgs()
const id = typeof args.ref === 'string' ? args.ref : null
if (!id) {
  console.error('Give --ref <id>')
  process.exit(2)
}
const maxEvals = Number(args.iters ?? 400)
const restarts = Number(args.restarts ?? 2)
const fitLong = Number(args.size ?? 256)
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'artifacts/light-fit', id)
const weights = (() => {
  const values = list(args.weights).map(Number)
  return values.length === 3 ? { image: values[0], rows: values[1], columns: values[2] } : undefined
})()

/** Minimizes f over [0,1]^n from x0 (values outside are clamped). Returns the best point and value. */
async function nelderMead(f, x0, steps, budget, onProgress) {
  const n = x0.length
  const clamp = (x) => x.map((v) => Math.min(1, Math.max(0, v)))
  let evals = 0
  const evaluate = async (points) => {
    evals += points.length
    return f(points.map(clamp))
  }
  const start = [clamp(x0)]
  for (let i = 0; i < n; i++) {
    const p = [...start[0]]
    p[i] = p[i] + steps[i] <= 1 ? p[i] + steps[i] : p[i] - steps[i]
    start.push(p)
  }
  const values = await evaluate(start)
  let simplex = start.map((x, i) => ({ x, v: values[i] }))
  while (evals < budget) {
    simplex.sort((a, b) => a.v - b.v)
    onProgress?.(simplex[0].v, evals)
    const best = simplex[0]
    const worst = simplex[n]
    const spread = Math.abs(worst.v - best.v)
    if (spread < 1e-6) break
    const centroid = new Array(n).fill(0)
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) centroid[k] += simplex[i].x[k] / n
    const along = (t) => clamp(centroid.map((c, k) => c + t * (worst.x[k] - c)))
    const reflected = along(-1)
    const [vr] = await evaluate([reflected])
    if (vr < best.v) {
      const expanded = along(-2)
      const [ve] = await evaluate([expanded])
      simplex[n] = ve < vr ? { x: expanded, v: ve } : { x: reflected, v: vr }
    } else if (vr < simplex[n - 1].v) {
      simplex[n] = { x: reflected, v: vr }
    } else {
      const contracted = vr < worst.v ? along(-0.5) : along(0.5)
      const [vc] = await evaluate([contracted])
      if (vc < Math.min(vr, worst.v)) {
        simplex[n] = { x: contracted, v: vc }
      } else {
        const shrunk = simplex.slice(1).map((s) => clamp(s.x.map((v, k) => best.x[k] + 0.5 * (v - best.x[k]))))
        const shrunkValues = await evaluate(shrunk)
        simplex = [best, ...shrunk.map((x, i) => ({ x, v: shrunkValues[i] }))]
      }
    }
  }
  simplex.sort((a, b) => a.v - b.v)
  return { x: simplex[0].x, v: simplex[0].v, evals }
}

const started = Date.now()
const harness = await startHarness()
try {
  const { references, presetDir } = await loadReferences(harness)
  const ref = references.find((r) => r.id === id)
  if (!ref) throw new Error(`${id} is not in the reference list`)
  const presetFile = typeof args.preset === 'string' ? path.resolve(ROOT, args.preset) : presetPathFor(presetDir, id)
  if (!existsSync(presetFile)) throw new Error(`No preset at ${path.relative(ROOT, presetFile)}`)
  const preset = await readPreset(presetFile)
  const info = await harness.info()
  const recipe = info.recipes.find((r) => r.id === preset.scene.recipe)
  if (!recipe) throw new Error(`Unknown recipe ${preset.scene.recipe}`)
  const { linearToOklab, oklabToLinear } = await harness.ssr('/src/light/color/oklab.ts')
  const { hexToLinear, linearToHex } = await harness.ssr('/src/light/color/srgb.ts')
  const { LENS_NUMBERS, DEFAULT_LENS } = await harness.ssr('/src/light/scene.ts')
  const { HEATMAP_MAX } = await harness.ssr('/src/light/audit/metrics.ts')

  // Variables: each maps x in [0,1] to a value and writes it into a scene.
  const variables = []
  const paramKeys = args.params === 'all' ? recipe.params.map((p) => p.key) : list(args.params)
  for (const key of paramKeys) {
    const spec = recipe.params.find((p) => p.key === key)
    if (!spec) throw new Error(`${recipe.id} has no param ${key}`)
    if (spec.kind === 'boolean') continue
    if (args.params === 'all' && spec.kind === 'number' && spec.step >= 1) continue
    const current = preset.scene.params[key] ?? spec.default
    const span = spec.max - spec.min
    if (spec.kind === 'number') {
      variables.push({
        name: key,
        step: 0.06,
        x0: (current - spec.min) / span,
        apply: (scene, x) => (scene.params[key] = round(spec.min + x * span)),
      })
    } else {
      current.forEach((value, i) => {
        variables.push({
          name: `${key}[${i}]`,
          step: 0.03,
          x0: (value - spec.min) / span,
          apply: (scene, x) => {
            const vector = Array.isArray(scene.params[key]) ? [...scene.params[key]] : [...current]
            vector[i] = round(spec.min + x * span)
            scene.params[key] = vector
          },
        })
      })
    }
  }
  if (args.colors) {
    const slots = args.colors === true || args.colors === 'all' ? recipe.colorSlots.map((s) => s.key) : list(args.colors)
    for (const key of slots) {
      const index = recipe.colorSlots.findIndex((s) => s.key === key)
      if (index < 0) throw new Error(`${recipe.id} has no color slot ${key}`)
      const lab = linearToOklab(hexToLinear(preset.scene.colors[index] ?? recipe.defaultColors[index]))
      const components = [
        { name: `${key}.L`, x0: lab[0], to: (x) => x },
        { name: `${key}.a`, x0: (lab[1] + 0.4) / 0.8, to: (x) => x * 0.8 - 0.4 },
        { name: `${key}.b`, x0: (lab[2] + 0.4) / 0.8, to: (x) => x * 0.8 - 0.4 },
      ]
      components.forEach((component, k) => {
        variables.push({
          name: component.name,
          step: 0.03,
          x0: component.x0,
          apply: (scene, x) => {
            const current = scene.colorLab?.[index] ?? [...lab]
            current[k] = component.to(x)
            scene.colorLab = { ...scene.colorLab, [index]: current }
          },
        })
      })
    }
  }
  for (const key of list(args.lens)) {
    const spec = LENS_NUMBERS.find((s) => s.key === key)
    if (!spec) throw new Error(`No numeric lens setting ${key}`)
    const current = preset.scene.lens?.[key] ?? recipe.lens[key] ?? DEFAULT_LENS[key]
    const span = spec.max - spec.min
    variables.push({ name: `lens.${key}`, step: 0.06, x0: (current - spec.min) / span, apply: (scene, x) => (scene.lens[key] = round(spec.min + x * span)) })
  }
  if (variables.length === 0) throw new Error('Nothing to fit: give --params, --colors or --lens')

  const sceneFor = (x) => {
    const scene = structuredClone(preset.scene)
    scene.params = { ...scene.params }
    scene.lens = { ...scene.lens }
    scene.colors = [...scene.colors]
    variables.forEach((variable, i) => variable.apply(scene, x[i]))
    if (scene.colorLab) {
      for (const [index, lab] of Object.entries(scene.colorLab)) {
        scene.colors[index] = linearToHex(oklabToLinear(lab).map((v) => Math.min(1, Math.max(0, v))))
      }
      delete scene.colorLab
    }
    return scene
  }

  const scale = fitLong / Math.max(ref.width, ref.height)
  const fitSize = { width: Math.max(8, Math.round(ref.width * scale)), height: Math.max(8, Math.round(ref.height * scale)) }
  const target = await loadRgba(ref.file)
  harness.putBlob('fit-target', target)
  await harness.call('fitSetup', { targetKey: 'fit-target', ignore: ref.ignore, cornerRadius: ref.cornerRadius, ...fitSize })

  const lossOf = async (points) => {
    const parts = await harness.call('fitLoss', points.map(sceneFor), weights)
    return parts.map((p) => p.total)
  }
  const x0 = variables.map((v) => Math.min(1, Math.max(0, v.x0)))
  const [before] = await harness.call('fitLoss', [sceneFor(x0)], weights)
  console.log(`${id}: fitting ${variables.length} values at ${fitSize.width}x${fitSize.height}; loss before ${before.total.toFixed(4)} (image ${before.image.toFixed(4)}, rows ${before.rows.toFixed(4)}, columns ${before.columns.toFixed(4)})`)

  const fitStart = Date.now()
  let best = { x: x0, v: before.total }
  let evals = 0
  const history = []
  for (let round = 0; round <= restarts; round++) {
    const budget = Math.floor((maxEvals - evals) / (restarts - round + 1))
    if (budget < variables.length + 2) break
    const steps = variables.map((v) => v.step / 2 ** round)
    const result = await nelderMead(lossOf, best.x, steps, budget, (value, count) => history.push([evals + count, value]))
    evals += result.evals
    if (result.v < best.v) best = { x: result.x, v: result.v }
    console.log(`  round ${round + 1}: loss ${result.v.toFixed(4)} after ${result.evals} renders`)
  }
  const fitSeconds = (Date.now() - fitStart) / 1000
  const [after] = await harness.call('fitLoss', [sceneFor(best.x)], weights)
  console.log(
    `${id}: loss after ${after.total.toFixed(4)} (image ${after.image.toFixed(4)}, rows ${after.rows.toFixed(4)}, columns ${after.columns.toFixed(4)}); ` +
      `${evals} renders in ${fitSeconds.toFixed(1)} s (${((fitSeconds * 1000) / Math.max(1, evals)).toFixed(1)} ms each)`,
  )
  const fittedScene = sceneFor(best.x)
  for (const [i, variable] of variables.entries()) {
    if (Math.abs(best.x[i] - x0[i]) > 1e-4) console.log(`  ${variable.name}: ${x0[i].toFixed(3)} -> ${best.x[i].toFixed(3)} (normalized)`)
  }
  const fitted = { id: preset.id, referenceId: preset.referenceId ?? id, scene: orderScene(fittedScene) }

  // Full-size compare sheet for the result.
  harness.putBlob('target', target)
  const audit = await harness.call('audit', {
    scene: fitted.scene,
    width: target.width,
    height: target.height,
    supersample: 2,
    targetKey: 'target',
    ignore: ref.ignore,
    cornerRadius: ref.cornerRadius,
    upload: 'render',
    heatmapUpload: 'heatmap',
  })
  const render = { width: target.width, height: target.height, data: harness.takeUpload('render') }
  const heatmap = { width: target.width, height: target.height, data: harness.takeUpload('heatmap') }
  await mkdir(outDir, { recursive: true })
  await savePng(path.join(outDir, 'render.png'), render)
  await composeCompare(path.join(outDir, 'compare.png'), { target, render, heatmap, rows: audit.rows, heatmapMax: HEATMAP_MAX })
  await writeFile(path.join(outDir, 'preset.json'), JSON.stringify(fitted, null, 2) + '\n')
  await writeFile(
    path.join(outDir, 'fit.json'),
    JSON.stringify({ id, variables: variables.map((v) => v.name), fitSize, before, after, evals, fitSeconds, metrics: audit.metrics, history }, null, 2),
  )
  console.log(`full-size dE mean ${audit.metrics.deltaE.mean.toFixed(4)} p95 ${audit.metrics.deltaE.p95.toFixed(4)}; wrote ${path.relative(ROOT, outDir)}/compare.png`)
  if (args.write) {
    await writeFile(presetFile, JSON.stringify(fitted, null, 2) + '\n')
    console.log(`updated ${path.relative(ROOT, presetFile)}`)
  }
  console.log(`total ${((Date.now() - started) / 1000).toFixed(1)} s`)
} finally {
  await harness.close()
}

function round(value) {
  return Math.round(value * 1e4) / 1e4
}

/** Keeps the preset key order of the shared format. */
function orderScene(scene) {
  return { recipe: scene.recipe, seed: scene.seed, colors: scene.colors, params: scene.params, lens: scene.lens, output: scene.output }
}
