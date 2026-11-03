// node results.mjs
// Copies the sheets the docs use from out/ to results/ (PNG, or JPEG q 90 4:4:4 when the
// PNG would pass 1 MB; every file must stay under 1 MB) and prints the metrics table.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const here = new URL('./', import.meta.url).pathname
const out = `${here}out/`
const res = `${here}results/`
mkdirSync(res, { recursive: true })
const LIMIT = 1024 * 1024

const PICKS = [
  ['sheets/overview-16x9-0.5.jpg', 'overview-16x9-0.5'],
  ['sheets/overview-16x9-1.jpg', 'overview-16x9-1'],
  ['sheets/overview-9x16-0.5.jpg', 'overview-9x16-0.5'],
  ['sheets/grain-crops.png', 'grain-crops'],
  ['sheets/riso-crops.png', 'riso-crops'],
  ['sheets/ascii-crops.png', 'ascii-crops'],
  ['sheets/pixel-crops.png', 'pixel-crops'],
  ['sheets/ascii-16x9.jpg', 'ascii-16x9'],
  ['sheets/ascii-9x16.jpg', 'ascii-9x16'],
  ['sheets/riso-16x9.jpg', 'riso-16x9'],
  ['sheets/pixel-16x9.jpg', 'pixel-16x9'],
  ['variants/riso-ramp-bold-s7-16x9.png', 'riso-dot-screens-tested'],
  ['variants/ascii-halo-bold-s4-16x9-x2.png', 'ascii-rows-export-size'],
  ['variants/pixel-rim-bold-s9-9x16.png', 'pixel-flat-vs-own-colour'],
]

for (const [from, name] of PICKS) {
  const src = `${out}${from}`
  let file = `${res}${name}.png`
  let buf = await sharp(src).png({ compressionLevel: 9 }).toBuffer()
  if (buf.length >= LIMIT) {
    file = `${res}${name}.jpg`
    let q = 90
    buf = await sharp(src).jpeg({ quality: q, chromaSubsampling: '4:4:4' }).toBuffer()
    while (buf.length >= LIMIT && q > 60) {
      q -= 5
      buf = await sharp(src).jpeg({ quality: q, chromaSubsampling: '4:4:4' }).toBuffer()
    }
  }
  writeFileSync(file, buf)
  console.log(file.replace(here, ''), (statSync(file).size / 1024).toFixed(0), 'KB')
}

const metrics = JSON.parse(readFileSync(`${out}metrics.json`, 'utf8'))
const groups = {}
for (const [key, v] of Object.entries(metrics)) {
  const [, f, s] = key.split('|')
  ;(groups[`${f}|${s}`] ??= []).push(v)
}
const order = ['grain', 'riso', 'ascii', 'pixel'].flatMap((f) => ['0.25', '0.5', '1'].map((s) => `${f}|${s}`))
const f4 = (x) => x.toFixed(4)
const lines = ['| Filter | Strength | Blur: mean (worst image) | Blur: worst p95 | Shrunk 8x: mean (worst image) | Shrunk 8x: worst p95 |', '| --- | --- | --- | --- | --- | --- |']
for (const key of order) {
  const list = groups[key]
  if (!list) continue
  const [f, s] = key.split('|')
  const avg = (k) => list.reduce((t, v) => t + v[k], 0) / list.length
  const max = (k) => Math.max(...list.map((v) => v[k]))
  lines.push(`| ${f} | ${s} | ${f4(avg('blurMean'))} (${f4(max('blurMean'))}) | ${f4(max('blurP95'))} | ${f4(avg('thumbMean'))} (${f4(max('thumbMean'))}) | ${f4(max('thumbP95'))} |`)
}
console.log(`\n${lines.join('\n')}`)
writeFileSync(`${res}metrics.md`, `${lines.join('\n')}\n`)
