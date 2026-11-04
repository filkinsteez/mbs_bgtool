// Does the filter keep the colors? Blurs the frame and the filtered frame with the same Gaussian (three box passes in
// linear light) and reports the Oklab distance between them: mean, 95th percentile and worst, per frame.
//
//   node prototypes/pixel/measure.mjs [--strengths 0.5,1] [--sigma 30]
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from '../../scripts/light/lib/args.mjs'
import { loadLinear, oklabDistance } from './lib/image.mjs'
import { led3 } from './lib/pixel.mjs'
import { pixelSettings } from './sets.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const args = parseArgs(process.argv.slice(2))
const strengths = String(args.strengths ?? '0.5,1').split(',').map(Number)
const sigmas = String(args.sigma ?? '30,10.8').split(',').map(Number)

function boxPass(src, w, h, r, horizontal) {
  const out = new Float32Array(src.length)
  const n = horizontal ? w : h
  const lines = horizontal ? h : w
  for (let l = 0; l < lines; l++) {
    for (let c = 0; c < 3; c++) {
      const idx = (i) => ((horizontal ? l * w + i : i * w + l) * 3 + c)
      let s = 0
      for (let i = -r; i <= r; i++) s += src[idx(Math.min(n - 1, Math.max(0, i)))]
      for (let i = 0; i < n; i++) {
        out[idx(i)] = s / (2 * r + 1)
        s += src[idx(Math.min(n - 1, i + r + 1))] - src[idx(Math.max(0, i - r))]
      }
    }
  }
  return out
}

function blur(img, sigma) {
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2))
  let d = img.data
  for (let k = 0; k < 3; k++) d = boxPass(boxPass(d, img.w, img.h, r, true), img.w, img.h, r, false)
  return d
}

const dir = path.join(HERE, 'out', 'frames')
const frames = (await fs.readdir(dir)).filter((f) => f.endsWith('-1920x1080.png')).sort()
const rows = []
for (const file of frames) {
  const img = await loadLinear(path.join(dir, file))
  const base = sigmas.map((s) => blur(img, s))
  for (const s of strengths) {
    const out = led3(img, pixelSettings(s))
    sigmas.forEach((sigma, k) => {
      const r = oklabDistance(base[k], blur(out, sigma))
      rows.push({ frame: file.replace('-1920x1080.png', ''), strength: s, sigma, ...r })
    })
  }
}
const f = (v) => v.toFixed(4)
console.log('frame                      strength sigma  mean    p95     max     mean dL')
for (const r of rows) console.log(`${r.frame.padEnd(26)} ${String(r.strength).padEnd(8)} ${String(r.sigma).padEnd(6)} ${f(r.mean)}  ${f(r.p95)}  ${f(r.max)}  ${r.dL >= 0 ? ' ' : ''}${f(r.dL)}`)
for (const s of strengths) {
  for (const sigma of sigmas) {
    const sel = rows.filter((r) => r.strength === s && r.sigma === sigma)
    const avg = (k) => sel.reduce((t, r) => t + r[k], 0) / sel.length
    const worst = (k) => Math.max(...sel.map((r) => r[k]))
    console.log(`all frames, strength ${s}, sigma ${sigma}: mean ${f(avg('mean'))} (worst frame ${f(worst('mean'))}), p95 worst ${f(worst('p95'))}, mean dL ${f(avg('dL'))}`)
  }
}
