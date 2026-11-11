import { describe, expect, it } from 'vitest'
import { bandingScore, hueBands, hueSteps, LIN, linePoints, oklab } from '../scripts/light/lib/banding.mjs'

const BLUE = '#0064E0'
const CYAN = '#1FCDF0'
const YELLOW = '#FFD61E'
const ORANGE_RED = '#FF4F00'

const linear = (hex: string) => [1, 3, 5].map((i) => LIN[parseInt(hex.slice(i, i + 2), 16)])
const toByte = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)))

// Each color held for `run` px, with `blend` px between neighbours mixed in linear light: linear RGB per px.
function strip(hexes: string[], run: number, blend: number): number[][] {
  const out: number[][] = []
  hexes.forEach((hex, k) => {
    for (let p = 0; p < run; p++) out.push(linear(hex))
    if (k === hexes.length - 1) return
    const [from, to] = [linear(hex), linear(hexes[k + 1])]
    for (let p = 1; p <= blend; p++) out.push(from.map((v, c) => v + ((to[c] - v) * p) / (blend + 1)))
  })
  return out
}
const samples = (rows: number[][]) =>
  rows.map(([r, g, b]) => {
    const [L, A, B] = oklab([r, g, b])
    return { L, a: A, b: B }
  })

describe('the banding score', () => {
  it('counts four hard stripes as four bands with three sharp steps', () => {
    const line = samples(strip([BLUE, CYAN, YELLOW, ORANGE_RED], 60, 0))
    expect(hueBands(line)).toHaveLength(4)
    expect(hueSteps(line)).toHaveLength(3)
  })

  it('counts a long blend between two colors as two bands and no sharp step', () => {
    const line = samples(strip([BLUE, CYAN], 100, 120))
    expect(hueBands(line)).toHaveLength(2)
    expect(hueSteps(line)).toHaveLength(0)
  })

  it('skips grey and dark samples', () => {
    const line = samples(strip(['#808080', '#050505', '#C0C0C0'], 60, 20))
    expect(hueBands(line)).toHaveLength(0)
    expect(hueSteps(line)).toHaveLength(0)
  })

  it('runs a line from one edge of the frame to the other', () => {
    expect(linePoints([60, 30], [1, 0], 120, 60)).toHaveLength(120)
    expect(linePoints([60, 30], [0, 1], 120, 60)).toHaveLength(60)
  })

  it('finds the stripes along a line through the brightest place of a frame', () => {
    const [w, h] = [120, 60]
    const row = strip([BLUE, CYAN, YELLOW, ORANGE_RED], 30, 0)
    const rgb = new Uint8Array(w * h * 3)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) row[x].forEach((v, c) => (rgb[3 * (y * w + x) + c] = toByte(v)))
    const score = bandingScore(rgb, w, h)
    expect(score.bands).toBe(4)
    expect(score.sharp).toBe(3)
    expect(score.glow[0]).toBeGreaterThanOrEqual(60)
    expect(score.glow[0]).toBeLessThan(90)
  })
})
