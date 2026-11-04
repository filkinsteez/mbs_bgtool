// 1:1 and 4x crops of one spot of a frame at several strengths, to check the LED shape up close.
//
//   node prototypes/pixel/zoom.mjs --frame beam-elemental-s1 --at 560,780 [--size 160x90]
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, parseSize } from '../../scripts/light/lib/args.mjs'
import { crop, loadLinear, toSharp } from './lib/image.mjs'
import { led3 } from './lib/pixel.mjs'
import { CAPTION, captioned, grid } from './lib/sheet.mjs'
import { pixelSettings } from './sets.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const args = parseArgs(process.argv.slice(2))
const frame = String(args.frame ?? 'beam-elemental-s1')
const [x0, y0] = String(args.at ?? '560,780').split(',').map(Number)
const { width: cw, height: ch } = parseSize(String(args.size ?? '160x90'))
const strengths = String(args.strengths ?? '0,0.5,1').split(',').map(Number)
const img = await loadLinear(path.join(HERE, 'out', 'frames', `${frame}-1920x1080.png`))
const Z = 4
const tiles = []
for (const s of strengths) {
  const out = s === 0 ? img : led3(img, pixelSettings(s))
  const png = await toSharp(crop(out, x0, y0, cw, ch)).resize(cw * Z, ch * Z, { kernel: 'nearest' }).png().toBuffer()
  tiles.push(await captioned(png, `strength ${s}, ${Z}x`, cw * Z, ch * Z))
}
const outDir = path.join(HERE, 'out', 'zoom')
await fs.mkdir(outDir, { recursive: true })
const file = path.join(outDir, `${frame}-${x0}-${y0}.png`)
await grid([tiles], { width: cw * Z, height: ch * Z + CAPTION }, { file, title: `${frame} at (${x0}, ${y0}), ${cw}x${ch} px shown ${Z}x` })
console.log(`wrote ${path.relative(process.cwd(), file)}`)
