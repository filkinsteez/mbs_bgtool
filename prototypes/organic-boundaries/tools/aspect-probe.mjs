// Bump aspect of every transition's 10%, 50% and 90% lines in the production
// layouts, from a boundary module's CPU field, measured as the audit does.
// node tools/aspect-probe.mjs [module.ts]   (default: the engine's boundary.ts)
// Per transition: wiggle of the 50% line, a = the audit's bump aspect,
// fl = the steepest single bump's aspect, st = pi / steepest slope (lowest over
// the three lines); * marks an edge whose far side is much darker.

import path from 'node:path'
import { ROOT } from '../lib/refs.mjs'
import { sceneInShortSide, boundaryParams, isolinePx, bumpNumbers } from '../lib/engine-scene.mjs'

const file = process.argv[2] ?? path.join(ROOT, 'src/light/recipes/sunset/boundary.ts')
const B = await import(file)
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-')
let worst = Infinity
for (const pack of ['bold', 'elemental', 'atmospheric']) {
  for (const [name, aspect, w, h] of [['16:9', 16 / 9, 960, 540], ['9:16', 9 / 16, 540, 960]]) {
    for (const seed of [1, 2, 3]) {
      const scene = sceneInShortSide(pack, seed, aspect)
      const cal = B.calibrateBoundary(boundaryParams(scene), aspect, seed)
      const cells = scene.transitions.map((t, j) => {
        const [p10, p50, p90] = [-0.5, 0, 0.5].map((q) => bumpNumbers(isolinePx(cal, scene, j, q, w, h), w, h))
        const a = p50 && p50.wiggleH > 0.3 ? p50.aspect : Infinity
        const edges = [p10, p90].filter((p) => p && p.wiggleH > 0.3)
        const aEdge = edges.length ? Math.min(...edges.map((p) => p.aspect)) : Infinity
        worst = Math.min(worst, a)
        return `${f(p50?.wiggleH, 2)}%H a${f(a)} fl${f(p50?.flank)} st${f(p50?.steepest)} (10/90 a${f(aEdge)})${t.contrast > 0.5 ? '*' : ''}`
      })
      console.log(`${pack} ${name} s${seed}: scale ${cal.report.scale?.map((v) => f(v, 2)).join('/') ?? '-'} | ${cells.join('  ')}`)
    }
  }
}
console.log(`lowest bump aspect: ${f(worst)}`)
