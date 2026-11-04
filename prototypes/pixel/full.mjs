// Whole frames at half size, two per row, to judge how the filter reads at viewing size.
//
//   node prototypes/pixel/full.mjs --set cells [--frames ramp-bold-s1,halo-bold-s1]
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from '../../scripts/light/lib/args.mjs'
import { loadLinear, shrink, toSharp } from './lib/image.mjs'
import { coreGlow, led, led2, superGauss } from './lib/pixel.mjs'
import { CAPTION, captioned, grid } from './lib/sheet.mjs'
import { LED3, LOW, STRENGTH, TOP } from './sets.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const args = parseArgs(process.argv.slice(2))
const frames = (typeof args.frames === 'string' ? args.frames : 'ramp-bold-s1,halo-bold-s1,rim-bold-s1').split(',')
const setName = typeof args.set === 'string' ? args.set : 'cells'

const SETS = {
  cells: [
    ['off', (img) => img],
    ['40 cells, amount 0.6, square s0.38', (img) => led(img, { cells: 40, shape: superGauss(4, 0.38), amount: 0.6 })],
    ['54 cells, amount 0.6, square s0.38', (img) => led(img, { cells: 54, shape: superGauss(4, 0.38), amount: 0.6 })],
    ['72 cells, amount 0.6, square s0.38', (img) => led(img, { cells: 72, shape: superGauss(4, 0.38), amount: 0.6 })],
    ['54 cells, amount 1, square s0.42', (img) => led(img, { cells: 54, shape: superGauss(4, 0.42), amount: 1 })],
    ['72 cells, amount 1, square s0.42', (img) => led(img, { cells: 72, shape: superGauss(4, 0.42), amount: 1 })],
  ],
  low: [
    ['off', (img) => img],
    ['54 cells, round s0.40', (img) => led(img, { cells: 54, shape: superGauss(2, 0.4) })],
    ['72 cells, round s0.40', (img) => led(img, { cells: 72, shape: superGauss(2, 0.4) })],
    ['96 cells, round s0.40', (img) => led(img, { cells: 96, shape: superGauss(2, 0.4) })],
    ['54 cells, round s0.44', (img) => led(img, { cells: 54, shape: superGauss(2, 0.44) })],
    ['72 cells, round s0.44', (img) => led(img, { cells: 72, shape: superGauss(2, 0.44) })],
  ],
  coarse: [
    ['off', (img) => img],
    ['24 cells, square s0.45', (img) => led(img, { cells: 24, shape: superGauss(4, 0.45) })],
    ['24 cells, square s0.42', (img) => led(img, { cells: 24, shape: superGauss(4, 0.42) })],
    ['24 cells, round s0.40', (img) => led(img, { cells: 24, shape: superGauss(2, 0.4) })],
    ['32 cells, square s0.45', (img) => led(img, { cells: 32, shape: superGauss(4, 0.45) })],
    ['32 cells, square s0.42', (img) => led(img, { cells: 32, shape: superGauss(4, 0.42) })],
  ],
  form2: [
    ['off', (img) => img],
    ['32 cells, flat-ish snap q3, square s0.40 x0.5', (img) => led2(img, { cells: 32, q: 3, shape: superGauss(4, 0.4), contrast: 0.5 })],
    ['32 cells, smooth snap q1, round s0.40', (img) => led2(img, { cells: 32, q: 1, shape: superGauss(2, 0.4), contrast: 1 })],
    ['48 cells, flat-ish snap q3, square s0.40 x0.5', (img) => led2(img, { cells: 48, q: 3, shape: superGauss(4, 0.4), contrast: 0.5 })],
    ['48 cells, snap q2, round s0.36 x0.5', (img) => led2(img, { cells: 48, q: 2, shape: superGauss(2, 0.36), contrast: 0.5 })],
    ['48 cells, flat-ish snap q3, square s0.42', (img) => led2(img, { cells: 48, q: 3, shape: superGauss(4, 0.42), contrast: 1 })],
  ],
  concepts: [
    ['off', (img) => img],
    ['A. big soft pixels: 24 cells, snap q4, no pattern', (img) => led2(img, { cells: 24, q: 4, shape: 'none' })],
    ['B. soft pixels, faint glow: 32 cells, q3, round s0.40 x0.4', (img) => led2(img, { cells: 32, q: 3, shape: superGauss(2, 0.4), contrast: 0.4 })],
    ['C. LED points: 48 cells, q2, core 0.3 + glow', (img) => led2(img, { cells: 48, q: 2, shape: coreGlow(0.3, 0.22, 0.7), contrast: 1 })],
    ['D. fine screen: 72 cells, q1, round s0.40 x0.6', (img) => led2(img, { cells: 72, q: 1, shape: superGauss(2, 0.4), contrast: 0.6 })],
    ['A2. soft pixels: 32 cells, snap q4, no pattern', (img) => led2(img, { cells: 32, q: 4, shape: 'none' })],
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
  ledlow: LOW,
  strength: STRENGTH,
  top: TOP,
}

const outDir = path.join(HERE, 'out', `full-${setName}`)
await fs.mkdir(outDir, { recursive: true })
const W = 960
const H = 540
for (const name of frames) {
  const img = await loadLinear(path.join(HERE, 'out', 'frames', `${name}-1920x1080.png`))
  const tiles = []
  for (const [label, fn] of SETS[setName]) {
    // Shrink in linear light, as the eye averages a screen.
    tiles.push(await captioned(await toSharp(shrink(fn(img), 2)).png().toBuffer(), label, W, H))
  }
  const rows = []
  for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2))
  await grid(rows, { width: W, height: H + CAPTION }, { file: path.join(outDir, `${name}.jpg`), title: `${name}, whole frame shrunk 2x in linear light` })
  console.log(`wrote ${name}`)
}
