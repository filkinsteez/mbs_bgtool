import { describe, expect, it } from 'vitest'
import { PACK_IDS, packHexes, type ColorPack } from '../../color/packs'
import { compositionProblems } from '../../compose'
import type { ParamValue } from '../../scene'
import { sunsetRamp } from './ramp'
import { composeRamp, rampRoles, rampStructure } from './ramp-compose'

const BOLD_WITHOUT_BLUE = ['#1FCDF0', '#FFD61E', '#FF4F00']
const LISTS: Record<string, string[]> = {
  ...Object.fromEntries(PACK_IDS.map((id) => [id, packHexes(id)])),
  boldWithoutBlue: BOLD_WITHOUT_BLUE,
}
const DRAGS = [
  undefined,
  { from: [1.011, 1.224], to: [-0.078, -0.067] },
  { from: [0.5, -0.3], to: [0.5, -0.5] },
  { from: [0.9, 0.5], to: [0.1, 0.5] },
  { from: [0.3, 0.8], to: [0.6, 0.2] },
] as const
/**
 * The params the colors fill: each role's gain on its own color, the light's path, how much a warm
 * low sky dims and is veiled, the veil's and bridges' tints, and the ground's gains. Every other
 * param is the design's.
 */
const COLOR_PARAMS = new Set([
  ...Array.from({ length: 8 }, (_, i) => `gain${i + 1}`),
  'sunGlow',
  'glowPath',
  'reddenDown',
  'reddenSide',
  'horizonDim',
  'veil',
  'veilTint',
  'veilMute',
  'veilMuteLow',
  'veilNear',
  'bandTint',
  'blueHue',
  'bridgeSky',
  'bridgeCool',
  'groundHaze',
  'groundVeil',
  'landLit',
  'groundTopGain',
  'groundBottomGain',
  'waterGain',
])

const layout = (params: Record<string, ParamValue>) => Object.fromEntries(Object.entries(params).filter(([key]) => !COLOR_PARAMS.has(key)))

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]))
}

describe('rampRoles', () => {
  it('fills the same roles whatever order the colors come in', () => {
    for (const colors of Object.values(LISTS)) {
      for (const light of ['deep', 'pale'] as const) {
        for (const darkTurn of [0, 1]) {
          const roles = rampRoles(colors, { light, darkTurn })
          for (const order of permutations(colors)) expect(rampRoles(order, { light, darkTurn })).toEqual(roles)
        }
      }
    }
  })

  it('fills every role from the list, with or without Meta Blue', () => {
    expect(rampRoles(BOLD_WITHOUT_BLUE, { light: 'deep', darkTurn: 0 })).toMatchObject({ zenith: '#1FCDF0', light: '#FF4F00', core: '#FFD61E' })
    for (const colors of [...Object.values(LISTS), ['#0064E0', '#FF4F00'], ['#F2F4F7', '#384753'], ['#D6F26C', '#4A0A3C'], ['#FFD61E', '#FF4F00']]) {
      for (const light of ['deep', 'pale'] as const) {
        for (const hex of Object.values(rampRoles(colors, { light, darkTurn: 1 }))) expect(colors).toContain(hex)
      }
    }
  })
})

describe('composeRamp across color lists', () => {
  it('gives the same design for every list at each seed, drag and format; only the colors differ', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const aspect of [16 / 9, 9 / 16]) {
        for (const drag of DRAGS) {
          const controls = { intensity: 0.5, softness: 0.5, mood: 0.5, drag }
          const designs = Object.entries(LISTS).map(([name, colors]) => [name, layout(composeRamp(colors, controls, seed, aspect).params)] as const)
          for (const [name, design] of designs.slice(1)) expect(design, `${name} against ${designs[0][0]}, seed ${seed} ${rampStructure(seed)}, ${aspect}, ${JSON.stringify(drag)}`).toEqual(designs[0][1])
        }
      }
    }
  })

  it('keeps every color and param in range for lists of 2 to 5 colors', () => {
    const lists = [...Object.values(LISTS), ['#0064E0', '#FF4F00'], ['#F2F4F7', '#6A7788', '#1C2B33'], ['#D6F26C', '#0F3D33', '#B8996E', '#4A0A3C']]
    for (const colors of lists) {
      const pack: ColorPack = { id: 'bold', name: 'list', tagline: '', colors: colors.map((hex) => ({ name: hex, hex })) }
      for (let seed = 1; seed <= 9; seed++) {
        for (const drag of DRAGS) {
          const composition = composeRamp(colors, { intensity: 0.5, softness: 0.5, mood: 0.5, drag }, seed, 16 / 9)
          expect(compositionProblems(sunsetRamp, pack, composition), `${colors} ${seed} ${JSON.stringify(drag)}`).toEqual([])
        }
      }
    }
  })
})
