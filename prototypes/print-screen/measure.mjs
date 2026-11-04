// Measures the print screen of the film poster reference at 1:1: peaks of the 2D spectrum per band and per
// channel, the screen's strength from light to dark ink, and whether the channels share one screen.
// Usage: node prototypes/print-screen/measure.mjs [--file png] [--n 128]
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { findPeaks, hannGain, planes, windowSpectrum } from './lib/spectrum.mjs'

const root = new URL('../../', import.meta.url).pathname
const out = new URL('./out/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const file = arg('file', `${root}public/references/awe/sunset/sunset-film-poster-bands-full.png`)
const n = Number(arg('n', 128))

const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width
const h = info.height
const P = planes({ width: w, height: h, data, channels: 3 })

// Bands of the poster by height (the text starts below y = 1080 at 960 px wide).
const scale = h / 1345
const BANDS = [
  ['top red', 0, 70],
  ['near black', 120, 260],
  ['plum', 280, 380],
  ['blue', 420, 610],
  ['grey', 640, 810],
  ['warm grey', 830, 950],
  ['red', 975, 1075],
].map(([name, y0, y1]) => [name, Math.round(y0 * scale), Math.round(y1 * scale)])

function windowsIn(y0, y1) {
  const list = []
  for (let y = y0; y + n <= Math.max(y1, y0 + n); y += n / 2) for (let x = 16; x + n <= w - 16; x += n / 2) list.push([x, y])
  return list
}

const gain = hannGain(n)
const amplitude = (power) => (2 * Math.sqrt(power)) / (n * n * gain * gain)
const report = { file: file.replace(root, ''), size: `${w}x${h}`, n, bands: [] }
const lines = []

for (const [name, y0, y1] of BANDS) {
  const wins = windowsIn(y0, y1)
  const sum = { R: new Float64Array(n * n), G: new Float64Array(n * n), B: new Float64Array(n * n), Y: new Float64Array(n * n) }
  const spectra = []
  let meanY = 0
  let meanL = 0
  const meanRGB = [0, 0, 0]
  for (const [x0, yy] of wins) {
    const per = {}
    for (const key of ['R', 'G', 'B', 'Y']) {
      const s = windowSpectrum(P[key], w, x0, yy, n)
      per[key] = s
      for (let i = 0; i < n * n; i++) sum[key][i] += s.re[i] ** 2 + s.im[i] ** 2
    }
    spectra.push(per)
    meanY += per.Y.mean / wins.length
    meanRGB[0] += per.R.mean / wins.length
    meanRGB[1] += per.G.mean / wins.length
    meanRGB[2] += per.B.mean / wins.length
    let l = 0
    for (let y = 0; y < n; y += 4) for (let x = 0; x < n; x += 4) l += P.L[(yy + y) * w + x0 + x]
    meanL += l / ((n / 4) * (n / 4)) / wins.length
  }
  const peaks = findPeaks(sum.Y, n, { ratio: 6 })
  const band = { name, y0, y1, windows: wins.length, meanL, meanRGB: meanRGB.map((v) => Math.round(v)), peaks: [] }
  lines.push(`== ${name} (rows ${y0}-${y1}, ${wins.length} windows of ${n} px): mean RGB ${band.meanRGB.join(',')}, Oklab L ${meanL.toFixed(2)}`)
  for (const p of peaks.slice(0, 6)) {
    // Power summed over the 3 x 3 bins around the peak, per channel, as a sinusoid amplitude per window (code values).
    const around = (arr) => {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += arr[((p.iy + dy + n) % n) * n + ((p.ix + dx + n) % n)]
      return s / wins.length
    }
    const amp = Object.fromEntries(['R', 'G', 'B', 'Y'].map((k) => [k, amplitude(around(sum[k]))]))
    // Coherence of two channels at the peak bin across windows: 1 = one screen in both, 0 = unrelated screens.
    const coherence = (a, b) => {
      let cr = 0
      let ci = 0
      let pa = 0
      let pb = 0
      for (const s of spectra) {
        const i = p.iy * n + p.ix
        const ar = s[a].re[i]
        const ai = s[a].im[i]
        const br = s[b].re[i]
        const bi = s[b].im[i]
        cr += ar * br + ai * bi
        ci += ai * br - ar * bi
        pa += ar * ar + ai * ai
        pb += br * br + bi * bi
      }
      return (cr * cr + ci * ci) / (pa * pb)
    }
    const entry = {
      periodPx: p.periodPx,
      cellsPer1000: 1000 / p.periodPx,
      angleDeg: p.angleDeg,
      ratio: p.ratio,
      amplitude: amp,
      coherenceRG: coherence('R', 'G'),
      coherenceGB: coherence('G', 'B'),
      coherenceRB: coherence('R', 'B'),
    }
    band.peaks.push(entry)
    lines.push(
      `  peak: period ${p.periodPx.toFixed(2)} px (${(1000 / p.periodPx).toFixed(0)} per 1000 px), wave angle ${p.angleDeg.toFixed(1)} deg, ${p.ratio.toFixed(0)}x the median at its radius; amplitude R ${amp.R.toFixed(2)} G ${amp.G.toFixed(2)} B ${amp.B.toFixed(2)} luma ${amp.Y.toFixed(2)} code values; coherence RG ${entry.coherenceRG.toFixed(2)} GB ${entry.coherenceGB.toFixed(2)} RB ${entry.coherenceRB.toFixed(2)}`,
    )
  }
  report.bands.push(band)
  // Log power spectrum of the band (luma), DC in the middle, for the sheet.
  const img = Buffer.alloc(n * n)
  let max = 0
  for (const v of sum.Y) max = Math.max(max, Math.log10(v + 1e-9))
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sx = (x + n / 2) % n
      const sy = (y + n / 2) % n
      img[sy * n + sx] = Math.max(0, Math.min(255, Math.round(255 * (1 - (max - Math.log10(sum.Y[y * n + x] + 1e-9)) / 6))))
    }
  }
  await sharp(img, { raw: { width: n, height: n, channels: 1 } }).resize(256, 256, { kernel: 'nearest' }).png().toFile(`${out}spectrum-${name.replace(' ', '-')}.png`)
}

console.log(lines.join('\n'))
writeFileSync(`${out}measure.json`, JSON.stringify(report, null, 1))
writeFileSync(`${out}measure.txt`, lines.join('\n') + '\n')
