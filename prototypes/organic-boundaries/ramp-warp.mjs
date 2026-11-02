// How sunset.ramp moves its edges, measured on renders.
// node ramp-warp.mjs  ->  artifacts/organic-boundaries/ramp-warp/
//
// The composed pack scene (every control at 0.5) is rendered four times with the
// glow, sun glow and sunlight off, so only the stop edges are left: warp and drift
// off, warp only, drift only, both. Each equal-t isoline (t from the "both off"
// render's color path) is followed across the frame in every render; the
// difference to "both off" is how far the warp or the drift moved it. Printed
// per isoline: its height, the spread (std across the width) of each move, and
// the correlation of the warp moves and of the drift moves between isolines.

import fs from 'node:fs'
import path from 'node:path'
import { startHarness } from '../../scripts/light/lib/harness.mjs'
import { ROOT } from './lib/refs.mjs'
import { canvasToLinear } from './lib/output.mjs'
import { blurImage } from './lib/blur.mjs'
import { buildPath, projectToPath } from './lib/rampcoord.mjs'
import { columnCrossings } from './lib/isolines.mjs'
import { makeCanvas, saveCanvas, row, column, resizeCanvas } from './lib/image.mjs'
import { overlay } from './lib/draw.mjs'
import { EQUAL_LEVELS } from './lib/audit.mjs'

const DIR = path.join(ROOT, 'artifacts/organic-boundaries/ramp-warp')
fs.mkdirSync(DIR, { recursive: true })
const W = 1280
const H = 720
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-')

const harness = await startHarness()
const { composeScene } = await harness.ssr('/src/light/compose.ts')
const { getPack } = await harness.ssr('/src/light/color/packs.ts')
const { sunsetRamp } = await harness.ssr('/src/light/recipes/sunset/ramp.ts')
const { edgeFbm, spread } = await harness.ssr('/src/light/recipes/sunset/ramp-noise.ts')

const stats = (v) => {
  const ok = v.filter(Number.isFinite)
  const m = ok.reduce((s, x) => s + x, 0) / ok.length
  return { mean: m, sd: Math.sqrt(ok.reduce((s, x) => s + (x - m) ** 2, 0) / ok.length), n: ok.length }
}
const corr = (a, b) => {
  const idx = a.map((_, i) => i).filter((i) => Number.isFinite(a[i]) && Number.isFinite(b[i]))
  const ma = idx.reduce((s, i) => s + a[i], 0) / idx.length
  const mb = idx.reduce((s, i) => s + b[i], 0) / idx.length
  let ab = 0
  let aa = 0
  let bb = 0
  for (const i of idx) {
    ab += (a[i] - ma) * (b[i] - mb)
    aa += (a[i] - ma) ** 2
    bb += (b[i] - mb) ** 2
  }
  return ab / Math.sqrt(aa * bb || 1e-12)
}

async function renderVariant(scene, override) {
  const s = { ...scene, params: { ...scene.params, glow: 0, sunGlow: 0, sunlight: 0, ...override }, output: { ...scene.output, grain: 0 } }
  const img = await harness.render({ scene: s, width: W, height: H, supersample: 2, dither: false })
  const c = makeCanvas(W, H)
  for (let i = 0; i < W * H; i++) for (let q = 0; q < 3; q++) c.data[i * 3 + q] = img.data[i * 4 + q]
  return c
}

const summary = []
const sheets = []
for (const packId of ['bold', 'elemental', 'atmospheric']) {
  for (const seed of [1, 2, 3]) {
    const scene = composeScene(sunsetRamp, { pack: getPack(packId), controls: { intensity: 0.5, softness: 0.5, mood: 0.5 }, seed, aspect: W / H })
    const p = scene.params
    const wave = p.horizonEdge === 2
    const renders = {
      none: await renderVariant(scene, { warp: 0, drift: 0 }),
      warp: await renderVariant(scene, { drift: 0 }),
      drift: await renderVariant(scene, { warp: 0 }),
      both: await renderVariant(scene, {}),
    }
    const blurred = Object.fromEntries(Object.entries(renders).map(([k, c]) => [k, blurImage(canvasToLinear(c), 3)]))
    const pth = buildPath(blurred.none, { angle: 90, band: 0.4 })
    const T = Object.fromEntries(Object.entries(blurred).map(([k, b]) => [k, projectToPath(b, pth, { window: 0.15 })]))
    // the predicted spread of each edge's warp: warp x (spread of the noise across the frame) x uEdgeWarp
    const edges = Math.max(0, Math.min(4, Math.round(p.stops) - 1))
    const at = [p.at1, p.at2, p.at3, p.at4].slice(0, edges)
    const horizonAt = wave ? p.at2 : 0
    const turn = (p.angle * Math.PI) / 180
    const noise = (x) => edgeFbm(x * Math.cos(turn) * p.warpScale + 3.7 + p.warpPhase, seed, p.warpOctaves)
    const noiseSpread = spread(noise, -W / H / 2, W / H / 2)
    const predicted = at.map((m) => p.warp * noiseSpread * Math.exp(-Math.abs(m - horizonAt) / p.warpReach))
    const levels = []
    for (const level of EQUAL_LEVELS) {
      const y = Object.fromEntries(Object.entries(T).map(([k, t]) => [k, columnCrossings(t, level).y]))
      const valid = Object.values(y).every((v) => v.filter(Number.isFinite).length > 0.8 * W)
      if (!valid) continue
      const pct = (v) => Array.from(v, (q) => (q / H) * 100)
      const dW = pct(y.warp.map((v, i) => v - y.none[i]))
      const dD = pct(y.drift.map((v, i) => v - y.none[i]))
      levels.push({ level, height: stats(pct(y.none)).mean, warpSd: stats(dW).sd, driftSd: stats(dD).sd, dW, dD })
    }
    // correlations between the highest and the lowest isoline that move (spread above 0.05 %H)
    const movingW = levels.filter((l) => l.warpSd > 0.05)
    const movingD = levels.filter((l) => l.driftSd > 0.05)
    const corrW = movingW.length > 1 ? corr(movingW[0].dW, movingW[movingW.length - 1].dW) : NaN
    const corrD = movingD.length > 1 ? corr(movingD[0].dD, movingD[movingD.length - 1].dD) : NaN
    let minW = Infinity
    for (let a = 0; a < movingW.length; a++) for (let b = a + 1; b < movingW.length; b++) minW = Math.min(minW, corr(movingW[a].dW, movingW[b].dW))
    const key = `${packId}-s${seed}`
    console.log(`${key}: ${wave ? 'wave (wavy horizon in frame)' : 'horizon below the frame'}, warp ${f(p.warp, 4)} (wander ${f(p.warp * noiseSpread * 100)} %S at the horizon edge), warpReach ${p.warpReach}, drift ${p.drift} x width, driftScale ${p.driftScale}`)
    console.log(`  edges at ${at.map((m) => f(m, 3)).join(' / ')} S from the horizon; widths ${[p.width1, p.width2, p.width3].slice(0, edges).map((v) => f(v, 3)).join(' / ')}; predicted warp spread ${predicted.map((v) => f(v * 100)).join(' / ')} %S`)
    for (const l of levels) console.log(`  t=${f(l.level)} at ${f(l.height, 1)} %H: warp moves it ${f(l.warpSd)} %H, drift ${f(l.driftSd)} %H`)
    console.log(`  warp: correlation highest vs lowest moving isoline ${f(corrW)}, lowest pair ${f(minW)}; drift: highest vs lowest ${f(corrD)}`)
    summary.push({ key, wave, warp: p.warp, wanderAtHorizon: p.warp * noiseSpread, warpReach: p.warpReach, drift: p.drift, driftScale: p.driftScale, at, widths: [p.width1, p.width2, p.width3].slice(0, edges), predicted, levels: levels.map(({ level, height, warpSd, driftSd }) => ({ level, height, warpSd, driftSd })), corrW, minW, corrD })
    if (seed === 1) {
      const tiles = []
      for (const k of ['none', 'warp', 'drift', 'both']) tiles.push(await resizeCanvas(overlay(renders[k], T[k], EQUAL_LEVELS, []), 480, 270))
      sheets.push(await row(tiles, { labels: [`${packId} s1: warp and drift off`, 'warp only', 'drift only', 'both (as composed)'], labelSize: 13, gap: 6 }))
    }
  }
}
await saveCanvas(await column(sheets, { gap: 8 }), path.join(DIR, 'variants.jpg'), { quality: 84 })
fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(summary, null, 1))
await harness.close()
