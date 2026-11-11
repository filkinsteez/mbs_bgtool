import { describe, expect, it } from 'vitest'
import { mixFromShares } from './mix'
import { linearToOklab } from './oklab'
import { getPack, hueOrder } from './packs'
import { hexToLinear } from './srgb'
import { carriedShares, lighterLast } from './stageCarry'
import { gridSize, type StageGrid } from './stageFields'
import { stageColors } from './stageSolve'

/** A sky lit from the top edge, falling off downward with a slow wave, as a drag from the top middle down draws it. */
function skyFromTop(wave: number): StageGrid {
  const [w, h] = gridSize(16 / 9)
  const lightness = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) lightness[y * w + x] = Math.max(0.05, 0.92 - 0.75 * (y / (h - 1)) + wave * Math.sin((x / w) * Math.PI * 2) * (y / h))
  const full = lightness.map(() => 1)
  return { width: w, height: h, lightness, coverage: full, softCoverage: full, peak: lightness, seen: lightness }
}

const TONE = [0.08, 0.45, 0.85, 0.95] as const

describe('carriedShares', () => {
  it('puts the lighter end of the hue order at the light whatever the pack', () => {
    const lighter = (id: 'bold' | 'elemental' | 'atmospheric') => {
      const pack = getPack(id)
      return lighterLast(hueOrder(pack).map((i) => linearToOklab(hexToLinear(pack.colors[i].hex))[0]))
    }
    expect(lighter('bold')).toBe(true)
    expect(lighter('elemental')).toBe(false)
    expect(lighter('atmospheric')).toBe(false)
  })

  it('never swaps the ends as a near-vertical drag moves a few pixels (owner, 2026-11-11 5:02 PM)', () => {
    const pack = getPack('bold')
    const mix = mixFromShares(pack, [0.5, 0, 0, 0.5])
    if (!mix) throw new Error('no mix')
    const colors = stageColors(pack, mix, true)
    const lighter = lighterLast(hueOrder(pack).map((i) => linearToOklab(hexToLinear(pack.colors[i].hex))[0]))
    const tops = new Set<string>()
    const bottoms = new Set<string>()
    for (let step = -8; step <= 8; step++) {
      // A drag from the top middle down, its end moved about 4 px at a time on a 1000 px preview.
      const angle = Math.atan2(step * 0.004 * (16 / 9), 0.88)
      const grid = skyFromTop(0.02 * step)
      const fields = colors.map(() => new Float32Array(grid.width * grid.height))
      const shares = carriedShares(grid, colors, fields, 5, { kind: 'grain', axis: [Math.sin(angle), Math.cos(angle)], lighterLast: lighter }, TONE)
      const rowShare = (k: number, y: number) => shares[k].slice(y * grid.width, (y + 1) * grid.width).reduce((a, b) => a + b, 0)
      const leader = (y: number) => colors[colors.map((_, k) => rowShare(k, y)).reduce((b, v, k, all) => (v > all[b] ? k : b), 0)].hex
      tops.add(leader(0))
      bottoms.add(leader(grid.height - 1))
    }
    expect([...tops]).toEqual(['#FF4F00'])
    expect([...bottoms]).toEqual(['#0064E0'])
  })
})
