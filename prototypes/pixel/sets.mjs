// Candidate sets shared by run.mjs (1:1 crops) and full.mjs (whole frames).
import { led3, roundedTile, superGauss } from './lib/pixel.mjs'

const TILE = roundedTile(0.4, 0.12, 4)

export const LED3 = [
  ['off', (img) => img],
  ['M1. 36 cells, flat q8, tile x0.3, glow 0.25', (img) => led3(img, { cells: 36, q: 8, shape: TILE, contrast: 0.3, halo: 0.25 })],
  ['M2. 36 cells, flat q8, round s0.34 x0.5, glow 0.25', (img) => led3(img, { cells: 36, q: 8, shape: superGauss(2, 0.34), contrast: 0.5, halo: 0.25 })],
  ['M3. 36 cells, q4, tile x0.25, glow 0.35', (img) => led3(img, { cells: 36, q: 4, shape: roundedTile(0.42, 0.16, 4), contrast: 0.25, halo: 0.35 })],
  ['M4. 36 cells, flat q8, no LED shape, glow 0.3', (img) => led3(img, { cells: 36, q: 8, halo: 0.3 })],
  ['M5. 24 cells, flat q8, tile x0.3, glow 0.25', (img) => led3(img, { cells: 24, q: 8, shape: TILE, contrast: 0.3, halo: 0.25 })],
  ['M6. 48 cells, flat q8, tile x0.3, glow 0.25', (img) => led3(img, { cells: 48, q: 8, shape: TILE, contrast: 0.3, halo: 0.25 })],
  ['M7. 36 cells, flat q8, tile x0.3, no glow', (img) => led3(img, { cells: 36, q: 8, shape: TILE, contrast: 0.3 })],
]

const SOFT_TILE = roundedTile(0.38, 0.2, 3)

export const LOW = [
  ['off', (img) => img],
  ['N1. 36 cells, q8, tile x0.15, glow 0.3', (img) => led3(img, { cells: 36, q: 8, shape: TILE, contrast: 0.15, halo: 0.3 })],
  ['N2. 36 cells, q8, tile x0.10, glow 0.3', (img) => led3(img, { cells: 36, q: 8, shape: TILE, contrast: 0.1, halo: 0.3 })],
  ['N3. 36 cells, q8, soft tile x0.15, glow 0.3', (img) => led3(img, { cells: 36, q: 8, shape: SOFT_TILE, contrast: 0.15, halo: 0.3 })],
  ['N4. 36 cells, q6, soft tile x0.20, glow 0.3', (img) => led3(img, { cells: 36, q: 6, shape: SOFT_TILE, contrast: 0.2, halo: 0.3 })],
  ['N5. 48 cells, q8, tile x0.15, glow 0.3', (img) => led3(img, { cells: 48, q: 8, shape: TILE, contrast: 0.15, halo: 0.3 })],
  ['N6. 36 cells, q8, round s0.34 x0.25, glow 0.3', (img) => led3(img, { cells: 36, q: 8, shape: superGauss(2, 0.34), contrast: 0.25, halo: 0.3 })],
  ['N7. as N1, 4 x 4 point samples a cell', (img) => led3(img, { cells: 36, q: 8, shape: TILE, contrast: 0.15, halo: 0.3, samples: 4 })],
  ['N8. as N1, 8 x 8 point samples a cell', (img) => led3(img, { cells: 36, q: 8, shape: TILE, contrast: 0.15, halo: 0.3, samples: 8 })],
]

/** The chosen filter at a strength 0..1: 0 to 0.5 fades it in, 0.5 to 1 raises the LED contrast from 0.10 to 0.20. */
export function pixelSettings(strength, extra = {}) {
  const s = Math.min(1, Math.max(0, strength))
  return { cells: 36, q: 8, shape: TILE, halo: 0.3, fadeFrom: 0.7, amount: Math.min(1, s / 0.5), contrast: 0.1 + 0.1 * Math.max(0, (s - 0.5) / 0.5), ...extra }
}

export const STRENGTH = [0, 0.25, 0.5, 0.75, 1].map((s) => [`strength ${s}`, (img) => (s === 0 ? img : led3(img, pixelSettings(s)))])

/** Candidates for the LED contrast at strength 1. */
export const TOP = [
  ['off', (img) => img],
  ...[0.1, 0.15, 0.2, 0.25, 0.3].map((c) => [`LED contrast ${c}`, (img) => led3(img, pixelSettings(1, { contrast: c }))]),
]
