// Where a frame's equal-t isolines are crossed more than once per column.
// node tools/fold-map.mjs <frame.png> [out.png] [tracked | full | <window>]
// Red: crossings after the first, for any of the 14 equal levels. A warp fold
// shows as short red hooks on a boundary; a glow shows as the far side of its arcs.

import path from 'node:path'
import { loadCanvas, saveCanvas, makeCanvas, row } from '../lib/image.mjs'
import { canvasToLinear } from '../lib/output.mjs'
import { rampCoordinate, EQUAL_LEVELS } from '../lib/audit.mjs'
import { blurImage } from '../lib/blur.mjs'
import { buildPath } from '../lib/rampcoord.mjs'
import { projectTracked } from '../lib/tracked.mjs'

const file = process.argv[2]
const out = process.argv[3] ?? file.replace(/\.png$/, '-folds.png')
const mode = process.argv[4] ?? 'tracked'
const c = await loadCanvas(file)
const { w, h } = c
let R
if (mode === 'tracked') {
  const blurred = blurImage(canvasToLinear(c), 4)
  const pth = buildPath(blurred, { angle: 90, band: 0.4 })
  R = { T: projectTracked(blurred, pth) }
} else R = rampCoordinate(canvasToLinear(c), null, { angle: 90, band: 0.4, window: mode === 'full' ? null : Number(mode) }, null, 4)
const map = makeCanvas(w, h)
map.data.set(c.data)
for (let i = 0; i < w * h; i++) for (let q = 0; q < 3; q++) map.data[i * 3 + q] = Math.round(map.data[i * 3 + q] * 0.45)
let extra = 0
for (const level of EQUAL_LEVELS) {
  for (let x = 0; x < w; x++) {
    let state = 0
    let crossings = 0
    for (let y = 0; y < h; y++) {
      const v = R.T.t[y * w + x]
      const st = v < level - 0.01 ? -1 : v > level + 0.01 ? 1 : 0
      if (st !== 0 && st !== state) {
        if (state !== 0) {
          crossings++
          if (crossings > 1) {
            extra++
            for (let dy = -1; dy <= 1; dy++) {
              const yy = Math.min(h - 1, Math.max(0, y + dy))
              const i = (yy * w + x) * 3
              map.data[i] = 255
              map.data[i + 1] = 40
              map.data[i + 2] = 40
            }
          }
        }
        state = st
      }
    }
  }
}
console.log(`${path.basename(file)}: ${extra} extra crossings (${((extra / (w * EQUAL_LEVELS.length)) * 100).toFixed(2)}% of column-levels)`)
await saveCanvas(await row([c, map], { gap: 6 }), out)
