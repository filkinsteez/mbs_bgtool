// How small can the lens pass be? Scene and lens at 1/k of the output size (4 x 4 samples
// per small pixel), upsampled with Catmull-Rom, against the full-size result.
// node prototypes/organic-principle/lowres.mjs
import { composeScene, rasterize } from './lib/scene.mjs'
import { lensBlur, tone } from './lib/lens.mjs'
import { toOklab } from './lib/image.mjs'

function upsample(p, w, h, f) {
  const W = w * f
  const H = h * f
  const cr = (t) => {
    const a = Math.abs(t)
    return a < 1 ? 1.5 * a * a * a - 2.5 * a * a + 1 : a < 2 ? -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2 : 0
  }
  const tmp = new Float32Array(W * h)
  for (let y = 0; y < h; y++)
    for (let X = 0; X < W; X++) {
      const sx = (X + 0.5) / f - 0.5
      const x0 = Math.floor(sx)
      let s = 0
      let ws = 0
      for (let k = -1; k <= 2; k++) {
        const wk = cr(sx - (x0 + k))
        s += wk * p[y * w + Math.min(w - 1, Math.max(0, x0 + k))]
        ws += wk
      }
      tmp[y * W + X] = s / ws
    }
  const out = new Float32Array(W * H)
  for (let Y = 0; Y < H; Y++) {
    const sy = (Y + 0.5) / f - 0.5
    const y0 = Math.floor(sy)
    for (let X = 0; X < W; X++) {
      let s = 0
      let ws = 0
      for (let k = -1; k <= 2; k++) {
        const wk = cr(sy - (y0 + k))
        s += wk * tmp[Math.min(h - 1, Math.max(0, y0 + k)) * W + X]
        ws += wk
      }
      out[Y * W + X] = s / ws
    }
  }
  return out
}

const W = 1024
const H = 576
for (const [layout, pack, seed, softness] of [
  ['stack', 'elemental', 3, 0.5],
  ['horizon', 'bold', 7, 0.5],
  ['stack', 'atmospheric', 12, 0],
]) {
  const sc = composeScene({ pack, seed, aspect: W / H, layout, softness })
  const R = sc.R * H
  const full = tone(lensBlur(rasterize(sc, W, H, 2), R, { rim: 0.35, stretch: 1.1 }))
  const A = toOklab(full)
  for (const k of [8, 16, 32]) {
    const w = W / k
    const h = H / k
    const blurred = lensBlur(rasterize(sc, w, h, 4), R / k, { rim: 0.35, stretch: 1.1 })
    const low = tone({ w: W, h: H, r: upsample(blurred.r, w, h, k), g: upsample(blurred.g, w, h, k), b: upsample(blurred.b, w, h, k) })
    const B = toOklab(low)
    const d = []
    for (let i = 0; i < W * H; i += 3) d.push(100 * Math.hypot(A.L[i] - B.L[i], A.A[i] - B.A[i], A.B[i] - B.B[i]))
    d.sort((a, b) => a - b)
    console.log(`${layout} ${pack} s${seed} softness ${softness}: lens radius ${(R / k).toFixed(1)} px at 1/${k}, Oklab dE x100 mean ${(d.reduce((s, v) => s + v, 0) / d.length).toFixed(3)} p99 ${d[Math.floor(0.99 * d.length)].toFixed(3)} max ${d[d.length - 1].toFixed(3)}`)
  }
}
