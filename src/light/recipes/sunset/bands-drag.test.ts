import { describe, expect, it } from 'vitest'
import { getPack, PACK_IDS } from '../../color/packs'
import { compositionProblems } from '../../compose'
import { sunsetBands } from './bands'
import { composeBands, type BandsComposition } from './bands-compose'

const ASPECTS = [16 / 9, 9 / 16, 1, 4 / 5]

/** A line from a start (frame units) in a direction (degrees, 0 right, -90 up) with a length in short sides. */
function lineAt(from: [number, number], angle: number, length: number, aspect: number) {
  const [w, h] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
  const turn = (angle * Math.PI) / 180
  return { from, to: [from[0] + (length * Math.cos(turn)) / w, from[1] + (length * Math.sin(turn)) / h] as [number, number] }
}

/** The scene point (frame units of the scene, y down) that a frame point shows. */
function shown(composition: BandsComposition, point: readonly [number, number], aspect: number): [number, number] {
  const [w, h] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
  const [a, b, c, d, e, f] = composition.params.stack as number[]
  const p = [(point[0] - 0.5) * w, (point[1] - 0.5) * h]
  return [(a * p[0] + b * p[1] + e) / w + 0.5, (c * p[0] + d * p[1] + f) / h + 0.5]
}

/** How far a scene height is inside the band it falls in: the distance to the nearer of its edges. */
const insideBand = (composition: BandsComposition, v: number) => {
  const n = composition.params.bands as number
  const tops = Array.from({ length: n }, (_, i) => (composition.params[`band${i + 1}Edges`] as number[])[0])
  const k = tops.findIndex((top, i) => v >= top && (i + 1 >= n || v < tops[i + 1]))
  return k < 0 ? -1 : Math.min(v - tops[k], k + 1 < n ? tops[k + 1] - v : Infinity)
}

describe('composeBands with a dragged line', () => {
  it('keeps every param in range for starts, directions and lengths in every format', () => {
    for (const packId of PACK_IDS) {
      const pack = getPack(packId)
      for (let seed = 1; seed <= 6; seed++) {
        for (const aspect of ASPECTS) {
          for (const from of [[0.5, 0.55], [-0.25, 1.25], [1.25, -0.25], [0.1, 0.9]] as [number, number][]) {
            for (let angle = -180; angle < 180; angle += 45) {
              for (const length of [0.05, 0.5, 1.5]) {
                const composition = composeBands({ pack, seed, aspect, drag: lineAt(from, angle, length, aspect) })
                expect(compositionProblems(sunsetBands, pack, composition), `${packId} ${seed} ${aspect} ${from} ${angle} ${length}`).toEqual([])
              }
            }
          }
        }
      }
    }
  })

  it('shows the scene as it is without a drag', () => {
    expect(composeBands({ pack: getPack('bold'), seed: 3, aspect: 16 / 9 }).params.stack).toEqual([1, 0, 0, 1, 0, 0])
  })

  it("puts the middle of the light's band at the line's start, at the light's column, and the top of the sky at its end", () => {
    for (const packId of PACK_IDS) {
      for (let seed = 1; seed <= 8; seed++) {
        for (const aspect of [16 / 9, 9 / 16]) {
          for (const [angle, length] of [[-60, 0.6], [30, 0.9], [150, 0.4], [-120, 1.1]]) {
            const drag = lineAt([0.45, 0.6], angle, length, aspect)
            const composition = composeBands({ pack: getPack(packId), seed, aspect, drag })
            const [x, v] = shown(composition, drag.from, aspect)
            const label = `${packId} ${seed} ${aspect} ${angle} ${length}`
            expect(x, label).toBeCloseTo((composition.params.sun as number[])[0], 6)
            expect(insideBand(composition, v), label).toBeGreaterThan(0.03)
            // The line's end is up the stack, toward the deep sky.
            const [toX, toV] = shown(composition, drag.to, aspect)
            expect(toX, label).toBeCloseTo(x, 6)
            expect(toV, label).toBeLessThan(v)
          }
        }
      }
    }
  })

  it('moves the image a little for a small change of the line', () => {
    const pack = getPack('elemental')
    for (let seed = 1; seed <= 4; seed++) {
      let before: number[] | null = null
      for (let length = 0.1; length <= 1.5; length += 0.01) {
        const stack = composeBands({ pack, seed, aspect: 16 / 9, drag: lineAt([0.5, 0.7], -100, length, 16 / 9) }).params.stack as number[]
        if (before) for (let k = 0; k < 6; k++) expect(Math.abs(stack[k] - before[k]), `seed ${seed} length ${length.toFixed(2)}`).toBeLessThan(0.05)
        before = stack
      }
    }
  })
})
