import { describe, expect, it } from 'vitest'
import { getPack } from '../../color/packs'
import type { ControlValues, ParamValue } from '../../scene'
import { rushColors } from './colors'
import { rushAcross, rushAcrossAt, rushParts } from './parts'
import { composeRush, composeRushSplit } from './split-compose'

const CONTROLS = { intensity: 0.5, softness: 0.5, mood: 0.5 }
const PACKS = ['bold', 'elemental', 'atmospheric'].map((id) => getPack(id as 'bold'))
const hexesOf = (id: 'bold' | 'elemental' | 'atmospheric') => getPack(id).colors.map((c) => c.hex)
const LISTS = [...PACKS.map((pack) => pack.colors.map((c) => c.hex)), hexesOf('bold').slice(1), hexesOf('elemental').slice(1)]
const ASPECTS = [16 / 9, 9 / 16]
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1)
const LINES: ControlValues['drag'][] = [
  undefined,
  { from: [1.011, 1.224], to: [-0.078, -0.067] },
  { from: [0.5, -0.3], to: [0.5, -0.5] },
  { from: [0.9, 0.5], to: [0.1, 0.5] },
]

// The params the colors set: which color each streak takes (every fourth number of `le`, and of `lg` for a seam's
// second side), a white streak's edge colors and levels, each color's dim path, how many colors there are and how lit
// the ground is.
const COLOR_KEYS = new Set(['spectrum', 'fringe', 'ramp', 'comps', 'groundLevel'])
const designOf = (params: Record<string, ParamValue>) =>
  Object.fromEntries(
    Object.entries(params)
      .filter(([key]) => !COLOR_KEYS.has(key))
      .map(([key, value]) => [key, (key === 'le' || key === 'lg') && Array.isArray(value) ? value.filter((_, i) => i % 4 !== 3) : value]),
  )
// Streaks with a core spot for the color stage: all but the bridges (place -2), which are line pieces only.
const streaksOf = (params: Record<string, ParamValue>) =>
  (params.lf as number[]).filter((place, i) => i % 4 === 3 && i < 4 * (params.lights as number) && place > -1.5).length
// Colored streaks (not white, not a bridge) with a side facing darkness (lg's fourth number: 1 the low side, 2 the
// high side), each such side adding dim flank parts that ask for a dark color: [streak, sides].
const darkSidesOf = (params: Record<string, ParamValue>) =>
  (params.lf as number[]).flatMap((place, i) => {
    if (i % 4 !== 3 || i >= 4 * (params.lights as number) || place < 0) return []
    const steep = (params.lg as number[])[i]
    const sides = (steep % 2 >= 1 ? 1 : 0) + (steep >= 2 ? 1 : 0)
    return sides > 0 ? [[(i - 3) / 4, sides]] : []
  })

describe('Rush split', () => {
  it("uses only the pack's own colors, and black for no light", () => {
    for (const pack of PACKS)
      for (const seed of SEEDS)
        for (const aspect of ASPECTS) {
          const { colors } = composeRush({ pack, controls: CONTROLS, seed, aspect })
          for (const hex of colors) expect(hex === '#000000' || pack.colors.some((c) => c.hex.toUpperCase() === hex.toUpperCase()), `${pack.id} s${seed} ${hex}`).toBe(true)
        }
  })

  it('draws the same design in every pack and color list, with and without a line', () => {
    for (const seed of SEEDS)
      for (const aspect of ASPECTS)
        for (const drag of LINES) {
          const designs = LISTS.map((hexes) => designOf(composeRushSplit(hexes, { ...CONTROLS, drag }, seed, aspect).params))
          for (const design of designs) expect(design).toEqual(designs[0])
        }
  })

  it('keeps its streaks while the line moves: a line never adds or drops one', () => {
    for (const seed of SEEDS)
      for (const aspect of ASPECTS) {
        const own = composeRushSplit(hexesOf('bold'), CONTROLS, seed, aspect).params.lights
        for (let k = 0; k <= 20; k++) {
          const drag = { from: [-0.3 + 0.08 * k, 0.7] as [number, number], to: [0.5, 0.2 - 0.03 * k] as [number, number] }
          expect(composeRushSplit(hexesOf('bold'), { ...CONTROLS, drag }, seed, aspect).params.lights, `s${seed} step ${k}`).toBe(own)
        }
      }
  })

  it("gives a white streak's edges the cool and warm streaks' colors, and puts the others only in its middle", () => {
    expect(rushColors(hexesOf('bold')).spectrum).toEqual([0.5, 0, 1, 0.5])
    // Lime and Ice take both the cool and the warm streaks, so the other edge takes the deep streaks' Tan and Steel.
    expect(rushColors(hexesOf('elemental')).spectrum.slice(0, 3)).toEqual([0.5, 0, 1])
    expect(rushColors(hexesOf('atmospheric')).spectrum.slice(0, 3)).toEqual([0.5, 0, 1])
  })

  it("dims each color along the engine's dim path through darker colors of its own pack, and keeps Meta Blue as it is", () => {
    // Color k's dim path: per step, the step color's RGB at luminance 1 and the level where it takes over.
    const steps = (hexes: string[], k: number) => {
      const ramp = rushColors(hexes).ramp.slice(12 * k, 12 * k + 12)
      return [0, 1, 2].map((j) => ramp.slice(4 * j, 4 * j + 4)).filter((s) => s[3] > 0)
    }
    const bold = hexesOf('bold')
    expect(steps(bold, 0)).toHaveLength(0)
    for (const k of [1, 2, 3]) expect(steps(bold, k)).toHaveLength(3)
    // Yellow's last step is fire's deep red (red over green), Cyan's is Meta Blue's hue (blue over green).
    expect(steps(bold, 2)[2][0]).toBeGreaterThan(steps(bold, 2)[2][1] * 5)
    expect(steps(bold, 1)[2][2]).toBeGreaterThan(steps(bold, 1)[2][1] * 3)
    const elemental = hexesOf('elemental')
    expect(steps(elemental, 0)).toHaveLength(0)
    expect(steps(elemental, 1)).toHaveLength(3)
    expect(steps(elemental, 2)).toHaveLength(3)
    // Lime turns greener at each step instead of olive, and Tan's last step is Forest's hue (green and blue over red).
    const lime = steps(elemental, 1)
    for (let j = 1; j < 3; j++) expect(lime[j][1] / lime[j][0]).toBeGreaterThan(lime[j - 1][1] / lime[j - 1][0])
    const tan = steps(elemental, 2)[2]
    expect(tan[1]).toBeGreaterThan(tan[0])
    expect(tan[2]).toBeGreaterThan(tan[0])
    expect(steps(hexesOf('atmospheric'), 1)).toHaveLength(3)
  })

  it('puts each streak in its own group of parts, lead streaks first, and its dim flanks in a dark group after them', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const { params } = composeRushSplit(hexesOf('bold'), CONTROLS, seed, 16 / 9)
      const parts = rushParts(params, 16 / 9)
      const lights = params.lights as number
      const groups = [...new Set(parts.map((p) => (p.kind === 'horizon' ? -1 : p.group)))].sort((a, b) => (a ?? 0) - (b ?? 0))
      expect(groups).toEqual([...Array(lights).keys(), ...darkSidesOf(params).map(([i]) => lights + i)])
      // A lead streak's parts ask for nothing (the stage gives the first group the lead color).
      const lightParts = parts.flatMap((p) => (p.kind === 'horizon' ? [] : [p]))
      expect(lightParts.filter((p) => p.group === 0).every((p) => p.want === undefined), `s${seed}`).toBe(true)
      expect(lightParts.filter((p) => (p.group ?? 0) >= lights).every((p) => p.want === 'dark')).toBe(true)
    }
  })

  it('gives the color stage each streak as line pieces and its hot core as a spot, its angle in degrees', () => {
    for (const seed of SEEDS)
      for (const aspect of ASPECTS)
        for (const drag of LINES) {
          const { params } = composeRushSplit(hexesOf('bold'), { ...CONTROLS, drag }, seed, aspect)
          const parts = rushParts(params, aspect)
          expect(parts.filter((p) => p.kind === 'line')).toHaveLength(6 * (params.lights as number) + 6 * darkSidesOf(params).reduce((n, [, sides]) => n + sides, 0))
          expect(parts.filter((p) => p.kind === 'spot')).toHaveLength(streaksOf(params))
          for (const part of parts) {
            if (part.kind === 'line') {
              expect([...part.from, ...part.to, part.width].every(Number.isFinite)).toBe(true)
              expect(part.width).toBeGreaterThan(0)
            } else if (part.kind === 'spot') {
              expect([...part.at, part.radius].every(Number.isFinite)).toBe(true)
              expect(Math.abs(part.angle ?? 0)).toBeLessThanOrEqual(180)
            }
          }
        }
  })

  // The owner's purple-bleed line (Elemental s2, 2026-11-11 8:17 AM) and the test lines.
  const ACROSS_LINES: ControlValues['drag'][] = [...LINES, { from: [0.85, 0.5], to: [0.85, 0.9] }]

  it('gives the color stage a place across the flow that crosses each streak at right angles on average', () => {
    // At the middle of each streak piece the stage's parts give (the streak's middle without the stack's warp and the
    // streak's wander), the place's gradient against the piece's direction: |cos| near 0 is a right angle.
    const cosines: number[] = []
    for (const seed of SEEDS)
      for (const aspect of ASPECTS)
        for (const drag of ACROSS_LINES) {
          const { params } = composeRushSplit(hexesOf('bold'), { ...CONTROLS, drag }, seed, aspect)
          const at = rushAcrossAt(params, aspect, seed)
          expect(at).not.toBeNull()
          if (!at) continue
          const [fw, fh] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
          const e = 0.002
          for (const part of rushParts(params, aspect)) {
            if (part.kind !== 'line' || part.want === 'dark') continue
            const [x, y] = [(part.from[0] + part.to[0]) / 2, (part.from[1] + part.to[1]) / 2]
            if (x < 0.05 || x > 0.95 || y < 0.05 || y > 0.95) continue
            const gx = (at(x + e / fw, y).place - at(x - e / fw, y).place) / (2 * e)
            const gy = (at(x, y + e / fh).place - at(x, y - e / fh).place) / (2 * e)
            const dx = (part.to[0] - part.from[0]) * fw
            const dy = (part.to[1] - part.from[1]) * fh
            const g = Math.hypot(gx, gy)
            const d = Math.hypot(dx, dy)
            if (g > 1e-6 && d > 1e-6) cosines.push(Math.abs(gx * dx + gy * dy) / (g * d))
          }
        }
    const mean = cosines.reduce((a, b) => a + b, 0) / cosines.length
    expect(cosines.length).toBeGreaterThan(1000)
    expect(mean).toBeLessThan(0.1)
  })

  it('keeps the place across the flow under a few pixels of drag and under any mix, so colors laid on it cannot flip', () => {
    const grid = (aspect: number) => (aspect >= 1 ? [32, 18] : [18, 32])
    // The stage lays colors by area along the place, so what counts is each cell's rank in the place (0 at the lowest
    // cell, 1 at the highest) and whether the place keeps its direction (correlation with the frame before).
    const ranks = (a: Float32Array) => {
      const order = Array.from(a.keys()).sort((i, j) => a[i] - a[j])
      const r = new Float32Array(a.length)
      order.forEach((i, k) => (r[i] = k / (a.length - 1)))
      return r
    }
    const correlation = (a: Float32Array, b: Float32Array) => {
      const ma = a.reduce((s, v) => s + v, 0) / a.length
      const mb = b.reduce((s, v) => s + v, 0) / b.length
      let ab = 0
      let aa = 0
      let bb = 0
      for (let i = 0; i < a.length; i++) {
        ab += (a[i] - ma) * (b[i] - mb)
        aa += (a[i] - ma) ** 2
        bb += (b[i] - mb) ** 2
      }
      return ab / Math.sqrt(aa * bb)
    }
    let worstRank = 0
    let worstCorrelation = 1
    for (const seed of SEEDS.slice(0, 12))
      for (const aspect of ASPECTS)
        for (const line of ACROSS_LINES.slice(1)) {
          if (!line) continue
          const [w, h] = grid(aspect)
          const placeOf = (drag: ControlValues['drag']) => rushAcross(composeRushSplit(hexesOf('bold'), { ...CONTROLS, drag }, seed, aspect).params, aspect, seed, w, h).place
          // The line's end and the whole line moved by steps of 0.004 of the frame's width (about 2 preview pixels).
          const moves = [
            (k: number) => ({ from: line.from, to: [line.to[0] + 0.004 * k, line.to[1]] as [number, number] }),
            (k: number) => ({ from: [line.from[0] + 0.004 * k, line.from[1]] as [number, number], to: [line.to[0] + 0.004 * k, line.to[1]] as [number, number] }),
          ]
          for (const move of moves) {
            let before = placeOf(move(0))
            for (let k = 1; k <= 3; k++) {
              const after = placeOf(move(k))
              const [ra, rb] = [ranks(after), ranks(before)]
              for (let i = 0; i < after.length; i++) worstRank = Math.max(worstRank, Math.abs(ra[i] - rb[i]))
              worstCorrelation = Math.min(worstCorrelation, correlation(after, before))
              before = after
            }
          }
        }
    expect(worstRank).toBeLessThan(0.08)
    expect(worstCorrelation).toBeGreaterThan(0.995)
    // The mix and the pack never reach the place: every color list gives the same one.
    for (const seed of SEEDS.slice(0, 6))
      for (const aspect of ASPECTS)
        for (const drag of ACROSS_LINES) {
          const places = LISTS.map((hexes) => Array.from(rushAcross(composeRushSplit(hexes, { ...CONTROLS, drag }, seed, aspect).params, aspect, seed, 16, 9).place))
          for (const place of places) expect(place).toEqual(places[0])
        }
  })

  it('gives the place across the flow and along it on the stage grid, finite and spanning the stack', () => {
    for (const seed of SEEDS)
      for (const aspect of ASPECTS)
        for (const drag of ACROSS_LINES) {
          const { params } = composeRushSplit(hexesOf('bold'), { ...CONTROLS, drag }, seed, aspect)
          const { place, along } = rushAcross(params, aspect, seed, 16, 9)
          expect([...place, ...along].every(Number.isFinite)).toBe(true)
          expect(Math.max(...place) - Math.min(...place)).toBeGreaterThan(0.2)
        }
  })
})
