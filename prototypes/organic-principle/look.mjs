// Scale-space views: each image at the analysis size (short side 720 px), blurred at
// sigma 2, 4, 8, 16, 32 and 64 px, and the band-pass layers between them, in Oklab
// lightness (grey = no change) and in Oklab a/b (hue shift shown around a neutral grey).
// Also lightness contour maps. Writes to out/look/.
// node prototypes/organic-principle/look.mjs [name=file ...]
import fs from 'node:fs'
import path from 'node:path'
import { TARGETS, HERE, analysisSize } from './lib/targets.mjs'
import { loadLinear, toOklab, saveEncoded } from './lib/image.mjs'
import { gauss } from './lib/blur.mjs'
import { oklabToLinear, linearToSrgb } from './lib/color.mjs'
import { sheet } from './lib/sheet.mjs'
import sharp from 'sharp'

const OUT = path.join(HERE, 'out/look')
fs.mkdirSync(OUT, { recursive: true })
const SIGMAS = [2, 4, 8, 16, 32, 64]
const GAIN_L = 8
const GAIN_C = 12

const tool = (n) => ({ file: path.join(HERE, 'out/tool', `${n}.png`), label: n })
const inputs = {
  'poster-etsy': TARGETS['poster-etsy'],
  'poster-board': TARGETS['poster-board'],
  ridge: TARGETS.ridge,
  'bands-bold-s7-9x16': tool('bands-bold-s7-9x16'),
  'bands-elemental-s3-9x16': tool('bands-elemental-s3-9x16'),
  'bands-atmospheric-s12-9x16': tool('bands-atmospheric-s12-9x16'),
  'ramp-bold-s7-9x16': tool('ramp-bold-s7-9x16'),
  'ramp-atmospheric-s3-16x9': tool('ramp-atmospheric-s3-16x9'),
  'bands-elemental-s7-16x9': tool('bands-elemental-s7-16x9'),
  'blooms-bold-s3-16x9': tool('blooms-bold-s3-16x9'),
  'blooms-elemental-s7-16x9': tool('blooms-elemental-s7-16x9'),
}
for (const arg of process.argv.slice(2)) {
  const [name, file] = arg.split('=')
  inputs[name] = { file: path.resolve(file), label: name }
}

const enc = (v) => Math.min(1, Math.max(0, v))
function monoPlanes(band, gain) {
  const p = new Float32Array(band.length)
  for (let i = 0; i < band.length; i++) p[i] = enc(0.5 + gain * band[i])
  return [p, p, p]
}
function chromaPlanes(da, db, gain) {
  const n = da.length
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  for (let i = 0; i < n; i++) {
    const c = oklabToLinear(0.66, gain * da[i], gain * db[i])
    for (let k = 0; k < 3; k++) out[k][i] = enc(linearToSrgb(Math.min(1, Math.max(0, c[k]))))
  }
  return out
}
function contourPlanes(img, lab, step) {
  const { w, h } = lab
  const L = gauss(lab.L, w, h, 1.5)
  const out = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)]
  const planes = [img.r, img.g, img.b]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const k = Math.floor(L[i] / step)
      const kr = x + 1 < w ? Math.floor(L[i + 1] / step) : k
      const kd = y + 1 < h ? Math.floor(L[i + w] / step) : k
      const line = k !== kr || k !== kd
      for (let c = 0; c < 3; c++) {
        const faded = 0.35 + 0.65 * linearToSrgb(Math.min(1, planes[c][i]))
        out[c][i] = line ? 0.08 : faded
      }
    }
  }
  return out
}

for (const [name, t] of Object.entries(inputs)) {
  if (!fs.existsSync(t.file)) {
    console.log('missing', t.file)
    continue
  }
  const meta = await sharp(t.file).metadata()
  const src = t.crop ?? { left: 0, top: 0, width: meta.width, height: meta.height }
  const size = analysisSize(src.width, src.height)
  const img = await loadLinear(t.file, { crop: t.crop, ...size })
  const lab = toOklab(img)
  const { w, h } = lab
  const G = { L: [lab.L], A: [lab.A], B: [lab.B] }
  for (const s of SIGMAS) for (const k of ['L', 'A', 'B']) G[k].push(gauss(G[k][0], w, h, s))
  const tiles = [{ file: t.file, label: name }]
  const ctiles = [{ file: t.file, label: name }]
  const orig = path.join(OUT, `${name}-0.jpg`)
  await saveEncoded([img.r, img.g, img.b].map((p) => p.map((v) => linearToSrgb(Math.min(1, Math.max(0, v))))), w, h, orig)
  tiles[0] = { file: orig, label: name }
  ctiles[0] = { file: orig, label: name }
  for (let k = 0; k < SIGMAS.length; k++) {
    const lo = k === 0 ? 0 : SIGMAS[k - 1]
    const hi = SIGMAS[k]
    const dL = G.L[k].map((v, i) => v - G.L[k + 1][i])
    const dA = G.A[k].map((v, i) => v - G.A[k + 1][i])
    const dB = G.B[k].map((v, i) => v - G.B[k + 1][i])
    const fL = path.join(OUT, `${name}-L-${lo}-${hi}.jpg`)
    const fC = path.join(OUT, `${name}-C-${lo}-${hi}.jpg`)
    await saveEncoded(monoPlanes(dL, GAIN_L), w, h, fL)
    await saveEncoded(chromaPlanes(dA, dB, GAIN_C), w, h, fC)
    tiles.push({ file: fL, label: `L ${lo}-${hi} px` })
    ctiles.push({ file: fC, label: `a,b ${lo}-${hi} px` })
  }
  const low = path.join(OUT, `${name}-low64.jpg`)
  const lowLab = { w, h, L: G.L[SIGMAS.length], A: G.A[SIGMAS.length], B: G.B[SIGMAS.length] }
  const lowRgb = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)]
  for (let i = 0; i < w * h; i++) {
    const c = oklabToLinear(lowLab.L[i], lowLab.A[i], lowLab.B[i])
    for (let q = 0; q < 3; q++) lowRgb[q][i] = enc(linearToSrgb(Math.min(1, Math.max(0, c[q]))))
  }
  await saveEncoded(lowRgb, w, h, low)
  tiles.push({ file: low, label: 'blur 64 px' })
  const contour = path.join(OUT, `${name}-contour.jpg`)
  await saveEncoded(contourPlanes(img, lab, 0.02), w, h, contour)
  ctiles.push({ file: contour, label: 'L contours, 0.02' })
  await sheet([{ tiles }, { tiles: ctiles }], path.join(OUT, `strip-${name}.jpg`), { height: 260 })
  console.log(name, w, h)
}
