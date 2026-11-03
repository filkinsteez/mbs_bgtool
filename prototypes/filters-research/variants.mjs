// node variants.mjs <shotId> <left,top,width,height> <name> [x2]
// Side-by-side crops of filter variants at strengths 0.5 and 1. With "x2" the shot is first
// enlarged 2x (lanczos; the light is smooth, so this stands in for a 2160 px export) and the
// crop box is doubled, so sizes tied to the short side show as they would in an export.
// Writes out/variants/<name>.png.
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { ascii, grain, pixel, riso } from './lib/filters.mjs'
import { decode8 } from './lib/color.mjs'
import { encode8 } from './lib/image.mjs'
import { grid } from './lib/sheet.mjs'

const VARIANTS = {
  riso: [
    ['riso A: riso-end grain', (img, s) => riso(img, s, 7)],
    ['riso B: + soft dots', (img, s) => riso(img, s, 7, { contrast: 0.35, dotRel: 0.0012, inkCap: 2 })],
    ['riso C: + bigger dots', (img, s) => riso(img, s, 7, { contrast: 0.6, dotRel: 0.002, inkCap: 2 })],
    ['grain (film to riso)', (img, s) => grain(img, s, 7)],
  ],
  ascii: [
    ['ascii 40 rows', (img, s) => ascii(img, s, 7, { rows: 40 })],
    ['ascii 64 rows', (img, s) => ascii(img, s, 7, { rows: 64 })],
    ['ascii 96 rows', (img, s) => ascii(img, s, 7, { rows: 96 })],
    ['pixel 72 rows', (img, s) => pixel(img, s, 7)],
  ],
  pixel: [
    ['pixel: flat cells (brief)', (img, s) => pixel(img, s, 7, { flat: true })],
    ['pixel: own colour per pixel', (img, s) => pixel(img, s, 7)],
  ],
}

const [shot, boxArg, name, scaleArg] = process.argv.slice(2)
const scale = scaleArg === 'x2' ? 2 : 1
const [left, top, width, height] = boxArg.split(',').map((v) => Number(v) * scale)
const root = new URL('./out/', import.meta.url).pathname
mkdirSync(`${root}variants`, { recursive: true })
const base = sharp(`${root}shots/${shot}.png`).removeAlpha()
const meta = await base.metadata()
const { data, info } = await base.resize(meta.width * scale, meta.height * scale, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true })
const img = { w: info.width, h: info.height, data: Float32Array.from(data, (v) => decode8(v)) }
const crop = async (im) => sharp(encode8(im, 7), { raw: { width: im.w, height: im.h, channels: 3 } }).extract({ left, top, width, height }).png().toBuffer()
const rows = []
const labels = []
for (const [label, fn] of VARIANTS[name]) {
  rows.push([await crop(img), await crop(fn(img, 0.5)), await crop(fn(img, 1))])
  labels.push(label)
}
await grid(rows, { width, height }, { header: ['off', '0.5', '1'], rowLabels: labels, file: `${root}variants/${name}-${shot}${scale === 2 ? '-x2' : ''}.png` })
console.log('done', name, shot, scale)
