// Comparison sheets: the targets next to current tool renders and prototype renders.
// node prototypes/organic-principle/sheets.mjs [--tag p] [--out results|out/sheets] [--seeds 3,7,12]
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { TARGETS, HERE } from './lib/targets.mjs'
import { sheet } from './lib/sheet.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const tag = opt('--tag', 'p')
const outDir = path.join(HERE, opt('--out', 'out/sheets'))
const seeds = opt('--seeds', '3,7,12').split(',')
const tool = opt('--tool', 'bands')
const name = opt('--name', `${tag}-vs-${tool}`)
fs.mkdirSync(outDir, { recursive: true })

// targets cropped as measured (no title, no frame shadow), cached as PNGs
const cache = path.join(HERE, 'out/targets')
fs.mkdirSync(cache, { recursive: true })
const target = async (k) => {
  const f = path.join(cache, `${k}.png`)
  if (!fs.existsSync(f)) {
    const t = TARGETS[k]
    let s = sharp(t.file).removeAlpha()
    if (t.crop) s = s.extract(t.crop)
    await s.png().toFile(f)
  }
  return f
}
const poster = await target('poster-etsy')
const ridge = await target('ridge')
const P = (f) => path.join(HERE, 'out/proto', f)
const T = (f) => path.join(HERE, 'out/tool', f)
const packs = ['bold', 'elemental', 'atmospheric']

for (const [format, ref, height] of [
  ['16x9', ridge, 170],
  ['9x16', poster, 330],
]) {
  const rows = []
  for (const pack of packs) {
    const tiles = [{ file: ref, label: format === '16x9' ? 'ridge 33:112' : 'poster' }]
    for (const s of seeds) tiles.push({ file: T(`${tool}-${pack}-s${s}-${format}.png`), label: `now: ${tool} ${pack} s${s}` })
    for (const s of seeds) tiles.push({ file: P(`${tag}-${pack}-s${s}-${format}.png`), label: `${tag} ${pack} s${s}` })
    rows.push({ tiles: tiles.filter((t) => fs.existsSync(t.file)) })
  }
  const out = path.join(outDir, `${name}-${format}.jpg`)
  const { W, H } = await sheet(rows, out, { height, quality: 86 })
  console.log(out, W, H, Math.round(fs.statSync(out).size / 1024) + ' KB')
}
