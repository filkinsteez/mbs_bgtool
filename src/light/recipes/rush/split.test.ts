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

// The params the colors set: which color each streak takes (every fourth number of `le`), a white streak's color
// places and levels, how each color turns as it dims, how many colors there are and how lit the ground is.
const COLOR_KEYS = new Set(['spectrum', 'fringe', 'dim', 'comps', 'groundLevel'])
const designOf = (params: Record<string, ParamValue>) =>
  Object.fromEntries(
    Object.entries(params)
      .filter(([key]) => !COLOR_KEYS.has(key))
      .map(([key, value]) => [key, key === 'le' && Array.isArray(value) ? value.filter((_, i) => i % 4 !== 3) : value]),
  )

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

  it("spreads a white streak's colors across it in list order, with Tan, which reads brown when dim, only in its middle", () => {
    expect(rushColors(hexesOf('bold')).spectrum).toEqual([0, 0.3333, 0.6667, 1])
    expect(rushColors(hexesOf('elemental')).spectrum.slice(0, 3)).toEqual([0, 1, 0.5])
    expect(rushColors(hexesOf('atmospheric')).spectrum.slice(0, 3)).toEqual([0, 0.5, 1])
  })

  it('gives the color stage each streak as line pieces and its hot core as a spot, its angle in degrees', () => {
    for (const seed of SEEDS)
      for (const aspect of ASPECTS)
        for (const drag of LINES) {
          const { params } = composeRushSplit(hexesOf('bold'), { ...CONTROLS, drag }, seed, aspect)
          const parts = rushParts(params, aspect)
          const lights = params.lights as number
          expect(parts.filter((p) => p.kind === 'line')).toHaveLength(6 * lights)
          expect(parts.filter((p) => p.kind === 'spot')).toHaveLength(lights)
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
