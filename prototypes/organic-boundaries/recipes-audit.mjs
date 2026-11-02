// The boundary audit on the engine's current Sunset recipes.
// node recipes-audit.mjs [--only refs|packs] [--recipes ramp,bands,blooms] [--no-render]
//
// 1. Reference presets: scripts/light/audit.mjs renders each one at its target's
//    size; the render is projected onto the target's color path and checked
//    against the 1:1 bands.
// 2. Pack frames: each recipe's compose with every control at 0.5, Bold /
//    Elemental / Atmospheric, seeds 1-3, 16:9 and 9:16, rendered through the
//    engine and checked against the generic bands. The main transitions are found
//    from the frame's own color path (one per rise of t between two plateaus).
//
// Writes artifacts/organic-boundaries/recipes/: frame PNGs, isoline sheets,
// report.json and table.md.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { startHarness } from '../../scripts/light/lib/harness.mjs'
import { ROOT, loadReference } from './lib/refs.mjs'
import { SUNSET } from './lib/config.mjs'
import { rampCoordinate, measureBoundaries, summarize, EQUAL_LEVELS } from './lib/audit.mjs'
import { overlay } from './lib/draw.mjs'
import { canvasToLinear } from './lib/output.mjs'
import { canvasFromLinear, loadCanvas, saveCanvas, row, column, resizeCanvas, makeCanvas } from './lib/image.mjs'
import { smooth1d, blurImage } from './lib/blur.mjs'
import { dct } from './lib/isolines.mjs'
import { buildPath, projectToPath } from './lib/rampcoord.mjs'
import { projectTracked } from './lib/tracked.mjs'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const only = opt('--only')
const recipeFilter = (opt('--recipes') ?? 'ramp,bands,blooms').split(',').map((r) => `sunset.${r}`)
const render = !args.includes('--no-render')

const OUT = path.join(ROOT, 'artifacts/organic-boundaries')
const AUDIT_DIR = path.join(OUT, 'light-audit')
const DIR = path.join(OUT, 'recipes')
fs.mkdirSync(DIR, { recursive: true })
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-')
const reportFile = path.join(DIR, 'report.json')
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { refs: {}, packs: {} }

const REF_IDS = Object.keys(SUNSET)
const presetOf = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src/light/presets/references', `${id}.json`), 'utf8'))

// ------------------------------------------------------------------ checks

// The wiggle's spectrum: DCT of the boundary after removing tilt and bow (the
// same residual as the wiggle RMS), so a glow's dome is not counted as a sine.
// Returns the largest component's share of the energy and its wavelength (W).
function wiggleSpectrum(geom) {
  const n = 256
  const r = geom.resid
  const v = Array.from({ length: n }, (_, i) => {
    const x = ((i + 0.5) / n) * r.length - 0.5
    const a = Math.max(0, Math.min(r.length - 1, Math.floor(x)))
    const b = Math.min(r.length - 1, a + 1)
    return r[a] + (r[b] - r[a]) * (x - a)
  })
  const amp = dct(v)
  let tot = 0
  let kBest = 1
  for (let k = 1; k < amp.length; k++) {
    tot += amp[k] ** 2
    if (Math.abs(amp[k]) > Math.abs(amp[kBest])) kBest = k
  }
  return { share: tot ? amp[kBest] ** 2 / tot : 0, lambdaW: (2 * geom.span) / kBest }
}
const bumpAspect = (b, s, h) => (b.spectrum.lambdaW * s.w) / (2 * Math.SQRT2 * (b.wiggleRmsH / 100) * h)
// summarize() keeps the main boundaries with geometry, in order; add their spectra
const withSpectra = (res, s) => {
  const geoms = res.main.filter((m) => m.geom).map((m) => m.geom)
  return { ...s, boundaries: s.boundaries.map((b, i) => ({ ...b, spectrum: wiggleSpectrum(geoms[i]) })) }
}

// 1:1 bands (README, "Audit spec"), per category: pass, and a short note.
function checkOneToOne(t, r) {
  const byName = new Map(r.boundaries.map((b) => [b.name, b]))
  const pairs = t.boundaries.map((a) => [a, byName.get(a.name)]).filter(([, b]) => b)
  const count = (ok) => `${ok.filter(Boolean).length}/${ok.length}`
  const within = (x, y, rel, abs) => Number.isFinite(x) && Number.isFinite(y) && (Math.abs(y - x) <= rel * Math.abs(x) || Math.abs(y - x) <= abs)
  const range = pairs.map(([a, b]) => within(a.rangeH, b.rangeH, 0.35, 1.5))
  const wiggle = pairs.map(([a, b]) => within(a.wiggleRmsH, b.wiggleRmsH, 0.4, 0.3))
  const wanderOk = range.map((v, i) => v && wiggle[i])
  const widthMm = pairs.map(([a, b]) => Number.isFinite(a.width?.minOverMax) && Number.isFinite(b.width?.minOverMax) && Math.abs(a.width.minOverMax - b.width.minOverMax) <= 0.15)
  const widthMean = pairs.map(([a, b]) => within(a.width?.meanH, b.width?.meanH, 0.2, 0))
  const height = pairs.map(([a, b]) => Number.isFinite(a.meanH) && Number.isFinite(b.meanH) && Math.abs(a.meanH - b.meanH) <= 2)
  const lenOk = within(t.horizCorrLenW, r.horizCorrLenW, 0.5, 0)
  const corrOk = Number.isFinite(t.adjacentCorrWiggle) && Number.isFinite(r.adjacentCorrWiggle) && Math.abs(t.adjacentCorrWiggle - r.adjacentCorrWiggle) <= 0.3
  const cvOk = Number.isFinite(r.adjacentSpacingCv) && Math.abs(t.adjacentSpacingCv - r.adjacentSpacingCv) <= 0.12
  const foldOk = r.foldShare <= t.foldShare + 0.005 && (!t.slope || !r.slope || Math.abs(t.slope.p01 - r.slope.p01) <= 0.15)
  return {
    wander: { pass: wanderOk.every(Boolean), note: `${count(wanderOk)} boundaries (range ${count(range)}, wiggle ${count(wiggle)}); wiggle ${pairs.map(([a, b]) => `${f(a.wiggleRmsH)}/${f(b.wiggleRmsH)}`).join(' ')} %H` },
    wavelength: { pass: lenOk, note: `along-boundary corr length ${f(t.horizCorrLenW, 3)}/${f(r.horizCorrLenW, 3)} W` },
    width: { pass: widthMm.every(Boolean), note: `min/max ${count(widthMm)} (${pairs.map(([a, b]) => `${f(a.width?.minOverMax)}/${f(b.width?.minOverMax)}`).join(' ')}); mean width ${count(widthMean)}; height ${count(height)}` },
    neighbours: { pass: corrOk, note: `adjacent wiggle corr ${f(t.adjacentCorrWiggle)}/${f(r.adjacentCorrWiggle)}` },
    spacing: { pass: cvOk, note: `spacing CV ${f(t.adjacentSpacingCv)}/${f(r.adjacentSpacingCv)}` },
    folds: { pass: foldOk, note: `folds ${f(t.foldShare * 100)}/${f(r.foldShare * 100)} %, slope p01 ${f(t.slope?.p01)}/${f(r.slope?.p01)}` },
    matched: `${pairs.length}/${t.boundaries.length}`,
  }
}

// Generic bands for frames without a target (README, "Generic acceptance bands").
function checkGeneric(s, h) {
  const b = s.boundaries.filter((x) => Number.isFinite(x.wiggleRmsH))
  if (!b.length) return null
  const widest = b.reduce((p, q) => ((q.width?.meanH ?? 0) > (p.width?.meanH ?? 0) ? q : p))
  const lowest = b.reduce((p, q) => (q.meanH > p.meanH ? q : p))
  const maxWiggle = Math.max(...b.map((x) => x.wiggleRmsH))
  const wanderOk = widest.wiggleRmsH >= 0.5 && widest.wiggleRmsH <= 2.5 && lowest.wiggleRmsH >= 0.3 && lowest.wiggleRmsH <= 3 && maxWiggle <= 3
  const big = b.filter((x) => x.wiggleRmsH > 0.3)
  const aspects = big.map((x) => bumpAspect(x, s, h))
  const shares = big.map((x) => x.spectrum.share)
  const waveOk = aspects.every((a) => a >= 10) && shares.every((v) => v <= 0.6)
  const mm = b.map((x) => x.width?.minOverMax).filter(Number.isFinite)
  const widths = b.map((x) => x.width?.meanH).filter(Number.isFinite)
  const ratio = widths.length > 1 ? Math.max(...widths) / Math.min(...widths) : NaN
  const widthOk = mm.length > 0 && mm.every((v) => v >= 0.45 && v <= 0.9) && (widths.length < 2 || ratio >= 3)
  // with one boundary there is no neighbour: null means not measured
  const two = b.length > 1 && Number.isFinite(s.adjacentCorrWiggle)
  const corrOk = two ? s.adjacentCorrWiggle <= 0.8 : null
  const cvOk = two ? s.adjacentSpacingCv >= 0.04 : null
  // warp folds only; closed outlines (glows) are reported, not failed
  const foldOk = s.folds.hooks < 0.001 && (!s.slope || s.slope.p01 >= -0.6)
  return {
    wander: { pass: wanderOk, value: { widest: widest.wiggleRmsH, lowest: lowest.wiggleRmsH, max: maxWiggle, all: b.map((x) => x.wiggleRmsH) } },
    wavelength: { pass: waveOk, value: { aspects, shares, lambda: b.map((x) => x.spectrum.lambdaW) } },
    width: { pass: widthOk, value: { minOverMax: mm, widestOverNarrowest: ratio } },
    neighbours: { pass: corrOk, value: s.adjacentCorrWiggle },
    spacing: { pass: cvOk, value: s.adjacentSpacingCv },
    folds: { pass: foldOk, value: { hooks: s.folds.hooks, outlines: s.folds.outlines, raw: s.foldShare, slopeP01: s.slope?.p01 } },
    boundaries: b.length,
  }
}
const mark = (v) => (v === null ? 'n/a' : v ? 'ok' : 'FAIL')

// One main transition per rise of t between two plateaus of the frame's own path.
function autoStops(p) {
  const n = p.bins
  const d = new Float64Array(n)
  for (let b = 1; b < n - 1; b++) d[b] = (p.t[b + 1] - p.t[b - 1]) / 2
  d[0] = d[1]
  d[n - 1] = d[n - 2]
  const s = smooth1d(d, 2)
  const max = Math.max(...s)
  const peaks = []
  for (let b = 1; b < n - 1; b++) if (s[b] >= s[b - 1] && s[b] > s[b + 1] && s[b] >= 0.12 * max) peaks.push(b)
  for (let merged = true; merged; ) {
    merged = false
    for (let k = 0; k + 1 < peaks.length; k++) {
      let dip = Infinity
      for (let q = peaks[k]; q <= peaks[k + 1]; q++) dip = Math.min(dip, s[q])
      if (dip > 0.6 * Math.min(s[peaks[k]], s[peaks[k + 1]])) {
        peaks.splice(s[peaks[k]] < s[peaks[k + 1]] ? k : k + 1, 1)
        merged = true
        break
      }
    }
  }
  const stops = [0]
  for (let k = 0; k + 1 < peaks.length; k++) {
    let lo = peaks[k]
    for (let q = peaks[k]; q <= peaks[k + 1]; q++) if (s[q] < s[lo]) lo = q
    stops.push((lo + 0.5) / n)
  }
  stops.push(0.995)
  return stops.map((pos, i) => [pos, `c${i}`])
}

// Folds counted only where the color changes (t moves by more than 0.01 within
// 4 px of the crossing), so isolines that wander inside a flat ground are not
// counted. A column whose extra crossings of a level lie within 3% H of the first
// is a warp fold (a hook in one boundary); farther apart, it is a closed outline
// (a glow) or the same color in a second band.
function foldKinds(T) {
  const { w, h, t } = T
  const near = 0.03 * h
  let hooks = 0
  let outlines = 0
  for (const level of EQUAL_LEVELS) {
    for (let x = 0; x < w; x++) {
      let state = 0
      const at = []
      for (let y = 0; y < h; y++) {
        const v = t[y * w + x]
        const st = v < level - 0.01 ? -1 : v > level + 0.01 ? 1 : 0
        if (st === 0 || st === state) continue
        if (state !== 0) {
          const a = t[Math.max(0, y - 4) * w + x]
          const b = t[Math.min(h - 1, y + 4) * w + x]
          if (Math.abs(b - a) > 0.01) at.push(y)
        }
        state = st
      }
      if (at.length < 2) continue
      if (at[at.length - 1] - at[0] <= near) hooks++
      else outlines++
    }
  }
  const n = w * EQUAL_LEVELS.length
  return { hooks: hooks / n, outlines: outlines / n }
}

function chooseProjection(blurred, pth) {
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length
  const options = [
    ['row window', projectToPath(blurred, pth, { window: 0.15 })],
    ['column walk', projectTracked(blurred, pth, { ahead: 0.25 })],
    ['column walk, free forward', projectTracked(blurred, pth, { ahead: 1 })],
  ].map(([name, T]) => ({ name, T, dist: mean(T.dist), folds: foldKinds(T) }))
  const bestDist = Math.min(...options.map((o) => o.dist))
  const fit = options.filter((o) => o.dist <= bestDist * 1.2)
  const pick = fit.reduce((a, b) => (b.folds.hooks + b.folds.outlines < a.folds.hooks + a.folds.outlines ? b : a))
  return { T: pick.T, path: pth, method: pick.name, options: options.map((o) => ({ name: o.name, dist: o.dist, ...o.folds })) }
}

function toCanvas(pixels, w, h) {
  const c = makeCanvas(w, h)
  for (let i = 0; i < w * h; i++) for (let q = 0; q < 3; q++) c.data[i * 3 + q] = pixels[i * 4 + q]
  return c
}

// ------------------------------------------------------------------ references

if (only !== 'packs') {
  const ids = REF_IDS.filter((id) => recipeFilter.includes(presetOf(id).scene.recipe))
  if (render) execFileSync('node', ['scripts/light/audit.mjs', '--ref', ids.join(','), '--out', AUDIT_DIR], { cwd: ROOT, stdio: 'inherit' })
  const rowsByRecipe = {}
  for (const id of ids) {
    const recipe = presetOf(id).scene.recipe
    const ref = await loadReference(id)
    const { w, h } = ref.img
    const file = path.join(AUDIT_DIR, id, 'render.png')
    if (!fs.existsSync(file)) {
      console.log(`${id}: no render (the recipe did not load)`)
      report.refs[id] = { recipe, error: 'no render' }
      continue
    }
    const out = await loadCanvas(file)
    const cfg = SUNSET[id]
    const R = rampCoordinate(ref.img, ref.mask, cfg)
    const resR = measureBoundaries(R.T, R.path, cfg)
    const sumR = summarize(resR, w)
    const Q = rampCoordinate(canvasToLinear(out), ref.mask, cfg, R.path)
    const resQ = measureBoundaries(Q.T, R.path, cfg)
    const sumQ = summarize(resQ, w)
    const checks = checkOneToOne(sumR, sumQ)
    const strip = (s) => ({ ...s, boundaries: s.boundaries.map(({ name, meanH, rangeH, wiggleRmsH, dominant, corrLenW, width }) => ({ name, meanH, rangeH, wiggleRmsH, dominant, corrLenW, width })) })
    report.refs[id] = { recipe, checks, target: strip(sumR), render: strip(sumQ) }
    console.log(`${id} (${recipe}): ${Object.entries(checks).filter(([, v]) => v.pass !== undefined).map(([k, v]) => `${k} ${v.pass ? 'pass' : 'FAIL'}`).join(', ')}`)
    for (const [k, v] of Object.entries(checks)) if (v.note) console.log(`    ${k}: ${v.note}`)
    const th = 300
    const tw = Math.round((w / h) * th)
    const tiles = [await resizeCanvas(overlay(canvasFromLinear(ref.img), R.T, EQUAL_LEVELS, resR.main), tw, th), await resizeCanvas(overlay(out, Q.T, EQUAL_LEVELS, resQ.main), tw, th)]
    const pair = await row(tiles, { labels: [`${id.replace('sunset-', '')}: target isolines`, 'render isolines (target path)'], labelSize: 13, gap: 6 })
    await saveCanvas(pair, path.join(DIR, `ref-${id}-iso.jpg`))
    ;(rowsByRecipe[recipe] ??= []).push(pair)
  }
  for (const [recipe, rows] of Object.entries(rowsByRecipe)) {
    const pairs = []
    for (let i = 0; i < rows.length; i += 2) pairs.push(await row(rows.slice(i, i + 2), { gap: 10 }))
    await saveCanvas(await column(pairs, { gap: 8 }), path.join(DIR, `iso-refs-${recipe}.jpg`), { quality: 84 })
  }
}

// ------------------------------------------------------------------ packs

if (only !== 'refs') {
  const harness = await startHarness()
  const { composeScene } = await harness.ssr('/src/light/compose.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  const modules = {
    'sunset.ramp': ['/src/light/recipes/sunset/ramp.ts', 'sunsetRamp'],
    'sunset.bands': ['/src/light/recipes/sunset/bands.ts', 'sunsetBands'],
    'sunset.blooms': ['/src/light/recipes/sunset/blooms.ts', 'sunsetBlooms'],
  }
  const ASPECTS = { '16x9': [1280, 720], '9x16': [720, 1280] }
  for (const recipeId of recipeFilter) {
    const [file, name] = modules[recipeId]
    const recipe = (await harness.ssr(file))[name]
    const packRows = []
    for (const packId of ['bold', 'elemental', 'atmospheric']) {
      const tiles = []
      const labels = []
      for (const asp of ['16x9', '9x16']) {
        for (const seed of [1, 2, 3]) {
          const [w, h] = ASPECTS[asp]
          const key = `${recipeId}-${packId}-${asp}-s${seed}`
          const png = path.join(DIR, `${key}.png`)
          let c
          if (render || !fs.existsSync(png)) {
            const scene = composeScene(recipe, { pack: getPack(packId), controls: { intensity: 0.5, softness: 0.5, mood: 0.5 }, seed, aspect: w / h })
            const img = await harness.render({ scene, width: w, height: h, supersample: 2, dither: true })
            c = toCanvas(img.data, w, h)
            await saveCanvas(c, png)
          } else c = await loadCanvas(png)
          // The path passes the same blues twice in these frames (a dim blue ground, a
          // light band between blues). Three projections resolve that differently;
          // use the one that fits the colors best and has the fewest multi-crossings.
          const blurred = blurImage(canvasToLinear(c), 4)
          const pth = buildPath(blurred, { angle: 90, band: 0.4 })
          const cfg = { angle: 90, band: 0.4, stops: autoStops(pth) }
          const R = chooseProjection(blurred, pth)
          const res = measureBoundaries(R.T, R.path, cfg)
          const s = { ...withSpectra(res, summarize(res, w)), folds: foldKinds(R.T) }
          const checks = checkGeneric(s, h)
          report.packs[key] = { recipe: recipeId, pack: packId, aspect: asp, seed, stops: cfg.stops.map(([p]) => +p.toFixed(3)), projection: R.method, projections: R.options, checks, summary: { ...s, boundaries: s.boundaries.map(({ name, meanH, rangeH, wiggleRmsH, spectrum, corrLenW, width }) => ({ name, meanH, rangeH, wiggleRmsH, spectrum, corrLenW, width })) } }
          const bs = s.boundaries
          const wv = checks?.wavelength.value
          console.log(`${key} [${R.method}]: ${checks ? Object.entries(checks).filter(([, v]) => v.pass !== undefined).map(([k, v]) => `${k} ${mark(v.pass)}`).join(' ') : 'no boundaries'} | wiggle ${bs.map((b) => f(b.wiggleRmsH)).join('/')} %H, lambda ${bs.map((b) => f(b.spectrum.lambdaW)).join('/')} W, bump aspect ${wv?.aspects.map((a) => f(a, 0)).join('/')}, top share ${wv?.shares.map((a) => f(a)).join('/')}, width ${bs.map((b) => f(b.width?.meanH, 1)).join('/')} %H, min/max ${bs.map((b) => f(b.width?.minOverMax)).join('/')}, corr ${f(s.adjacentCorrWiggle)}, cv ${f(s.adjacentSpacingCv)}, hooks ${f(s.folds.hooks * 100)}% outlines ${f(s.folds.outlines * 100)}%, slope p01 ${f(s.slope?.p01)}`)
          const th = 300
          tiles.push(await resizeCanvas(overlay(c, R.T, EQUAL_LEVELS, res.main), Math.round((w / h) * th), th))
          labels.push(`${packId} ${asp.replace('x', ':')} s${seed}`)
        }
      }
      packRows.push(await row(tiles, { labels, labelSize: 13, gap: 6 }))
    }
    await saveCanvas(await column(packRows, { gap: 8 }), path.join(DIR, `iso-packs-${recipeId}.jpg`), { quality: 84 })
  }
  await harness.close()
}

fs.writeFileSync(reportFile, JSON.stringify(report, null, 1))
