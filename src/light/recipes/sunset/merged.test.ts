import { describe, expect, it } from 'vitest'
import { defaultMix, setMetaBlue } from '../../color/mix'
import { getPack } from '../../color/packs'
import { composeMerged, mergedParts } from './merged'

const CONTROLS = { intensity: 0.5, softness: 0.7, mood: 0.5 }
const PACKS = ['bold', 'elemental', 'atmospheric'].map((id) => getPack(id as 'bold'))
const ASPECTS = [16 / 9, 9 / 16]
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1)
const OWNER_LINE = { from: [1.011, 1.224] as [number, number], to: [-0.078, -0.067] as [number, number] }

// Everything in the params but how far each part's color may dim, which comes from the colors.
const designOf = (params: Record<string, unknown>) => Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'lowest' && key !== 'broadOn'))

describe('merged Sunrise', () => {
  it("uses only the pack's own colors, and black for no light", () => {
    for (const pack of PACKS)
      for (const seed of SEEDS)
        for (const aspect of ASPECTS) {
          const { colors } = composeMerged({ pack, controls: CONTROLS, seed, aspect })
          for (const hex of colors) expect(hex === '#000000' || pack.colors.some((c) => c.hex.toUpperCase() === hex.toUpperCase()), `${pack.id} s${seed} ${hex}`).toBe(true)
        }
  })

  it('draws the same design in every pack and mix, with and without a line', () => {
    for (const seed of SEEDS)
      for (const aspect of ASPECTS)
        for (const drag of [undefined, OWNER_LINE]) {
          const designs = PACKS.flatMap((pack) =>
            [defaultMix(pack), setMetaBlue(pack, defaultMix(pack), false)].map((mix) =>
              designOf(composeMerged({ pack, controls: { ...CONTROLS, drag }, seed, aspect, mix: mix.shares }).params),
            ),
          )
          for (const design of designs) expect(design).toEqual(designs[0])
        }
  })

  it('keeps the light in the frame or at its edge, also when a line starts outside the frame; no rings round a high light', () => {
    for (const seed of SEEDS)
      for (const aspect of ASPECTS)
        for (const drag of [undefined, OWNER_LINE]) {
          const { params } = composeMerged({ pack: PACKS[0], controls: { ...CONTROLS, drag }, seed, aspect })
          const parts = mergedParts(params, aspect)
          if (params.kind === 1) {
            const lights = parts.flatMap((part) => (part.kind === 'spot' && part.want !== 'dark' && part.want !== 'any' ? [part] : []))
            for (const one of lights)
              for (const other of lights)
                if (one.want !== other.want) expect(Math.hypot(one.at[0] - other.at[0], one.at[1] - other.at[1]), `s${seed}: ${one.want} and ${other.want} share a middle`).toBeGreaterThan(0.02)
          }
          if (params.kind === 3) continue
          const horizon = parts.find((part) => part.kind === 'horizon')
          if (horizon?.kind !== 'horizon' || !horizon.light) throw new Error('no light')
          for (const v of horizon.light) expect(v, `s${seed} ${aspect.toFixed(2)} ${drag ? 'line' : 'default'}`).toBeGreaterThanOrEqual(-0.06)
          for (const v of horizon.light) expect(v, `s${seed} ${aspect.toFixed(2)} ${drag ? 'line' : 'default'}`).toBeLessThanOrEqual(1.06)
        }
  })
})
