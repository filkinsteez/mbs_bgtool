import { describe, expect, it } from 'vitest'
import { getPack, PACKS, type ColorPack } from '../../color/packs'
import { bandsRoles, composeBands } from './bands-compose'

const BOLD = getPack('bold')
/** Bold without Meta Blue, in another order. */
const BOLD_NO_BLUE: ColorPack = { ...BOLD, colors: [BOLD.colors[3], BOLD.colors[1], BOLD.colors[2]] }
const LISTS: ColorPack[] = [...PACKS, BOLD_NO_BLUE]
const DRAGS = [undefined, { from: [1.011, 1.224] as const, to: [-0.078, -0.067] as const }, { from: [0.5, -0.3] as const, to: [0.5, -0.5] as const }]

/** The params that make the design: shapes, places, sizes, edges and how the stack follows a line. */
const isLayout = (key: string) =>
  /^band\d+(Edges|Fade|FadeVary|Mode|Line|Tilt|Lean|Wave|Sun|Vary|BumpAt|BumpWidth|BumpTop|Veil|Fall|Bend)$/.test(key) ||
  /^patch\d+Shape$/.test(key) ||
  /^light\d+Shape$/.test(key) ||
  ['bands', 'patches', 'lights', 'stack', 'stackFrame', 'sun', 'lightVary', 'skyVeil', 'skyVeilEnd', 'skyDrift', 'skyBend', 'farSpan', 'water', 'waterAxis', 'lens'].includes(key)

describe('composeBands with any color list', () => {
  it('lays every seed, frame shape and line out the same, whatever the colors', () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (const aspect of [16 / 9, 9 / 16]) {
        for (const drag of DRAGS) {
          const [first, ...others] = LISTS.map((pack) => composeBands({ pack, seed, aspect, drag }).params)
          const layout = Object.keys(first).filter(isLayout)
          for (const [k, params] of others.entries()) {
            for (const key of layout) expect(params[key], `${LISTS[k + 1].id} ${seed} ${aspect} ${drag ? 'drag' : ''} ${key}`).toEqual(first[key])
          }
        }
      }
    }
  })

  it('paints only with the colors it is given', () => {
    for (const pack of LISTS) {
      const allowed = new Set(pack.colors.map((c) => c.hex))
      for (let seed = 1; seed <= 8; seed++) {
        for (const drag of DRAGS) {
          const { colors } = composeBands({ pack, seed, aspect: 16 / 9, drag })
          for (const hex of colors) expect(allowed.has(hex), `${pack.colors.length} colors, seed ${seed}: ${hex}`).toBe(true)
        }
      }
    }
  })

  it('gives every role a color for lists of one to five colors in any order', () => {
    const hexes = PACKS.flatMap((p) => p.colors.map((c) => c.hex))
    for (let n = 1; n <= 5; n++) {
      for (let start = 0; start + n <= hexes.length; start += 3) {
        const list = hexes.slice(start, start + n).reverse()
        const roles = bandsRoles(list)
        for (const role of ['sky', 'light', 'second', 'dark', 'deep'] as const) {
          expect(list, `${list.join(',')} ${role}`).toContain(roles[role].hex)
          expect(roles[role].under).toBeGreaterThan(0)
        }
      }
    }
  })
})
