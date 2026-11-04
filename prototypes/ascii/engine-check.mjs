// Renders tool frames through the engine's output chain (src/light at HEAD, with the renderer patch applied while it
// is with the coordinator) and checks the ASCII stage:
//   - color: Oklab distance between ASCII on and off after a gaussian blur of one cell height in linear light;
//   - preview vs export: a 960x540 1x render against the 3840x2160 2x export shrunk to 960x540, cell by cell;
//   - sheets: full frames and 1:1 crops at 1080p and 4K.
//   node prototypes/ascii/engine-check.mjs [--strength 1] [--only ramp-bold-s1,...] [--skip4k]
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { OUT, startPrototype } from './lib/server.mjs'

const SCENES = [
  { name: 'ramp-bold-s1', recipe: 'sunset.ramp', pack: 'bold', seed: 1 },
  { name: 'ramp-elemental-s2', recipe: 'sunset.ramp', pack: 'elemental', seed: 2 },
  { name: 'ramp-atmospheric-s3', recipe: 'sunset.ramp', pack: 'atmospheric', seed: 3 },
  { name: 'bands-bold-s2', recipe: 'sunset.bands', pack: 'bold', seed: 2 },
  { name: 'bands-elemental-s3', recipe: 'sunset.bands', pack: 'elemental', seed: 3 },
  { name: 'ramp-bold-s4-9x16', recipe: 'sunset.ramp', pack: 'bold', seed: 4, portrait: true },
  { name: 'rim-elemental-s3-9x16', recipe: 'contour.rim', pack: 'elemental', seed: 3, portrait: true },
  { name: 'blooms-atmospheric-s2', recipe: 'sunset.blooms', pack: 'atmospheric', seed: 2 },
  { name: 'rim-bold-s1', recipe: 'contour.rim', pack: 'bold', seed: 1 },
  { name: 'halo-elemental-s2', recipe: 'contour.halo', pack: 'elemental', seed: 2 },
  { name: 'beam-atmospheric-s1', recipe: 'contour.beam', pack: 'atmospheric', seed: 1 },
  { name: 'streaks-bold-s3', recipe: 'contour.streaks', pack: 'bold', seed: 3 },
]

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? (argv[i + 1] ?? true) : fallback
}
const strength = Number(arg('strength', 1))
const only = arg('only', null) ? new Set(String(arg('only')).split(',')) : null
const skip4k = argv.includes('--skip4k')
const dir = path.join(OUT, 'engine', `s${Math.round(strength * 100)}`)
fs.mkdirSync(dir, { recursive: true })

const toLinear = (v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const LUT = Float32Array.from({ length: 256 }, (_, i) => toLinear(i))

/** Linear RGB float image, area-averaged down by `factor`. */
function linearDown(rgba, width, height, factor) {
  const w = Math.floor(width / factor)
  const h = Math.floor(height / factor)
  const out = new Float32Array(w * h * 3)
  for (let y = 0; y < h * factor; y++) {
    for (let x = 0; x < w * factor; x++) {
      const i = (y * width + x) * 4
      const o = (Math.floor(y / factor) * w + Math.floor(x / factor)) * 3
      out[o] += LUT[rgba[i]]
      out[o + 1] += LUT[rgba[i + 1]]
      out[o + 2] += LUT[rgba[i + 2]]
    }
  }
  const n = factor * factor
  for (let k = 0; k < out.length; k++) out[k] /= n
  return { w, h, data: out }
}

function blur({ w, h, data }, sigma) {
  const r = Math.ceil(3 * sigma)
  const kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const pass = (src, horizontal) => {
    const out = new Float32Array(src.length)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s0 = 0
        let s1 = 0
        let s2 = 0
        let ws = 0
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k))
          const wt = kernel[k + r]
          const i = (yy * w + xx) * 3
          s0 += wt * src[i]
          s1 += wt * src[i + 1]
          s2 += wt * src[i + 2]
          ws += wt
        }
        const o = (y * w + x) * 3
        out[o] = s0 / ws
        out[o + 1] = s1 / ws
        out[o + 2] = s2 / ws
      }
    }
    return out
  }
  return { w, h, data: pass(pass(data, true), false) }
}

function oklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function deltaE(a, b) {
  const d = new Float32Array(a.w * a.h)
  for (let p = 0; p < d.length; p++) {
    const x = oklab(a.data[3 * p], a.data[3 * p + 1], a.data[3 * p + 2])
    const y = oklab(b.data[3 * p], b.data[3 * p + 1], b.data[3 * p + 2])
    d[p] = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
  }
  const sorted = [...d].sort((p, q) => p - q)
  return { mean: d.reduce((s, v) => s + v, 0) / d.length, p95: sorted[Math.floor(0.95 * sorted.length)], max: sorted[sorted.length - 1] }
}

const proto = await startPrototype()
const results = []
try {
  for (const s of SCENES) {
    if (only && !only.has(s.name)) continue
    const render = async (width, height, supersample, ascii) => {
      const key = proto.nextKey('engine')
      const r = await proto.call('renderFrame', { ...s, width, height, supersample, output: { ascii }, key })
      return { width, height, data: proto.take(key), ms: r.ms }
    }
    // Landscape 16:9 or portrait 9:16; the grid is 100 x 26 or 56 x 46 cells.
    const [W, H] = s.portrait ? [1080, 1920] : [1920, 1080]
    const [cols, rows] = s.portrait ? [56, 46] : [100, 26]
    const off = await render(W, H, 2, 0)
    const on = await render(W, H, 2, strength)
    const save = (img, file) => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).removeAlpha().jpeg({ quality: 92 }).toFile(path.join(dir, file))
    await save(on, `${s.name}-1080.jpg`)
    await save(off, `${s.name}-1080-off.jpg`)
    // Color: blur both by one cell height (41.5 px at 1080) in linear light, on a 4x smaller copy.
    const a = blur(linearDown(off.data, W, H, 4), 1080 / 26 / 4)
    const b = blur(linearDown(on.data, W, H, 4), 1080 / 26 / 4)
    const color = deltaE(a, b)
    const row = { name: s.name, msOff: +off.ms.toFixed(1), msOn: +on.ms.toFixed(1), color }
    if (!skip4k) {
      const preview = await render(W / 2, H / 2, 1, strength)
      const big = await render(W * 2, H * 2, 2, strength)
      // Preview vs export, per cell: mean linear difference of the export shrunk 4x against the preview.
      const pw = W / 2
      const ph = H / 2
      const p = linearDown(preview.data, pw, ph, 1)
      const e = linearDown(big.data, W * 2, H * 2, 4)
      const cw = pw / cols
      const ch = ph / rows
      const cells = []
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          let sum = 0
          let n = 0
          for (let y = Math.ceil(j * ch); y < Math.floor((j + 1) * ch); y++) {
            for (let x = Math.ceil(i * cw); x < Math.floor((i + 1) * cw); x++) {
              const k = (y * pw + x) * 3
              sum += Math.abs(p.data[k] - e.data[k]) + Math.abs(p.data[k + 1] - e.data[k + 1]) + Math.abs(p.data[k + 2] - e.data[k + 2])
              n++
            }
          }
          cells.push(sum / (3 * n))
        }
      }
      const sorted = [...cells].sort((x, y) => x - y)
      const median = sorted[Math.floor(sorted.length / 2)]
      row.previewVsExport = { cells: cells.length, medianCellDiff: +median.toFixed(5), worstCellDiff: +sorted[sorted.length - 1].toFixed(4), cellsAbove002: cells.filter((v) => v > 0.02).length, ms4k: +big.ms.toFixed(0) }
      // 1:1 crops: 1080 at 2x (nearest) next to 4K, same frame region.
      const [cx, cy] = s.portrait ? [380, 900] : [640, 320]
      const c1080 = await sharp(on.data, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().extract({ left: cx, top: cy, width: 320, height: 200 }).resize({ width: 640, kernel: 'nearest' }).png().toBuffer()
      const c4k = await sharp(big.data, { raw: { width: W * 2, height: H * 2, channels: 4 } }).removeAlpha().extract({ left: cx * 2, top: cy * 2, width: 640, height: 400 }).png().toBuffer()
      await sharp({ create: { width: 1288, height: 400, channels: 3, background: '#000' } })
        .composite([
          { input: c1080, left: 0, top: 0 },
          { input: c4k, left: 648, top: 0 },
        ])
        .jpeg({ quality: 92 })
        .toFile(path.join(dir, `${s.name}-1080x2-vs-4k.jpg`))
    }
    results.push(row)
    console.log(JSON.stringify(row))
  }
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2))
} finally {
  await proto.close()
}
