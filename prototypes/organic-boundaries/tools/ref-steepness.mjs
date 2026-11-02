// How steep the references' own boundaries get: per main boundary, the audit's
// bump aspect, the steepest single bump (2 run / rise), and pi over the 98th
// and 100th percentile of the slope (curve smoothed over 1% of the width).
// node tools/ref-steepness.mjs

import { loadReference } from '../lib/refs.mjs'
import { SUNSET } from '../lib/config.mjs'
import { rampCoordinate, measureBoundaries } from '../lib/audit.mjs'
import { localBumps } from '../lib/engine-scene.mjs'

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-')
for (const id of Object.keys(SUNSET)) {
  const ref = await loadReference(id)
  const { w, h } = ref.img
  const cfg = SUNSET[id]
  const R = rampCoordinate(ref.img, ref.mask, cfg)
  const res = measureBoundaries(R.T, R.path, cfg)
  const cells = res.main.filter((m) => m.geom).map((m) => {
    const y = m.y50
    const ok = []
    for (let x = 0; x < w; x++) if (Number.isFinite(y[x])) ok.push(y[x])
    const slopes = []
    for (let i = 1; i < ok.length; i++) slopes.push(Math.abs(ok[i] - ok[i - 1]))
    slopes.sort((a, b) => a - b)
    const p98 = slopes[Math.floor(slopes.length * 0.98)]
    const big = m.geom.wiggleRmsH > 0.3
    const aspect = big && m.geom.dominant[0] ? (m.geom.dominant[0].lambdaW * w) / (2 * Math.SQRT2 * (m.geom.wiggleRmsH / 100) * h) : NaN
    const lb = localBumps(y, w, h)
    return `${m.name.split(' → ')[1]}: a${f(aspect)} fl${f(lb.flank)} st98 ${f(Math.PI / p98)} st ${f(lb.steepest)}`
  })
  console.log(`${id.replace('sunset-', '')}: ${cells.join(' | ')}`)
}
