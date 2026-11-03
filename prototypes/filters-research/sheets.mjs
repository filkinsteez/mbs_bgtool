// node sheets.mjs [filter,...]
// Contact sheets from out/filtered: strength sweeps (0, 0.25, 0.5, 1) per filter and
// format, 1:1 and 3x crops, and an overview of all filters at 0.5. Writes to out/sheets/.
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { STRENGTHS_ALL, grid } from './lib/sheet.mjs'

const root = new URL('./out/', import.meta.url).pathname
const outDir = `${root}sheets/`
mkdirSync(outDir, { recursive: true })
const src = (shot, filter, s) => (s === 0 ? `${root}shots/${shot}.png` : `${root}filtered/${shot}/${filter}-${s}.png`)

const LAND = ['ramp-bold-s7-16x9', 'bands-elemental-s3-16x9', 'blooms-atmospheric-s2-16x9', 'halo-bold-s4-16x9', 'rim-elemental-s5-16x9']
const PORT = ['ramp-atmospheric-s11-9x16', 'bands-bold-s5-9x16', 'blooms-elemental-s8-9x16', 'halo-atmospheric-s6-9x16', 'rim-bold-s9-9x16']

// Crop boxes in source pixels (preview canvas at device scale 2): where each filter's texture meets the light.
const CROPS = {
  'ramp-bold-s7-16x9': { left: 1180, top: 640, width: 400, height: 300 },
  'bands-elemental-s3-16x9': { left: 700, top: 180, width: 400, height: 300 },
  'halo-bold-s4-16x9': { left: 1100, top: 560, width: 400, height: 300 },
  'blooms-elemental-s8-9x16': { left: 214, top: 1100, width: 400, height: 300 },
  'rim-bold-s9-9x16': { left: 300, top: 780, width: 400, height: 300 },
}
const ZOOM = ['ramp-bold-s7-16x9', 'halo-bold-s4-16x9']

async function tile(path, opts) {
  return sharp(path).removeAlpha().resize(opts).png().toBuffer()
}

async function sweep(filter, shots, fmt) {
  const size = fmt === '16x9' ? { width: 448, height: 252 } : { width: 216, height: 384 }
  const rows = []
  for (const shot of shots) rows.push(await Promise.all(STRENGTHS_ALL.map((s) => tile(src(shot, filter, s), size))))
  const header = STRENGTHS_ALL.map((s) => (s === 0 ? 'off' : `${filter} ${s}`))
  const transpose = fmt === '9x16'
  const file = `${outDir}${filter}-${fmt}.jpg`
  await grid(transpose ? STRENGTHS_ALL.map((_, c) => rows.map((r) => r[c])) : rows, size, { header: transpose ? null : header, rowLabels: transpose ? header : shots, file })
  return file
}

async function crops(filter) {
  const rows = []
  const names = []
  for (const [shot, box] of Object.entries(CROPS)) {
    rows.push(await Promise.all(STRENGTHS_ALL.map((s) => sharp(src(shot, filter, s)).removeAlpha().extract(box).png().toBuffer())))
    names.push(`${shot.split('-').slice(0, 2).join(' ')} 1:1`)
  }
  for (const shot of ZOOM) {
    const box = CROPS[shot]
    const zoomBox = { left: box.left + 150, top: box.top + 100, width: 134, height: 100 }
    rows.push(await Promise.all(STRENGTHS_ALL.map((s) => sharp(src(shot, filter, s)).removeAlpha().extract(zoomBox).resize(402, 300, { kernel: 'nearest' }).extract({ left: 0, top: 0, width: 400, height: 300 }).png().toBuffer())))
    names.push(`${shot.split('-').slice(0, 2).join(' ')} 3x`)
  }
  const file = `${outDir}${filter}-crops.png`
  await grid(rows, { width: 400, height: 300 }, { header: STRENGTHS_ALL.map((s) => (s === 0 ? 'off' : `${filter} ${s}`)), rowLabels: names, file })
  return file
}

async function overview(shots, fmt, s) {
  const size = fmt === '16x9' ? { width: 448, height: 252 } : { width: 216, height: 384 }
  const cols = ['none', 'grain', 'riso', 'ascii', 'pixel']
  const rows = []
  for (const shot of shots) rows.push(await Promise.all(cols.map((f) => tile(f === 'none' ? src(shot, f, 0) : src(shot, f, s), size))))
  const file = `${outDir}overview-${fmt}-${s}.jpg`
  const transpose = fmt === '9x16'
  const header = cols.map((f) => (f === 'none' ? 'off' : `${f} ${s}`))
  await grid(transpose ? cols.map((_, c) => rows.map((r) => r[c])) : rows, size, { header: transpose ? null : header, rowLabels: transpose ? header : shots, file })
  return file
}

const filters = (process.argv[2] ?? 'grain,riso,ascii,pixel').split(',')
for (const f of filters) {
  console.log(await sweep(f, LAND, '16x9'))
  console.log(await sweep(f, PORT, '9x16'))
  console.log(await crops(f))
}
for (const s of [0.5, 1]) {
  console.log(await overview(LAND, '16x9', s))
  console.log(await overview(PORT, '9x16', s))
}
