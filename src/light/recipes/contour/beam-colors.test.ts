import { describe, expect, it } from 'vitest'
import { linearToOklch } from '../../color/oklab'
import { type ColorPack, getPack, PACKS, type PackId } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import type { ControlValues, ParamValue, RecipeDefinition } from '../../scene'
import { contourBeam } from './beam'
import { contourColors, contourLightOptions, darkMatches, luminanceOf } from './beam-compose'
import { contourStreaks } from './streaks'

const hexes = (pack: ColorPack) => pack.colors.map((c) => c.hex)
const NAMES = new Map(PACKS.flatMap((p) => p.colors.map((c) => [c.hex, c.name] as const)))
const named = (hex: string) => NAMES.get(hex) ?? hex

/** Every list of at least two of a pack's colors, in pack order. */
function subsets(pack: ColorPack): string[][] {
  const all = hexes(pack)
  const lists: string[][] = []
  for (let mask = 0; mask < 1 << all.length; mask++) {
    const list = all.filter((_, i) => mask & (1 << i))
    if (list.length >= 2) lists.push(list)
  }
  return lists
}

describe('contourLightOptions', () => {
  it("gives each pack the lights it had: the light, the haze and the base", () => {
    const options = (id: PackId) => contourLightOptions(hexes(getPack(id))).map((o) => [o.light, o.haze, o.base].map(named))
    expect(options('bold')).toEqual([
      ['Cyan', 'Cyan', 'Meta Blue'],
      ['Cyan', 'Meta Blue', '#000000'],
      ['Yellow', 'Yellow', '#000000'],
      ['Orange-red', 'Orange-red', '#000000'],
    ])
    expect(options('elemental')).toEqual([
      ['Meta Blue', 'Meta Blue', 'Plum'],
      ['Lime', 'Lime', 'Forest'],
      ['Tan', 'Tan', '#000000'],
    ])
    expect(options('atmospheric')).toEqual([
      ['Ice', 'Steel', 'Near-black'],
      ['Ice', 'Meta Blue', 'Near-black'],
      ['Meta Blue', 'Meta Blue', 'Near-black'],
    ])
  })

  it('gives the same lights whatever the order of the list', () => {
    for (const pack of PACKS) {
      const list = hexes(pack)
      expect(contourLightOptions([...list].reverse())).toEqual(contourLightOptions(list))
      expect(contourLightOptions([...list.slice(2), ...list.slice(0, 2)])).toEqual(contourLightOptions(list))
    }
  })

  it('fills every role from any 2 to 5 colors of a pack, with or without Meta Blue', () => {
    for (const pack of PACKS) {
      for (const list of subsets(pack)) {
        const options = contourLightOptions(list)
        expect(options.length, list.map(named).join(', ')).toBeGreaterThan(0)
        for (const o of options) {
          for (const hex of [o.light, o.haze]) expect(list, list.map(named).join(', ')).toContain(hex)
          if (o.base !== '#000000') expect(list).toContain(o.base)
          // A warm light only stands over a dark of about its own hue (Lime over Forest), or black.
          if (o.tail) expect(darkMatches(o), `${named(o.haze)} over ${named(o.base)}`).toBe(true)
        }
        // Every color light enough to light a frame, but a grey as pale as Ice, is the haze of one of them.
        const leads = list.filter((hex) => {
          const [L, C] = linearToOklch(hexToLinear(hex))
          return L >= 0.5 && !(C < 0.04 && L > 0.9)
        })
        for (const hex of leads) expect(options.map((o) => o.haze), named(hex)).toContain(hex)
      }
    }
  })

  it('keeps the darks as dark whatever their color', () => {
    const levels = PACKS.flatMap((pack) => subsets(pack).flatMap((list) => contourLightOptions(list)))
      .filter((o) => o.base !== '#000000')
      .map((o) => o.baseLevel * luminanceOf(o.base))
    expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(1.01)
  })
})

describe('contourColors', () => {
  it("shows every one of a list's lights in seeds 1 to 8", () => {
    for (const pack of PACKS) {
      for (const list of subsets(pack)) {
        const hazes = new Set(Array.from({ length: 8 }, (_, i) => contourColors(list, i + 1).haze))
        expect(hazes.size, list.map(named).join(', ')).toBe(new Set(contourLightOptions(list).map((o) => o.haze)).size)
      }
    }
  })
})

/**
 * The params of each look that carry only how bright or what color the light is (by key: every
 * entry, or the listed ones). Everything else is the layout: where the light is, its shape and
 * size, and where the haze, the floor and the shadows lie.
 */
const TONE: Record<string, Record<string, 'all' | number[]>> = {
  'contour.beam': {
    power: 'all',
    pool: [0, 1],
    bounce: [0],
    gloss: [0],
    floorHaze: [0],
    ceiling: [0],
    pale: 'all',
    paleWhite: 'all',
    tail: 'all',
    tailEnd: 'all',
    fall: 'all',
    ambient: 'all',
    veil: 'all',
    veilBand: 'all',
    veilTint: 'all',
    beamHaze: 'all',
    mouth: [0],
    airGlow: [0],
  },
  'contour.streaks': {
    skyLevel: [0, 1],
    glow: [1],
    line: [0],
    band: [0],
    floor: [1],
    downPool: [3],
    pale: 'all',
    paleWhite: 'all',
    tail: 'all',
    tailEnd: 'all',
    fall: 'all',
    base: 'all',
    veil: 'all',
    veilBand: 'all',
    veilTint: 'all',
    darkMeet: 'all',
    airGlow: [0],
  },
}

/** A scene's layout: its params without the tone (TONE). */
function layoutOf(recipe: RecipeDefinition, params: Record<string, ParamValue>): Record<string, ParamValue> {
  const tone = TONE[recipe.id]
  const layout: Record<string, ParamValue> = {}
  for (const [key, value] of Object.entries(params)) {
    const skip = tone[key]
    if (skip === 'all') continue
    layout[key] = Array.isArray(value) && skip ? value.map((v, i) => (skip.includes(i) ? 0 : v)) : value
  }
  return layout
}

const VIEWS: (ControlValues['drag'] | undefined)[] = [
  undefined,
  { from: [1.011, 1.224], to: [-0.078, -0.067] },
  { from: [-0.011, 1.224], to: [1.078, -0.067] },
  { from: [0.5, -0.3], to: [0.5, -0.5] },
  { from: [0.9, 0.5], to: [0.1, 0.5] },
  { from: [0.5, -0.3], to: [0.5, 0.5] },
]

describe('Beam and Streaks', () => {
  it('lay out a seed the same in every pack and with Meta Blue left out: only the colors change', () => {
    const lists: ColorPack[] = PACKS.flatMap((pack) => [pack, { ...pack, colors: pack.colors.filter((c) => c.name !== 'Meta Blue') }])
    for (const recipe of [contourBeam, contourStreaks]) {
      for (let seed = 1; seed <= 40; seed++) {
        for (const aspect of [16 / 9, 9 / 16]) {
          for (const drag of VIEWS) {
            const controls = { intensity: 0.5, softness: 0.5, mood: 0.5, ...(drag ? { drag } : {}) }
            const [first, ...rest] = lists.map((pack) => layoutOf(recipe, recipe.compose!({ pack, controls, seed, aspect }).params))
            for (const [i, layout] of rest.entries()) expect(layout, `${recipe.id} s${seed} ${aspect} ${drag?.from ?? 'default'} ${lists[i + 1].id}`).toEqual(first)
          }
        }
      }
    }
  })
})
