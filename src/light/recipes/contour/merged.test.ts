import { describe, expect, it } from 'vitest'
import { getPack, type PackId } from '../../color/packs'
import type { ControlValues, ParamValue } from '../../scene'
import { parseQuery, sceneLook, toQuery } from '../../../tool/state'
import { recipesForMood } from '../index'
import { outlinePieces } from './curveLight'
import { MERGED_LAYOUT } from './merged'
import { composeMerged, MERGED_SHAPES, mergedParts, mergedShape, seedWithShape, shapeOfSeed, startedShape } from './mergedCompose'
import { MERGED_SHAPE_KINDS } from './mergedShapes'

const hexes = (id: PackId) => getPack(id).colors.map((c) => c.hex)
const LISTS: string[][] = [
  hexes('bold'),
  hexes('elemental'),
  hexes('atmospheric'),
  hexes('bold').filter((h) => h !== '#0064E0'),
  [...hexes('elemental')].reverse(),
  hexes('atmospheric').slice(1),
  ['#FF4F00', '#FFD61E'],
]
const CONTROLS: ControlValues = { intensity: 0.5, softness: 0.7, mood: 0.5 }
const OWNER: ControlValues = { ...CONTROLS, drag: { from: [1.011, 1.224], to: [-0.078, -0.067] } }
/** Params that place the shape and the light and set its brightness and widths; the rest only say which color goes where. */
const isLayout = (key: string) =>
  !/^e\d/.test(key) && !['keySlot', 'groundNear', 'groundFar', 'air1Color', 'air2Color', 'air3Color', 'rayUnit', 'secondUnit'].includes(key)
const layoutOf = (params: Record<string, ParamValue>) => Object.fromEntries(Object.entries(params).filter(([key]) => isLayout(key)))

describe('contour.merged', () => {
  it('gives every color list the same layout at a seed, drag and format', () => {
    for (const aspect of [16 / 9, 9 / 16]) {
      for (const controls of [CONTROLS, OWNER]) {
        for (let seed = 1; seed <= 12; seed++) {
          const first = layoutOf(composeMerged({ colors: LISTS[0], controls, seed, aspect }).params)
          for (const colors of LISTS.slice(1)) expect(layoutOf(composeMerged({ colors, controls, seed, aspect }).params), `seed ${seed}`).toEqual(first)
        }
      }
    }
  })

  it('uses only the list colors and black', () => {
    for (const colors of LISTS) {
      for (let seed = 1; seed <= 9; seed++) {
        for (const hex of composeMerged({ colors, controls: CONTROLS, seed, aspect: 16 / 9 }).colors) expect(['#000000', ...colors]).toContain(hex)
      }
    }
  })

  it('fits every outline into its emitter, with stops only on the contour the light is on and fades at its tips', () => {
    for (const aspect of [16 / 9, 9 / 16]) {
      for (const controls of [CONTROLS, OWNER]) {
        for (let seed = 1; seed <= 27; seed++) {
          const { params } = composeMerged({ colors: LISTS[0], controls, seed, aspect })
          const at = params.at as number[]
          const [fw, fh] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
          const spec = {
            kind: MERGED_SHAPE_KINDS[Math.round(params.shape as number) - 1],
            size: params.size as number,
            radius: params.radius as number,
            rotate: params.rotate as number,
            flip: params.flip as boolean,
          }
          const shape = startedShape(mergedShape(spec, [(at[0] - 0.5) * fw, (at[1] - 0.5) * fh], aspect), params.starts as number[])
          const stops = Array.from({ length: 8 }, (_, k) => ({ t: 0.3 + 0.05 * k, color: [1, 1, 1], gain: 1 }))
          const tipContour = params.tipContour as number[]
          const fades = (params.tipAt as number[]).flatMap((t, i) => (t >= 0 ? [{ contour: tipContour[i], t, dark: params.tipDark as number, fade: params.tipFade as number }] : []))
          const pieces = outlinePieces({ shape, stops, stopContour: params.stopContour as number, restStops: [stops[0]], fades })
          expect(pieces.length, `seed ${seed}`).toBeLessThanOrEqual(MERGED_LAYOUT.primitives)
        }
      }
    }
  })

  it('lights the edge the light is on with the key color out to both ends', () => {
    const mixes: { colors: string[]; shares?: number[] }[] = [
      ...LISTS.map((colors) => ({ colors })),
      { colors: LISTS[0], shares: [0.1 / 3, 0.1 / 3, 0.1 / 3, 0.9] },
      { colors: LISTS[1], shares: [0.9, 0.025, 0.025, 0.025, 0.025] },
    ]
    for (const { colors, shares } of mixes) {
      for (const aspect of [16 / 9, 9 / 16]) {
        for (const controls of [CONTROLS, OWNER]) {
          for (let seed = 1; seed <= 27; seed++) {
            const { params } = composeMerged({ colors, shares, controls, seed, aspect })
            const keyUnit = [1, 2, 3].find((e) => params[`e${e}On`] && params[`e${e}Rest`] === params.keySlot)
            expect(keyUnit, `seed ${seed}`).toBeDefined()
            const slots = [...(params[`e${keyUnit}StopColor`] as number[]), ...(params[`e${keyUnit}StopColor2`] as number[])]
            const used = slots.slice(0, params[`e${keyUnit}Stops`] as number)
            expect([used[0], used.at(-1)], `seed ${seed} ${colors.join(',')}`).toEqual([params.keySlot, params.keySlot])
          }
        }
      }
    }
  })

  it('gives the color stage the second light, the dim room and the main light, and has a second light in every list', () => {
    for (const aspect of [16 / 9, 9 / 16]) {
      for (let seed = 1; seed <= 18; seed++) {
        const seconds = LISTS.map((colors) => composeMerged({ colors, controls: CONTROLS, seed, aspect }).params)
        const { params } = composeMerged({ colors: LISTS[0], controls: CONTROLS, seed, aspect })
        const parts = mergedParts(params, aspect)
        expect(parts.map((p) => (p.kind === 'horizon' ? 'horizon' : p.want)), `seed ${seed}`).toEqual(['warm', 'dark', 'cool'])
        for (const part of parts) expect(JSON.stringify(part)).not.toMatch(/null|NaN/)
        // The second light is part of the design: there in every list or in none, at the same place.
        expect(new Set(seconds.map((p) => Number(p.secondUnit) > 0)).size, `seed ${seed}`).toBe(1)
        expect(new Set(seconds.map((p) => JSON.stringify(p.secondAt))).size, `seed ${seed}`).toBe(1)
      }
    }
  })

  it('names its shapes and moves a seed to another shape keeping its place among that shape’s seeds', () => {
    expect(MERGED_SHAPES).toHaveLength(9)
    for (let seed = 1; seed <= 100; seed++) {
      for (let shape = 0; shape < MERGED_SHAPES.length; shape++) {
        const moved = seedWithShape(seed, shape)
        expect(moved).toBeGreaterThanOrEqual(1)
        expect(moved).toBeLessThanOrEqual(100)
        expect(shapeOfSeed(moved)).toBe(shape)
      }
    }
  })

  it('is not one of the looks a Contour seed picks', () => {
    expect(recipesForMood('contour').map((r) => r.id)).not.toContain('contour.merged')
  })

  it('shows in the tool only behind contour=merged in Contour, and keeps the switch in the link', () => {
    const on = parseQuery(new URLSearchParams('mood=contour&look=rim&pack=bold&contour=merged&seed=7&format=16x9'))
    expect(sceneLook(on)).toBe('contour.merged')
    expect(toQuery(on)).toBe('mood=contour&look=rim&pack=bold&contour=merged&seed=7&format=16x9')
    const off = parseQuery(new URLSearchParams('mood=contour&look=rim&pack=bold&seed=7&format=16x9'))
    expect(off).not.toHaveProperty('contour')
    expect(sceneLook(off)).toBe(off.look)
    const sunrise = parseQuery(new URLSearchParams('mood=sunset&look=bands&pack=bold&contour=merged&seed=7&format=16x9'))
    expect(sceneLook(sunrise)).toBe(sunrise.look)
    for (const value of ['1', 'Merged', 'rim', '']) expect(parseQuery({ contour: value }), value).not.toHaveProperty('contour')
  })
})
