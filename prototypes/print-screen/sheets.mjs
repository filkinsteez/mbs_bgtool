// Sheets: the poster's screen next to ours on the nearest colors of our own Bands Bold frame, and full frames of
// Ramp, Bands and Blooms with the screen. Only our renders go through the screen; the poster is only shown and
// measured. Usage: node prototypes/print-screen/sheets.mjs (after render.mjs)
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { measureGrain } from '../../scripts/light/lib/grain.mjs'
import { applyScreen } from './lib/screen.mjs'
import { findPeaks, planes, windowSpectrum } from './lib/spectrum.mjs'

const root = new URL('../../', import.meta.url).pathname
const dir = new URL('./', import.meta.url).pathname
const out = `${dir}out/`
mkdirSync(`${out}sheets`, { recursive: true })

async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}
function crop(image, x0, y0, w, h) {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) data.set(image.data.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + w) * 4), y * w * 4)
  return { width: w, height: h, data }
}
async function zoom(image, factor) {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).resize(image.width * factor, image.height * factor, { kernel: 'nearest' }).png().toBuffer()
}
async function png(image) {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer()
}

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})
function meanOklab(image, x0, y0, size) {
  let r = 0
  let g = 0
  let b = 0
  const n = size * size
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const i = (y * image.width + x) * 4
      r += SRGB_TO_LINEAR[image.data[i]] / n
      g += SRGB_TO_LINEAR[image.data[i + 1]] / n
      b += SRGB_TO_LINEAR[image.data[i + 2]] / n
    }
  }
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** Texture numbers of a crop: residual std (code values of luma, % of L) and the strongest spectral peak. */
function numbers(image, pictureShort) {
  const m = measureGrain(image, { hpSigma: 0.0065 * pictureShort, minBin: 200, structure: 0 })
  const P = planes(image)
  const n = 64
  const sum = new Float64Array(n * n)
  for (let y0 = 0; y0 + n <= image.height; y0 += n / 2) {
    for (let x0 = 0; x0 + n <= image.width; x0 += n / 2) {
      const s = windowSpectrum(P.Y, image.width, x0, y0, n)
      for (let i = 0; i < n * n; i++) sum[i] += s.re[i] ** 2 + s.im[i] ** 2
    }
  }
  const [peak] = findPeaks(sum, n, { ratio: 4 })
  return { cv: m.stdY, L: m.stdL, peak }
}
const caption = (title, nb) =>
  [title, `${nb.cv.toFixed(1)} code values, L ${(nb.L * 100).toFixed(2)} %` + (nb.peak ? `; peak ${nb.peak.periodPx.toFixed(1)} px at ${nb.peak.angleDeg.toFixed(0)} deg` : '; no peak')]

function textSvg(lines, width, size = 12) {
  const perLine = Math.floor(width / (size * 0.56))
  const wrapped = lines.flatMap((line) => {
    const words = String(line).split(' ')
    const rows = []
    let cur = ''
    for (const w of words) {
      if (cur && cur.length + w.length + 1 > perLine) {
        rows.push(cur)
        cur = w
      } else cur = cur ? `${cur} ${w}` : w
    }
    if (cur) rows.push(cur)
    return rows
  })
  const height = wrapped.length * (size + 4) + 4
  const esc = (t) => t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
  return {
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${wrapped.map((t, i) => `<text x="2" y="${(i + 1) * (size + 4) - 2}" fill="${i === 0 ? '#e0e0e0' : '#9a9a9a'}" font-family="Helvetica, Arial, sans-serif" font-size="${size}">${esc(t)}</text>`).join('')}</svg>`,
    ),
    height,
  }
}

/** Rows of panels: each panel is { image buffer, width, height, lines }. */
async function grid(file, title, rows, columnWidth) {
  const gap = 10
  const columns = Math.max(...rows.map((r) => r.panels.length))
  const width = gap + columns * (columnWidth + gap)
  const head = textSvg([title], width - 2 * gap, 16)
  const layout = rows.map((row) => {
    const cap = Math.max(...row.panels.map((p) => textSvg(p.lines, columnWidth).height))
    const body = Math.max(...row.panels.map((p) => p.stack.reduce((s, part) => s + part.height + gap, 0)))
    return { cap, body, height: 22 + cap + body + gap }
  })
  const height = head.height + 16 + layout.reduce((s, l) => s + l.height, 0)
  const composites = [{ ...head, left: gap, top: 8 }]
  let top = head.height + 16
  rows.forEach((row, r) => {
    composites.push({ ...textSvg([row.title], width - 2 * gap, 14), left: gap, top })
    row.panels.forEach((p, c) => {
      const left = gap + c * (columnWidth + gap)
      composites.push({ ...textSvg(p.lines, columnWidth), left, top: top + 22 })
      let y = top + 22 + layout[r].cap
      for (const part of p.stack) {
        composites.push({ input: part.input, left, top: y })
        y += part.height + gap
      }
    })
    top += layout[r].height
  })
  await sharp({ create: { width, height, channels: 3, background: '#161616' } }).composite(composites).jpeg({ quality: 90 }).toFile(file)
  console.log(`wrote ${file.replace(root, '')}`)
}

const poster = await load(`${root}public/references/awe/sunset/sunset-film-poster-bands-full.png`)
const STRENGTHS = [0.5, 1]
const FRAMES = []
for (const name of ['bands-bold-s6-poster', 'bands-atmospheric-s6-poster']) {
  const image = await load(`${out}renders/${name}.png`)
  FRAMES.push({ name, image, plain: applyScreen(image, 0, 6), screened: Object.fromEntries(STRENGTHS.map((s) => [s, applyScreen(image, s, 6)])) })
}
const SIZE = 160
const Z = 4
const ZOOM_SIZE = 48
const AREAS = [
  ['poster red', 440, 975],
  ['poster near black', 440, 140],
  ['poster blue', 440, 480],
  ['poster grey', 440, 680],
]
const record = { areas: [] }
const rows = []
for (const [name, px, py] of AREAS) {
  const target = meanOklab(poster, px, py, SIZE)
  let best = null
  for (const frame of FRAMES) {
    for (let y = 0; y + SIZE <= frame.image.height; y += 16) {
      for (let x = 0; x + SIZE <= frame.image.width; x += 16) {
        const c = meanOklab(frame.image, x, y, SIZE)
        const d = Math.hypot(c[0] - target[0], c[1] - target[1], c[2] - target[2])
        if (!best || d < best.d) best = { x, y, d, c, frame }
      }
    }
  }
  const { plain, screened } = best.frame
  const panel = async (image, x0, y0, title, short) => {
    const c = crop(image, x0, y0, SIZE, SIZE)
    const middle = crop(c, (SIZE - ZOOM_SIZE) / 2, (SIZE - ZOOM_SIZE) / 2, ZOOM_SIZE, ZOOM_SIZE)
    const nb = numbers(c, short)
    return { lines: caption(title, nb), nb, stack: [{ input: await png(c), height: SIZE }, { input: await zoom(middle, Z), height: ZOOM_SIZE * Z }] }
  }
  const panels = [await panel(poster, px, py, `${name}, 1:1 (L ${target[0].toFixed(2)})`, 960)]
  const label = best.frame.name.replace('-poster', '').replace('bands-', 'Bands ').replace('-s6', ' seed 6')
  panels.push(await panel(plain, best.x, best.y, `ours, no screen (nearest color in ${label}: L ${best.c[0].toFixed(2)}, deltaE ${best.d.toFixed(3)})`, 960))
  for (const s of STRENGTHS) panels.push(await panel(screened[s], best.x, best.y, `ours, print screen ${s}`, 960))
  record.areas.push({ name, frame: best.frame.name, poster: panels[0].nb, ours: Object.fromEntries(panels.slice(1).map((p, i) => [['none', ...STRENGTHS][i], p.nb])), window: { x: best.x, y: best.y, d: best.d } })
  rows.push({ title: `${name} vs ${label} at the poster's size (960 x 1345)`, panels })
}
await grid(`${out}sheets/poster-vs-ours.jpg`, 'Film poster vs our print screen on the nearest colors: 1:1 crops, 4x zoom of the middle below', rows, ZOOM_SIZE * Z)

// Full frames at 1080p: the whole frame (shrunk), a 1:1 crop and its 3x zoom, for no screen, 0.5 and 1.
const fullRows = []
for (const name of ['ramp-bold-s1-1080p', 'bands-bold-s1-1080p', 'blooms-bold-s1-1080p']) {
  const frame = await load(`${out}renders/${name}.png`)
  const panels = []
  for (const s of [0, 0.5, 1]) {
    const image = applyScreen(frame, s, 1)
    const whole = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).resize(480, 270, { kernel: 'lanczos3' }).png().toBuffer()
    const c = crop(image, 1180, 300, 160, 160)
    const middle = crop(c, 52, 52, 56, 56)
    const nb = numbers(c, 1080)
    panels.push({
      lines: caption(`${name.replace('-1080p', '')}, ${s === 0 ? 'no screen' : `print screen ${s}`}: frame shrunk to 480 px, 1:1 crop, 3x zoom`, nb),
      stack: [
        { input: whole, height: 270 },
        { input: await png(c), height: 160 },
        { input: await zoom(middle, 3), height: 168 },
      ],
    })
    // Save the full-size screened frame only for the strongest, for looking at 1:1; deleted after the report.
    if (s === 1) await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).jpeg({ quality: 92 }).toFile(`${out}sheets/${name}-screen1.jpg`)
  }
  fullRows.push({ title: name, panels })
}
await grid(`${out}sheets/full-frames.jpg`, 'Ramp, Bands and Blooms (Bold, seed 1) at 1080p with the print screen', fullRows, 480)
writeFileSync(`${out}sheets/numbers.json`, JSON.stringify(record, null, 1))
for (const a of record.areas) {
  const f = (nb) => `${nb.cv.toFixed(2)} cv, L ${(nb.L * 100).toFixed(2)} %, ${nb.peak ? `${nb.peak.periodPx.toFixed(2)} px at ${nb.peak.angleDeg.toFixed(0)} deg` : 'no peak'}`
  console.log(`${a.name}: poster ${f(a.poster)} | ours none ${f(a.ours.none)} | 0.5 ${f(a.ours['0.5'])} | 1 ${f(a.ours['1'])}`)
}
