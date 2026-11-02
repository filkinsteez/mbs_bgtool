// Measures every shot in out/shots: brightest band, light center and horizon, as frame fractions.
//   node prototypes/horizon-placement/measure-shots.mjs     -> out/shot-measures.json
// - brightest band: the row with the highest mean luminance (rows smoothed over 2% of the height);
// - light center: the brightest point of the luminance blurred over 12% of the short side;
// - horizon: the row where the light drops most going down (mean of the 3% below over the 3% above),
//   counted as a horizon when the drop is under 0.65; also per eighth of the width, for tilt and waviness.
import { readdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { linearToOklab, srgbToLinear } from './lib/color.mjs'

const dir = new URL('./out/shots/', import.meta.url).pathname
const files = readdirSync(dir).filter((f) => f.endsWith('.png'))
const lut = new Float32Array(256).map((_, i) => srgbToLinear(i / 255))
const rows = []

for (const file of files) {
  const m = file.match(/^(\w+)-(\w+)-(\w+)-s(\d+)-h([\d.]+)\.png$/)
  if (!m) continue
  const [, look, pack, format, seed, h] = m
  // work at 240 px on the long side: averaging in linear light first
  const { data, info } = await sharp(dir + file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W0, height: H0 } = info
  const k = Math.max(1, Math.floor(Math.max(W0, H0) / 240))
  const W = Math.floor(W0 / k)
  const H = Math.floor(H0 / k)
  const Y = new Float32Array(W * H)
  const rgbRows = Array.from({ length: H }, () => [0, 0, 0])
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const i = ((y * k + dy) * W0 + (x * k + dx)) * 3
          const [r, g, b] = [lut[data[i]], lut[data[i + 1]], lut[data[i + 2]]]
          s += 0.2126 * r + 0.7152 * g + 0.0722 * b
          rgbRows[y][0] += r
          rgbRows[y][1] += g
          rgbRows[y][2] += b
        }
      }
      Y[y * W + x] = s / (k * k)
    }
    rgbRows[y] = rgbRows[y].map((v) => v / (W * k * k))
  }
  // sharpest color edge: Oklab distance between the rows 1.5% of the height above and below
  const lab = rgbRows.map(linearToOklab)
  const de = Math.max(1, Math.round(0.015 * H))
  let edgeY = 0
  let edgeE = 0
  for (let y = de; y < H - de; y++) {
    const [a, b] = [lab[y - de], lab[y + de]]
    const e = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    if (e > edgeE) {
      edgeE = e
      edgeY = y
    }
  }
  const rowMean = (x0, x1) => Array.from({ length: H }, (_, y) => {
    let s = 0
    for (let x = x0; x < x1; x++) s += Y[y * W + x]
    return s / (x1 - x0)
  })
  const smooth = (v, r) => v.map((_, i) => {
    let s = 0
    let n = 0
    for (let j = Math.max(0, i - r); j <= Math.min(v.length - 1, i + r); j++) {
      s += v[j]
      n++
    }
    return s / n
  })
  const prof = smooth(rowMean(0, W), Math.max(1, Math.round(0.01 * H)))
  let yb = 0
  for (let y = 1; y < H; y++) if (prof[y] > prof[yb]) yb = y
  // blurred light center
  const r = Math.max(2, Math.round(0.12 * Math.min(W, H)))
  const rowsBlur = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0
      let n = 0
      for (let j = Math.max(0, x - r); j <= Math.min(W - 1, x + r); j++) {
        s += Y[y * W + j]
        n++
      }
      rowsBlur[y * W + x] = s / n
    }
  }
  let best = [0, 0, -1]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0
      let n = 0
      for (let j = Math.max(0, y - r); j <= Math.min(H - 1, y + r); j++) {
        s += rowsBlur[j * W + x]
        n++
      }
      if (s / n > best[2]) best = [x, y, s / n]
    }
  }
  // horizon: strongest drop going down
  const drop = (v) => {
    const d = Math.max(2, Math.round(0.03 * H))
    let by = -1
    let br = 1
    for (let y = d; y < H - d; y++) {
      let up = 0
      let down = 0
      for (let j = 1; j <= d; j++) {
        up += v[y - j]
        down += v[y + j]
      }
      const ratio = down / Math.max(up, 1e-6)
      if (ratio < br) {
        br = ratio
        by = y
      }
    }
    return [by, br]
  }
  const [hy, hr] = drop(prof)
  const cols = []
  for (let c = 0; c < 8; c++) {
    const v = smooth(rowMean(Math.floor((c * W) / 8), Math.floor(((c + 1) * W) / 8)), Math.max(1, Math.round(0.01 * H)))
    const [cy, cr] = drop(v)
    cols.push(cr < 0.65 ? (cy + 0.5) / H : null)
  }
  rows.push({
    look,
    pack,
    format,
    seed: Number(seed),
    h: Number(h),
    bright: (yb + 0.5) / H,
    brightY: prof[yb],
    topY: prof[0],
    bottomY: prof[H - 1],
    lightX: (best[0] + 0.5) / W,
    lightY: (best[1] + 0.5) / H,
    horizon: hr < 0.65 ? (hy + 0.5) / H : null,
    horizonDrop: hr,
    horizonCols: cols,
    edge: (edgeY + 0.5) / H,
    edgeE,
  })
}
writeFileSync(new URL('./out/shot-measures.json', import.meta.url).pathname, JSON.stringify(rows))
console.log(`${rows.length} shots measured`)
for (const look of ['ramp', 'bands', 'blooms']) {
  for (const h of [0, 0.5, 1]) {
    const r = rows.filter((x) => x.look === look && x.h === h)
    if (!r.length) continue
    const med = (v) => {
      const s = v.filter((x) => x !== null).sort((a, b) => a - b)
      return s.length ? s[Math.floor(s.length / 2)].toFixed(2) : ' - '
    }
    console.log(
      `${look.padEnd(6)} H${h}  n ${r.length}  bright median ${med(r.map((x) => x.bright))}  light y median ${med(r.map((x) => x.lightY))}  horizon found ${r.filter((x) => x.horizon !== null).length}, median ${med(r.map((x) => x.horizon))}`,
    )
  }
}
