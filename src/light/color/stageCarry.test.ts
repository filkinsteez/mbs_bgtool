import { describe, expect, it } from 'vitest'
import { defaultMix, mixFromShares, setShare } from './mix'
import { getPack, type PackId } from './packs'
import { bandShares, brightEndFirst, carriedShares } from './stageCarry'
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

  it("keeps the way the colors run across a grain as a slider moves: the way of the pack's default mix", () => {
    // Light across the flow in three soft bumps. Judged on the current shares, the order turned round as Tan went from
    // 12% to 14% (in Rush, 2% slider steps turned the order round and repainted 41-66% of the picture).
    const [w, h] = gridSize(16 / 9)
    const bumps = [
      [0.86, 0.89, 0.29],
      [0.64, 0.25, 0.17],
      [0.41, 0.77, 0.27],
    ] as const
    const lightness = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = bumps.reduce((a, [amount, at, size]) => a + amount * Math.exp(-(((y / (h - 1) - at) / size) ** 2)), 0.23 + 0.04 * Math.sin((x / w) * Math.PI * 2))
        lightness[y * w + x] = Math.min(0.95, Math.max(0.05, v))
      }
    const full = lightness.map(() => 1)
    const grid: StageGrid = { width: w, height: h, lightness, coverage: full, softCoverage: full, peak: lightness, seen: lightness }
    const pack = getPack('elemental')
    const way = (shares: readonly number[]) => {
      const colors = stageColors(pack, { shares }, true)
      const fields = colors.map(() => new Float32Array(w * h))
      const mid = middles(carriedShares(grid, colors, fields, 5, { kind: 'grain', axis: [0, 1] }), grid)
      return Math.sign(mid[colors.findIndex((c) => c.hex === '#B8996E')] - mid[colors.findIndex((c) => c.hex === '#4A0A3C')])
    }
    const atDefault = way(defaultMix(pack).shares)
    const tan = pack.colors.findIndex((c) => c.name === 'Tan')
    for (let share = 0.02; share <= 0.5001; share += 0.02) expect(way(setShare(pack, defaultMix(pack), tan, share).shares), `Tan ${share.toFixed(2)}`).toBe(atDefault)
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

/** Sunrise's place along the bands for a drag from the top down: 0 at the top row, 1 at the bottom, tilted by `tilt` across the frame. */
function placeDown(grid: StageGrid, tilt = 0): Float32Array {
  const { width: w, height: h } = grid
  return Float32Array.from({ length: w * h }, (_, i) => (Math.floor(i / w) + 0.5) / h + tilt * ((i % w) / w - 0.5))
}

/** Whether the pack's brighter end of the hue order comes first, from the default mix's colors. */
function brightFirstOf(pack: PackId): boolean {
  const colors = stageColors(getPack(pack), defaultMix(getPack(pack)), true)
  return brightEndFirst([...colors].sort((a, b) => a.packIndex - b.packIndex).map((c) => c.lightness))
}

describe('bandShares', () => {
  it("puts the pack's bright end at the drag's start in every pack and mix, so the order never turns round (owner, 2026-11-11 7:07 PM)", () => {
    const grid = skyFromTop(0.05)
    for (const id of ['bold', 'elemental', 'atmospheric'] as PackId[]) {
      const pack = getPack(id)
      for (const mix of [defaultMix(pack), setShare(pack, defaultMix(pack), 0, 0), setShare(pack, defaultMix(pack), 2, 0.5)]) {
        const colors = stageColors(pack, mix, true)
        const mid = middles(bandShares(grid, colors, placeDown(grid), brightFirstOf(id)), grid)
        const on = colors.map((_, k) => k).filter((k) => colors[k].share > 0.02)
        const order = [...on].sort((a, b) => colors[a].packIndex - colors[b].packIndex)
        if (!brightFirstOf(id)) order.reverse()
        for (let j = 1; j < order.length; j++) expect(mid[order[j]]).toBeGreaterThan(mid[order[j - 1]])
      }
    }
    expect(brightFirstOf('bold')).toBe(false)
    expect(brightFirstOf('elemental')).toBe(true)
    expect(brightFirstOf('atmospheric')).toBe(true)
  })

  it('keeps the order and moves colors only a little as the drag turns a few pixels', () => {
    const grid = skyFromTop(0.05)
    const colors = stageColors(getPack('bold'), defaultMix(getPack('bold')), true)
    let last: number[] | null = null
    for (let t = -0.03; t <= 0.0301; t += 0.005) {
      const mid = middles(bandShares(grid, colors, placeDown(grid, t), false), grid)
      if (last) mid.forEach((m, k) => expect(Math.abs(m - (last as number[])[k])).toBeLessThan(0.02))
      last = mid
    }
  })

  it('covers each color its share of the colored area, Meta Blue with its lead', () => {
    const [w, h] = gridSize(16 / 9)
    const lightness = new Float32Array(w * h).fill(0.6)
    const full = lightness.map(() => 1)
    const grid: StageGrid = { width: w, height: h, lightness, coverage: full, softCoverage: full, peak: lightness, seen: lightness }
    for (const id of ['bold', 'elemental', 'atmospheric'] as PackId[]) {
      const colors = stageColors(getPack(id), defaultMix(getPack(id)), true)
      const shares = bandShares(grid, colors, placeDown(grid, 0.1), brightFirstOf(id))
      colors.forEach((c, k) => {
        const got = shares[k].reduce((a, b) => a + b, 0) / (w * h)
        expect(Math.abs(got - (c.hex === '#0064E0' ? c.share + 0.05 : (c.share * 0.45) / 0.5))).toBeLessThan(0.01)
      })
    }
  })

  it('moves colors only a little as a slider moves in small steps', () => {
    const grid = skyFromTop(0.05)
    const pack = getPack('bold')
    let last: Float32Array[] | null = null
    for (let s = 0.04; s <= 0.4001; s += 0.01) {
      const shares = bandShares(grid, stageColors(pack, setShare(pack, defaultMix(pack), 2, s), true), placeDown(grid), false)
      if (last) {
        const before = last
        shares.forEach((sh, k) => {
          let total = 0
          let moved = 0
          sh.forEach((v, i) => {
            total += v - before[k][i]
            moved += Math.abs(v - before[k][i])
          })
          expect(Math.abs(total) / sh.length).toBeLessThan(0.02)
          expect(moved / sh.length).toBeLessThan(0.02)
        })
      }
      last = shares
    }
  })

  it("gives the dim ground by the light to the order's dark end, and keeps the bands where it is bright behind the light", () => {
    const [w, h] = gridSize(16 / 9)
    const rows = (light: (y: number) => number): StageGrid => {
      const lightness = Float32Array.from({ length: w * h }, (_, i) => light(Math.floor(i / w)))
      const full = lightness.map(() => 1)
      return { width: w, height: h, lightness, coverage: full, softCoverage: full, peak: lightness, seen: lightness }
    }
    // The light at the top, the top quarter behind it.
    const place = Float32Array.from({ length: w * h }, (_, i) => (Math.floor(i / w) + 0.5) / h - 0.25)
    const colors = stageColors(getPack('bold'), defaultMix(getPack('bold')), true)
    const blue = colors.findIndex((c) => c.hex === '#0064E0')
    const red = colors.findIndex((c) => c.hex === '#FF4F00')
    const dim = bandShares(rows((y) => (y < h / 4 ? 0.12 : 0.8)), colors, place, false)
    const bright = bandShares(rows(() => 0.8), colors, place, false)
    for (let x = 0; x < w; x++) {
      expect(dim[blue][w + x]).toBeGreaterThan(0.95)
      expect(bright[red][w + x]).toBeGreaterThan(0.9)
    }
  })

  it('gives a small dark end (Plum) at most a little more than its share from a large dim ground', () => {
    const [w, h] = gridSize(16 / 9)
    const lightness = Float32Array.from({ length: w * h }, (_, i) => (Math.floor(i / w) < h / 2 ? 0.2 + 0.1 * ((i % w) / w) : 0.8))
    const full = lightness.map(() => 1)
    const grid: StageGrid = { width: w, height: h, lightness, coverage: full, softCoverage: full, peak: lightness, seen: lightness }
    const place = Float32Array.from({ length: w * h }, (_, i) => (Math.floor(i / w) + 0.5) / h - 0.5)
    const pack = getPack('elemental')
    const colors = stageColors(pack, defaultMix(pack), true)
    const plum = colors.findIndex((c) => c.hex === '#4A0A3C')
    const shares = bandShares(grid, colors, place, brightFirstOf('elemental'))
    const got = shares[plum].reduce((a, b) => a + b, 0) / (w * h)
    expect(got).toBeLessThan(colors[plum].share * 1.25)
  })
})
