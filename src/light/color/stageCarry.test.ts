import { describe, expect, it } from 'vitest'
import { mixFromShares } from './mix'
import { getPack, type PackId } from './packs'
import { carriedShares } from './stageCarry'
import { gridSize, type StageGrid } from './stageFields'
import { stageColors } from './stageSolve'

/** A sky lit from the top edge, falling off downward with a slow wave, as a drag from the top middle down draws it; `dark` rows at the bottom are a dark ground. */
function skyFromTop(wave: number, dark = 0): StageGrid {
  const [w, h] = gridSize(16 / 9)
  const lightness = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) lightness[y * w + x] = y >= h - dark ? 0.06 : Math.max(0.05, 0.92 - 0.75 * (y / (h - 1)) + wave * Math.sin((x / w) * Math.PI * 2) * (y / h))
  const full = lightness.map(() => 1)
  return { width: w, height: h, lightness, coverage: full, softCoverage: full, peak: lightness, seen: lightness }
}

/** Each color's middle row, as a share of the height, weighted by its share. */
function middles(shares: Float32Array[], grid: StageGrid): number[] {
  return shares.map((s) => {
    let a = 0
    let m = 0
    for (let y = 0; y < grid.height; y++) {
      const row = s.slice(y * grid.width, (y + 1) * grid.width).reduce((p, q) => p + q, 0)
      a += row
      m += row * (y / (grid.height - 1))
    }
    return a > 1e-9 ? m / a : 0.5
  })
}

describe('carriedShares', () => {
  it('never swaps the ends as a near-vertical drag moves a few pixels (owner, 2026-11-11 5:02 PM)', () => {
    const pack = getPack('bold')
    const mix = mixFromShares(pack, [0.5, 0, 0, 0.5])
    if (!mix) throw new Error('no mix')
    const colors = stageColors(pack, mix, true)
    const tops = new Set<string>()
    const bottoms = new Set<string>()
    for (let step = -8; step <= 8; step++) {
      // A drag from the top middle down, its end moved about 4 px at a time on a 1000 px preview.
      const angle = Math.atan2(step * 0.004 * (16 / 9), 0.88)
      const grid = skyFromTop(0.02 * step)
      const fields = colors.map(() => new Float32Array(grid.width * grid.height))
      const shares = carriedShares(grid, colors, fields, 5, { kind: 'grain', axis: [Math.sin(angle), Math.cos(angle)] })
      const rowShare = (k: number, y: number) => shares[k].slice(y * grid.width, (y + 1) * grid.width).reduce((a, b) => a + b, 0)
      const leader = (y: number) => colors[colors.map((_, k) => rowShare(k, y)).reduce((b, v, k, all) => (v > all[b] ? k : b), 0)].hex
      tops.add(leader(0))
      bottoms.add(leader(grid.height - 1))
    }
    expect(tops.size).toBe(1)
    expect(bottoms.size).toBe(1)
    expect([...tops]).not.toEqual([...bottoms])
  })

  it('moves colors only a little as a slider moves in small steps', () => {
    // One color's slider moved 1% at a time with Meta Blue at 50% and the others sharing the rest evenly (Mix: in Rush
    // Elemental s2, Tan going from 38% to 40% repainted 84% of the pixels).
    const cases: { id: PackId; color: string }[] = [
      { id: 'bold', color: 'Yellow' },
      { id: 'elemental', color: 'Tan' },
    ]
    for (const { id, color } of cases) {
      const pack = getPack(id)
      const grid = skyFromTop(0.01)
      const moved = pack.colors.findIndex((c) => c.name === color)
      const blue = pack.colors.findIndex((c) => c.hex === '#0064E0')
      let last: number[] | null = null
      for (let share = 0.04; share <= 0.4 + 1e-9; share += 0.01) {
        const rest = (0.5 - share) / (pack.colors.length - 2)
        const mix = mixFromShares(
          pack,
          pack.colors.map((_, i) => (i === blue ? 0.5 : i === moved ? share : rest)),
        )
        if (!mix) throw new Error('no mix')
        const colors = stageColors(pack, mix, true)
        const fields = colors.map(() => new Float32Array(grid.width * grid.height))
        const now = middles(carriedShares(grid, colors, fields, 5, { kind: 'grain', axis: [0, 1] }), grid)
        if (last) now.forEach((v, k) => expect(Math.abs(v - (last as number[])[k]), `${id} ${color} ${share.toFixed(2)} ${colors[k].hex}`).toBeLessThan(0.1))
        last = now
      }
    }
  })

  it('along an outline counts shares by light, and the dark room is not a small color (owner, 2026-11-11 6:12 PM)', () => {
    const pack = getPack('bold')
    const mix = mixFromShares(pack, [0.75, 0.09, 0.08, 0.08])
    if (!mix) throw new Error('no mix')
    const colors = stageColors(pack, mix, true)
    // A lit rim arching across the lower frame, its glow falling off upward into a dim room.
    const [w, h] = gridSize(16 / 9)
    const lightness = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const rim = h - 8 - 10 * Math.sin((Math.PI * x) / (w - 1))
        const d = Math.abs(y - rim)
        lightness[y * w + x] = y > rim + 1 ? 0.04 : Math.min(0.95, 0.12 + 0.83 * Math.exp(-d / 3))
      }
    const full = lightness.map(() => 1)
    const grid: StageGrid = { width: w, height: h, lightness, coverage: full, softCoverage: full, peak: lightness, seen: lightness }
    const fields = colors.map(() => new Float32Array(w * h))
    const shares = carriedShares(grid, colors, fields, 5, { kind: 'outline' })
    const red = colors.findIndex((c) => c.hex === '#FF4F00')
    const blue = colors.findIndex((c) => c.hex === '#0064E0')
    let light = 0
    let redLight = 0
    let dim = 0
    let dimSmall = 0
    for (let i = 0; i < w * h; i++) {
      const l2 = lightness[i] * lightness[i]
      light += l2
      redLight += l2 * shares[red][i]
      if (lightness[i] < 0.2 && lightness[i] > 0.05) {
        dim++
        if (colors.some((_, k) => k !== blue && shares[k][i] > 0.5)) dimSmall++
      }
    }
    expect(Math.abs(redLight / light - 0.08)).toBeLessThan(0.03)
    expect(dimSmall / dim).toBeLessThan(0.2)
  })

  it('counts shares by light, so a small color stays out of a dark ground (owner, 2026-11-11 6:16 PM)', () => {
    const pack = getPack('bold')
    const mix = mixFromShares(pack, [0.75, 0.04, 0.05, 0.16])
    if (!mix) throw new Error('no mix')
    const colors = stageColors(pack, mix, true)
    const dark = 10
    const grid = skyFromTop(0, dark)
    const fields = colors.map(() => new Float32Array(grid.width * grid.height))
    const shares = carriedShares(grid, colors, fields, 5, { kind: 'grain', axis: [0, 1] })
    const red = colors.findIndex((c) => c.hex === '#FF4F00')
    let inDark = 0
    let all = 0
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) {
        const v = shares[red][y * grid.width + x]
        all += v
        if (y >= grid.height - dark) inDark += v
      }
    expect(inDark / all).toBeLessThan(0.25)
  })
})
