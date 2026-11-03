// Column spectrum: 1D power spectrum down each column (Hann window), averaged over columns,
// in cycles per short side. A disc blur of radius R puts zeros at f = 0.61/R, 1.12/R (cycles per pixel).
import sharp from 'sharp'
import { TARGETS, analysisSize } from './lib/targets.mjs'
import { loadLinear, toOklab } from './lib/image.mjs'
import { fft1, nextPow2 } from './lib/fft.mjs'
const files = process.argv.slice(2)
const list = files.length ? files.map((f) => [f, { file: f }]) : Object.entries(TARGETS)
for (const [k, t] of list) {
  const meta = await sharp(t.file).metadata()
  const src = t.crop ?? { left: 0, top: 0, width: meta.width, height: meta.height }
  const img = await loadLinear(t.file, { crop: t.crop, ...analysisSize(src.width, src.height) })
  const lab = toOklab(img)
  const { w, h } = lab
  const N = nextPow2(h) * 2
  const acc = new Float64Array(N / 2)
  for (let x = 0; x < w; x += 2) {
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    let m = 0
    for (let y = 0; y < h; y++) m += lab.L[y * w + x]
    m /= h
    for (let y = 0; y < h; y++) re[y] = (lab.L[y * w + x] - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / h))
    fft1(re, im)
    for (let f = 0; f < N / 2; f++) acc[f] += re[f] * re[f] + im[f] * im[f]
  }
  const short = Math.min(w, h)
  // print f (cycles per short side) and power * f^2 (flat for ideal steps), log scale bars
  const rows = []
  for (let i = 1; i < N / 2; i++) {
    const f = (i / N) * short
    if (f < 1.5 || f > 40) continue
    rows.push([f, acc[i] * f * f])
  }
  const mx = Math.max(...rows.map((r) => r[1]))
  console.log('\n' + k, w + 'x' + h)
  // merge into ~0.5 cycle bins
  const bins = new Map()
  for (const [f, p] of rows) {
    const b = Math.round(f * 2) / 2
    bins.set(b, (bins.get(b) ?? []).concat(p))
  }
  for (const [b, ps] of bins) {
    const p = ps.reduce((s, v) => s + v, 0) / ps.length
    const db = 10 * Math.log10(p / mx)
    console.log(String(b.toFixed(1)).padStart(5), db.toFixed(1).padStart(6), '#'.repeat(Math.max(0, Math.round(60 + db))))
  }
}
