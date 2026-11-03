// What each part of the principle adds, on the same seeds:
//   scene      the organic scene with no lens
//   plain      straight, flat bands (same layout) through the same lens
//   gauss      the organic scene through a Gaussian with the same 10-90 edge width
//   principle  the organic scene through the disc lens
//   lowres     the principle with the scene and the lens at 1/8 size, then upsampled
//              (the GPU plan), plus its error against the full-size principle
// node prototypes/organic-principle/ablate.mjs
import fs from 'node:fs'
import path from 'node:path'
import { HERE } from './lib/targets.mjs'
import { composeScene, rasterize } from './lib/scene.mjs'
import { lensBlur, gaussBlurLike, tone } from './lib/lens.mjs'
import { saveLinear, toOklab } from './lib/image.mjs'
import { sheet } from './lib/sheet.mjs'

const OUT = path.join(HERE, 'out/ablate')
fs.mkdirSync(OUT, { recursive: true })
const cases = [
  ['stack', 'bold', 7, '9x16'],
  ['stack', 'elemental', 3, '9x16'],
  ['stack', 'atmospheric', 12, '16x9'],
  ['horizon', 'elemental', 7, '16x9'],
]
const size = 1024 // both sides divisible by 8 at 16:9 and 9:16
const scale = 8

// Catmull-Rom upsampling of one plane by an integer factor (pixel centers aligned).
function upsample(p, w, h, f) {
  const W = w * f
  const H = h * f
  const cr = (t) => {
    const a = Math.abs(t)
    return a < 1 ? 1.5 * a * a * a - 2.5 * a * a + 1 : a < 2 ? -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2 : 0
  }
  const tmp = new Float32Array(W * h)
  for (let y = 0; y < h; y++) {
    for (let X = 0; X < W; X++) {
      const sx = (X + 0.5) / f - 0.5
      const x0 = Math.floor(sx)
      let s = 0
      let ws = 0
      for (let k = -1; k <= 2; k++) {
        const xi = Math.min(w - 1, Math.max(0, x0 + k))
        const wk = cr(sx - (x0 + k))
        s += wk * p[y * w + xi]
        ws += wk
      }
      tmp[y * W + X] = s / ws
    }
  }
  const out = new Float32Array(W * H)
  for (let Y = 0; Y < H; Y++) {
    const sy = (Y + 0.5) / f - 0.5
    const y0 = Math.floor(sy)
    for (let X = 0; X < W; X++) {
      let s = 0
      let ws = 0
      for (let k = -1; k <= 2; k++) {
        const yi = Math.min(h - 1, Math.max(0, y0 + k))
        const wk = cr(sy - (y0 + k))
        s += wk * tmp[yi * W + X]
        ws += wk
      }
      out[Y * W + X] = s / ws
    }
  }
  return out
}

const rows = []
const errors = []
for (const [layout, pack, seed, format] of cases) {
  const [a, b] = format.split('x').map(Number)
  const aspect = a / b
  const W = aspect >= 1 ? size : Math.round(size * aspect)
  const H = aspect >= 1 ? Math.round(size / aspect) : size
  const S = Math.min(W, H)
  const sc = composeScene({ pack, seed, aspect, layout })
  const plainSc = composeScene({ pack, seed, aspect, layout, variant: 'plain' })
  const R = sc.R * S
  const scene = rasterize(sc, W, H, 2)
  const name = `${layout}-${pack}-s${seed}-${format}`
  const f = (k) => path.join(OUT, `${name}-${k}.png`)
  const t0 = Date.now()
  const principle = tone(lensBlur(scene, R, { rim: 0.35, stretch: 1.1 }))
  const tFull = Date.now() - t0
  await saveLinear(tone(scene), f('scene'))
  await saveLinear(tone(lensBlur(rasterize(plainSc, W, H, 2), R, { rim: 0.35, stretch: 1.1 })), f('plain'))
  await saveLinear(tone(gaussBlurLike(scene, R)), f('gauss'))
  await saveLinear(principle, f('principle'))
  // the GPU plan: scene and lens at 1/8 size (4 x 4 samples per small pixel), then upsampled
  const t1 = Date.now()
  const w8 = W / scale
  const h8 = H / scale
  const small = rasterize(sc, w8, h8, 4)
  const smallBlur = lensBlur(small, R / scale, { rim: 0.35, stretch: 1.1 })
  const up = { w: W, h: H, r: upsample(smallBlur.r, w8, h8, scale), g: upsample(smallBlur.g, w8, h8, scale), b: upsample(smallBlur.b, w8, h8, scale) }
  const lowres = tone(up)
  const tLow = Date.now() - t1
  await saveLinear(lowres, f('lowres'))
  const A = toOklab(principle)
  const B = toOklab(lowres)
  let sum = 0
  let max = 0
  const d = []
  for (let i = 0; i < W * H; i++) {
    const e = 100 * Math.hypot(A.L[i] - B.L[i], A.A[i] - B.A[i], A.B[i] - B.B[i])
    sum += e
    max = Math.max(max, e)
    if (i % 7 === 0) d.push(e)
  }
  d.sort((x, y) => x - y)
  const err = { name, R: +R.toFixed(1), mean: +(sum / (W * H)).toFixed(3), p99: +d[Math.floor(0.99 * d.length)].toFixed(3), max: +max.toFixed(3), msFull: tFull, msLow: tLow }
  errors.push(err)
  console.log(JSON.stringify(err))
  rows.push({
    tiles: [
      { file: f('scene'), label: `${name}: scene, no lens` },
      { file: f('plain'), label: 'flat bands + lens' },
      { file: f('gauss'), label: 'scene + Gaussian' },
      { file: f('principle'), label: 'scene + disc lens' },
      { file: f('lowres'), label: `lens at 1/${scale} size` },
    ],
  })
}
fs.writeFileSync(path.join(OUT, 'lowres-error.json'), JSON.stringify(errors, null, 1))
await sheet(rows.slice(0, 2), path.join(OUT, 'ablate-9x16.jpg'), { height: 420 })
await sheet(rows.slice(2), path.join(OUT, 'ablate-16x9.jpg'), { height: 220 })
