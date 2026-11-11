import { describe, expect, it } from 'vitest'
import { compareDrag, GRID_LINE, gridDrags, SHOWN, worstCases } from '../scripts/light/lib/drag-colors.mjs'

const shares = (blue: number, orange: number, yellow: number) => ({ 'Meta Blue': blue, 'Orange-red': orange, Yellow: yellow })

describe('compareDrag', () => {
  it('flags a color the default view shows and the drag drops under the shown share', () => {
    const r = compareDrag(shares(0.4, 0.03, 0.012), shares(0.45, 0.002, 0.012))
    expect(r.lost).toEqual([{ name: 'Orange-red', before: 0.03, after: 0.002 }])
    expect(r.oneColor).toBe(false)
    expect(r.loss).toBeCloseTo(0.028)
  })

  it('makes no claim about a color the default view does not show, or one the drag adds', () => {
    const r = compareDrag(shares(0.4, 0.005, 0), shares(0.3, 0.001, 0.05))
    expect(r.lost).toEqual([])
    expect(r.shownAfter).toEqual(['Meta Blue', 'Yellow'])
  })

  it('marks a drag that leaves one color where the default view shows two or more', () => {
    expect(compareDrag(shares(0.4, 0.03, 0.02), shares(0.6, 0, 0.004)).oneColor).toBe(true)
    expect(compareDrag(shares(0.4, 0.004, 0), shares(0.6, 0, 0)).oneColor).toBe(false)
  })

  it('counts a color at the shown share as shown', () => {
    expect(compareDrag(shares(0.4, SHOWN, 0), shares(0.4, SHOWN, 0)).lost).toEqual([])
  })
})

describe('gridDrags', () => {
  it('starts each line in a cell of the grid and points it at the frame middle, the middle cell down', () => {
    const drags = gridDrags(3)
    expect(drags).toHaveLength(9)
    for (const d of drags) {
      expect(Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1])).toBeCloseTo(GRID_LINE, 2)
      const toMiddle = [0.5 - d.from[0], 0.5 - d.from[1]]
      if (Math.hypot(toMiddle[0], toMiddle[1]) > 0.01) expect((d.to[0] - d.from[0]) * toMiddle[0] + (d.to[1] - d.from[1]) * toMiddle[1]).toBeGreaterThan(0)
    }
    expect(drags[4]).toMatchObject({ name: 'grid 2,2', from: [0.5, 0.5], to: [0.5, 0.9] })
    expect(drags[0].from).toEqual([0.167, 0.167])
  })
})

describe('worstCases', () => {
  const drag = (name: string, loss: number, oneColor = false) => ({ name, lost: loss ? [{ name: 'Yellow', before: loss, after: 0 }] : [], oneColor, loss })
  const frame = (seed: number, drags: ReturnType<typeof drag>[]) => ({ look: 'contour.merged', pack: 'bold', seed, format: '16x9', stage: 'off', drags })

  it('takes one drag per frame, one color first, then by the share lost', () => {
    const frames = [frame(1, [drag('a', 0.05), drag('b', 0.08)]), frame(2, [drag('a', 0.01, true)]), frame(3, [drag('a', 0.02)]), frame(4, [drag('a', 0)])]
    const worst = worstCases(frames, 3)
    expect(worst.map((c) => [c.frame.seed, c.drag.name])).toEqual([
      [2, 'a'],
      [1, 'b'],
      [3, 'a'],
    ])
  })
})
