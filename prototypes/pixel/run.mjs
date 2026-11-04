// Applies Pixel filter variants to exported frames and writes sheets of 1:1 crops (one sheet per frame) plus a
// sheet of full frames.
//
//   node prototypes/pixel/run.mjs --set variants [--frames ramp-bold-s1,rim-bold-s1] [--size 1920x1080]
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from '../../scripts/light/lib/args.mjs'
import { busiestWindow, crop, loadLinear, toSharp } from './lib/image.mjs'
import { coreGlow, led, led2, mosaic, standIn, superGauss } from './lib/pixel.mjs'
import { CAPTION, captioned, grid } from './lib/sheet.mjs'
import { LED3, LOW, STRENGTH } from './sets.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const args = parseArgs(process.argv.slice(2))
const size = typeof args.size === 'string' ? args.size : '1920x1080'
const frames = (typeof args.frames === 'string' ? args.frames : 'ramp-bold-s1,bands-elemental-s1,rim-bold-s1,halo-bold-s1').split(',')
const setName = typeof args.set === 'string' ? args.set : 'variants'
const cells = Number(args.cells ?? 54)

const SETS = {
  variants: [
    ['off', (img) => img],
    ['Figma stand-in, literal', (img) => standIn(img)],
    ['flat cells', (img) => mosaic(img, { cells })],
    ['round dots', (img) => led(img, { cells, shape: 'round' })],
    ['round dots, hot cores kept', (img) => led(img, { cells, shape: 'round', limitBy: 'peak' })],
    ['rounded squares', (img) => led(img, { cells, shape: 'square' })],
    ['discs', (img) => led(img, { cells, shape: 'disc' })],
    ['tiles', (img) => led(img, { cells, shape: 'tile' })],
    ['rounded squares, per channel', (img) => led(img, { cells, shape: 'square', perChannel: true })],
  ],
  contrast: [
    ['off', (img) => img],
    ['round s0.42', (img) => led(img, { cells, shape: superGauss(2, 0.42) })],
    ['round s0.38', (img) => led(img, { cells, shape: superGauss(2, 0.38) })],
    ['round s0.34', (img) => led(img, { cells, shape: superGauss(2, 0.34) })],
    ['round s0.30 amount 0.4', (img) => led(img, { cells, shape: superGauss(2, 0.3), amount: 0.4 })],
    ['round s0.38, hot cores kept', (img) => led(img, { cells, shape: superGauss(2, 0.38), limitBy: 'peak' })],
    ['square n4 s0.40', (img) => led(img, { cells, shape: superGauss(4, 0.4) })],
    ['square n4 s0.36', (img) => led(img, { cells, shape: superGauss(4, 0.36) })],
    ['square n4 s0.36, hot cores kept', (img) => led(img, { cells, shape: superGauss(4, 0.36), limitBy: 'peak' })],
  ],
  amount: [
    ['off', (img) => img],
    ['square s0.40 amount 0.33', (img) => led(img, { cells, shape: superGauss(4, 0.4), amount: 0.33 })],
    ['square s0.40 amount 0.66', (img) => led(img, { cells, shape: superGauss(4, 0.4), amount: 0.66 })],
    ['square s0.40 amount 1', (img) => led(img, { cells, shape: superGauss(4, 0.4), amount: 1 })],
    ['round s0.36 amount 0.33', (img) => led(img, { cells, shape: superGauss(2, 0.36), amount: 0.33 })],
    ['round s0.36 amount 0.66', (img) => led(img, { cells, shape: superGauss(2, 0.36), amount: 0.66 })],
    ['round s0.36 amount 1', (img) => led(img, { cells, shape: superGauss(2, 0.36), amount: 1 })],
    ['square s0.40, 36 cells', (img) => led(img, { cells: 36, shape: superGauss(4, 0.4) })],
    ['square s0.40, 80 cells', (img) => led(img, { cells: 80, shape: superGauss(4, 0.4) })],
  ],
  concepts: [
    ['off', (img) => img],
    ['A2. 32 cells, snap q4, no pattern', (img) => led2(img, { cells: 32, q: 4, shape: 'none' })],
    ['A3. 32 cells, snap q2, no pattern', (img) => led2(img, { cells: 32, q: 2, shape: 'none' })],
    ['B. 32 cells, q3, round s0.40 x0.4', (img) => led2(img, { cells: 32, q: 3, shape: superGauss(2, 0.4), contrast: 0.4 })],
    ['C. 48 cells, q2, core 0.3 + glow', (img) => led2(img, { cells: 48, q: 2, shape: coreGlow(0.3, 0.22, 0.7), contrast: 1 })],
    ['C2. 32 cells, q3, core 0.3 + glow x0.5', (img) => led2(img, { cells: 32, q: 3, shape: coreGlow(0.3, 0.22, 0.7), contrast: 0.5 })],
    ['C3. 32 cells, q3, core 0.2 + glow x0.35', (img) => led2(img, { cells: 32, q: 3, shape: coreGlow(0.2, 0.18, 0.7), contrast: 0.35 })],
    ['D. 72 cells, q1, round s0.40 x0.6', (img) => led2(img, { cells: 72, q: 1, shape: superGauss(2, 0.4), contrast: 0.6 })],
    ['E. 32 cells, q3, square s0.42 x0.6', (img) => led2(img, { cells: 32, q: 3, shape: superGauss(4, 0.42), contrast: 0.6 })],
  ],
  balanced: [
    ['off', (img) => img],
    ['K1. 36 cells, q2, round s0.40', (img) => led2(img, { cells: 36, q: 2, shape: superGauss(2, 0.4), contrast: 1 })],
    ['K2. 36 cells, q2, round s0.34 x0.4', (img) => led2(img, { cells: 36, q: 2, shape: superGauss(2, 0.34), contrast: 0.4 })],
    ['K3. 40 cells, q2.5, round s0.36 x0.5', (img) => led2(img, { cells: 40, q: 2.5, shape: superGauss(2, 0.36), contrast: 0.5 })],
    ['K4. 48 cells, q1.5, round s0.36 x0.6', (img) => led2(img, { cells: 48, q: 1.5, shape: superGauss(2, 0.36), contrast: 0.6 })],
    ['K5. 32 cells, q2, core 0.2 + glow x0.3', (img) => led2(img, { cells: 32, q: 2, shape: coreGlow(0.2, 0.2, 0.6), contrast: 0.3 })],
  ],
  led3: LED3,
  low: LOW,
  strength: STRENGTH,
}

const outDir = path.join(HERE, 'out', setName)
await fs.mkdir(outDir, { recursive: true })
const variants = SETS[setName]
const CW = 480
const CH = 270
const thumbs = []
for (const name of frames) {
  const img = await loadLinear(path.join(HERE, 'out', 'frames', `${name}-${size}.png`))
  const [x0, y0] = busiestWindow(img, CW, CH)
  const tiles = []
  const row = []
  for (const [label, fn] of variants) {
    const t0 = performance.now()
    const out = fn(img)
    const ms = performance.now() - t0
    tiles.push(await captioned(await toSharp(crop(out, x0, y0, CW, CH)).png().toBuffer(), label, CW, CH))
    row.push(await toSharp(out).resize(384, 216).png().toBuffer())
    console.log(`${name} ${label}: ${ms.toFixed(0)} ms`)
  }
  const cols = 3
  const rows = []
  for (let i = 0; i < tiles.length; i += cols) rows.push(tiles.slice(i, i + cols))
  await grid(rows, { width: CW, height: CH + CAPTION }, { file: path.join(outDir, `${name}-crops.png`), title: `${name}, 1:1 crop at (${x0}, ${y0}) of a ${size} frame` })
  thumbs.push(row)
}
await grid(thumbs, { width: 384, height: 216 }, { file: path.join(outDir, 'frames.jpg'), header: variants.map(([l]) => l), rowLabels: frames })
console.log(`wrote ${path.relative(process.cwd(), outDir)}`)
