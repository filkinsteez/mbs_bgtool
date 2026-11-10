import { describe, expect, it } from 'vitest'
import { getPack } from '../../color/packs'
import type { ControlValues, ParamValue } from '../../scene'
import { rushColors } from './colors'
import { rushParts } from './parts'
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
// Streaks that are parts for the color stage: all but the seams (place -2).
const streaksOf = (params: Record<string, ParamValue>) =>
  (params.lf as number[]).filter((place, i) => i % 4 === 3 && i < 4 * (params.lights as number) && place > -1.5).length

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

  it('dims each color through darker colors of its own pack, and keeps Meta Blue and Tan as they are', () => {
    // Color k's dim path: per step, the step color's RGB at luminance 1 and the level where it takes over.
    const steps = (hexes: string[], k: number) => {
      const ramp = rushColors(hexes).ramp.slice(12 * k, 12 * k + 12)
      return [0, 1, 2].map((j) => ramp.slice(4 * j, 4 * j + 4)).filter((s) => s[3] > 0)
    }
    const bold = hexesOf('bold')
    expect(steps(bold, 0)).toHaveLength(0)
    expect(steps(bold, 1)).toHaveLength(1)
    expect(steps(bold, 2)).toHaveLength(2)
    expect(steps(bold, 3)).toHaveLength(1)
    // Yellow's first step is Orange-red's hue (red over green), Cyan's is Meta Blue's (blue over green).
    expect(steps(bold, 2)[0][0]).toBeGreaterThan(steps(bold, 2)[0][1] * 5)
    expect(steps(bold, 1)[0][2]).toBeGreaterThan(steps(bold, 1)[0][1] * 3)
    const elemental = hexesOf('elemental')
    expect(steps(elemental, 0)).toHaveLength(0)
    expect(steps(elemental, 1)).toHaveLength(1)
    expect(steps(elemental, 2)).toHaveLength(0)
    expect(steps(hexesOf('atmospheric'), 1)).toHaveLength(3)
  })

  it('puts each streak in its own group of parts, lead streaks first', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const { params } = composeRushSplit(hexesOf('bold'), CONTROLS, seed, 16 / 9)
      const parts = rushParts(params, 16 / 9)
      const groups = [...new Set(parts.map((p) => (p.kind === 'horizon' ? -1 : p.group)))].sort((a, b) => (a ?? 0) - (b ?? 0))
      expect(groups).toEqual([...Array(streaksOf(params)).keys()])
      const lf = params.lf as number[]
      const first = parts.findIndex((p) => p.kind !== 'horizon' && p.group === 0)
      const place = lf[4 * Math.floor(first / 7) + 3]
      expect(place >= 0 && place < 0.5, `s${seed}`).toBe(true)
    }
  })

  it('gives the color stage each streak as line pieces and its hot core as a spot, its angle in degrees', () => {
    for (const seed of SEEDS)
      for (const aspect of ASPECTS)
        for (const drag of LINES) {
          const { params } = composeRushSplit(hexesOf('bold'), { ...CONTROLS, drag }, seed, aspect)
          const parts = rushParts(params, aspect)
          const streaks = streaksOf(params)
          expect(parts.filter((p) => p.kind === 'line')).toHaveLength(6 * streaks)
          expect(parts.filter((p) => p.kind === 'spot')).toHaveLength(streaks)
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
})
