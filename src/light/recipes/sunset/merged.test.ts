import { describe, expect, it } from 'vitest'
import { defaultMix, setMetaBlue } from '../../color/mix'
import { getPack } from '../../color/packs'
import { composeMerged, mergedBands, mergedParts } from './merged'

const CONTROLS = { intensity: 0.5, softness: 0.7, mood: 0.5 }
const PACKS = ['bold', 'elemental', 'atmospheric'].map((id) => getPack(id as 'bold'))
const ASPECTS = [16 / 9, 9 / 16]
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1)
const OWNER_LINE = { from: [1.011, 1.224] as [number, number], to: [-0.078, -0.067] as [number, number] }
// Lines for the drag direction test (frame units, y down), with the owner's: the corner drag above and its mirror, and
// the left-to-right drag of 2026-11-11 9:29 AM.
const DIRECTION_LINES: Record<string, { from: [number, number]; to: [number, number] }> = {
  'left to right': { from: [0.1, 0.5], to: [0.9, 0.5] },
  'right to left': { from: [0.9, 0.5], to: [0.1, 0.5] },
  'bottom to top': { from: [0.5, 0.9], to: [0.5, 0.1] },
  'top to bottom': { from: [0.5, 0.1], to: [0.5, 0.9] },
  'up and to the right': { from: [0.1, 0.9], to: [0.9, 0.1] },
  'down and to the right': { from: [0.1, 0.1], to: [0.9, 0.9] },
  "owner's corner drag": OWNER_LINE,
  'mirrored corner drag': { from: [-0.011, 1.224], to: [1.078, -0.067] },
  "owner's left-to-right drag": { from: [-0.001, 0.418], to: [0.62, 0.428] },
}
// The owner's arrows of 2026-11-11 7:05 and 7:06 PM (Bold, seed 44, 16:9), where the colors' order flipped.
const OWNER_ARROWS: Record<string, { from: [number, number]; to: [number, number] }> = {
  "owner's 7:05 PM arrow, bottom to top": { from: [0.569, 1.04], to: [0.579, 0.056] },
  "owner's 7:06 PM arrow, top to bottom": { from: [0.452, 0.069], to: [0.452, 0.983] },
  "owner's 7:06 PM arrow, shorter": { from: [0.452, 0.069], to: [0.45, 0.913] },
}

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

  // The owner's rule (2026-11-11 9:29 AM and 2:46 PM; AGENTS.md): a drag sets the gradient like a design tool's gradient
  // tool. The bands stack along the sky's height above the horizon line, read here from the composed design on a grid
  // over the frame (the horizon line as the shader draws it, without its small drift). Across the frame that height
  // must change mostly along the line and little across it, rise from the line's start toward its end, and the light
  // must sit on the start's side of the frame.
  it('follows the drag arrow: bands at right angles to the line, stacked along it from the light at its start', () => {
    const bow = (a: number) => (a * a) / Math.sqrt(1 + a ** 4)
    const cells = 24
    const step = 0.01
    for (const [name, drag] of Object.entries(DIRECTION_LINES))
      for (const seed of SEEDS)
        for (const aspect of ASPECTS) {
          const { params } = composeMerged({ pack: PACKS[0], controls: { ...CONTROLS, drag }, seed, aspect })
          const frameW = Math.max(aspect, 1)
          const frameH = Math.max(1 / aspect, 1)
          const line = [(drag.to[0] - drag.from[0]) * frameW, (drag.to[1] - drag.from[1]) * frameH]
          const along = [line[0] / Math.hypot(line[0], line[1]), line[1] / Math.hypot(line[0], line[1])]
          const sun = params.sun as number[]
          const up = params.up as number[]
          const [off, bend, lean] = params.horizon as number[]
          const height = (x: number, y: number) => {
            const d = [x - sun[0], y - sun[1]]
            const a = -d[0] * up[1] + d[1] * up[0]
            return d[0] * up[0] + d[1] * up[1] - (off + bend * bow(a) + lean * a)
          }
          let rise = 0
          let alongChange = 0
          let acrossChange = 0
          for (let i = 0; i < cells; i++)
            for (let j = 0; j < cells; j++) {
              const x = ((i + 0.5) / cells - 0.5) * frameW
              const y = ((j + 0.5) / cells - 0.5) * frameH
              const ahead = height(x + step * along[0], y + step * along[1]) - height(x - step * along[0], y - step * along[1])
              rise += ahead
              alongChange += Math.abs(ahead)
              acrossChange += Math.abs(height(x - step * along[1], y + step * along[0]) - height(x + step * along[1], y - step * along[0]))
            }
          const label = `${name}, s${seed} ${aspect > 1 ? '16:9' : '9:16'}`
          expect(acrossChange / alongChange, `${label}: change across the line against along it`).toBeLessThan(0.35)
          expect(rise / alongChange, `${label}: the bands stack from the line's start toward its end`).toBeGreaterThan(0.5)
          expect(sun[0] * along[0] + sun[1] * along[1], `${label}: the light sits on the start's side`).toBeLessThan(0)
        }
  })

  // The place along the bands the color stage reads (mergedBands, the shader's lookBand): the pack's bright end goes at
  // its low end, by the line's start, and its dark end at its high end, by the line's end, so the order never flips.
  const bandsFor = (drag: { from: [number, number]; to: [number, number] }, seed: number, aspect: number) => {
    const [w, h] = aspect > 1 ? [64, 36] : [36, 64]
    const { params } = composeMerged({ pack: PACKS[0], controls: { ...CONTROLS, drag }, seed, aspect })
    return { w, h, ...mergedBands(params, aspect, w, h) }
  }
  // Each cell's place along the line, 0 at its start and 1 at its end.
  const alongLine = (drag: { from: [number, number]; to: [number, number] }, aspect: number, w: number, h: number) => {
    const frameW = Math.max(aspect, 1)
    const frameH = Math.max(1 / aspect, 1)
    const line = [(drag.to[0] - drag.from[0]) * frameW, (drag.to[1] - drag.from[1]) * frameH]
    const length2 = line[0] ** 2 + line[1] ** 2
    return Float32Array.from({ length: w * h }, (_, i) => {
      const x = (((i % w) + 0.5) / w - drag.from[0]) * frameW
      const y = ((Math.floor(i / w) + 0.5) / h - drag.from[1]) * frameH
      return (x * line[0] + y * line[1]) / length2
    })
  }

  it("gives the stage its place along the bands: lowest at the line's start, rising along it, highest toward its end", () => {
    for (const [name, drag] of Object.entries({ ...DIRECTION_LINES, ...OWNER_ARROWS }))
      for (const seed of SEEDS)
        for (const aspect of ASPECTS) {
          const { w, h, place } = bandsFor(drag, seed, aspect)
          const along = alongLine(drag, aspect, w, h)
          const meanOf = (v: Float32Array) => v.reduce((s, x) => s + x, 0) / v.length
          const [mp, ma] = [meanOf(place), meanOf(along)]
          let cov = 0
          let vp = 0
          let va = 0
          for (let i = 0; i < place.length; i++) {
            cov += (place[i] - mp) * (along[i] - ma)
            vp += (place[i] - mp) ** 2
            va += (along[i] - ma) ** 2
          }
          const label = `${name}, s${seed} ${aspect > 1 ? '16:9' : '9:16'}`
          expect(cov / Math.sqrt(vp * va), `${label}: the place rises along the line`).toBeGreaterThan(0.8)
        }
  })

  it('crosses the line square: on average the lines of equal place meet the line at right angles, and they still curve', () => {
    const lines: Record<string, { from: [number, number]; to: [number, number] } | undefined> = { ...DIRECTION_LINES, ...OWNER_ARROWS, 'no line (the sky’s way up)': undefined }
    for (const [name, drag] of Object.entries(lines))
      for (const seed of SEEDS)
        for (const aspect of ASPECTS) {
          const [w, h] = aspect > 1 ? [64, 36] : [36, 64]
          const frameW = Math.max(aspect, 1)
          const frameH = Math.max(1 / aspect, 1)
          const { params } = composeMerged({ pack: PACKS[0], controls: { ...CONTROLS, drag }, seed, aspect })
          const up = params.up as number[]
          const { place } = mergedBands(params, aspect, w, h)
          // The place's change along the line and across it, summed over the frame, and each cell's angle off the line.
          let along = 0
          let across = 0
          let turned = 0
          let weight = 0
          for (let y = 1; y < h - 1; y++)
            for (let x = 1; x < w - 1; x++) {
              const gx = (place[y * w + x + 1] - place[y * w + x - 1]) / ((2 * frameW) / w)
              const gy = (place[(y + 1) * w + x] - place[(y - 1) * w + x]) / ((2 * frameH) / h)
              const ga = gx * up[0] + gy * up[1]
              const gc = -gx * up[1] + gy * up[0]
              along += ga
              across += gc
              turned += Math.hypot(ga, gc) * Math.abs(Math.atan2(gc, ga))
              weight += Math.hypot(ga, gc)
            }
          const label = `${name}, s${seed} ${aspect > 1 ? '16:9' : '9:16'}`
          expect(Math.abs((Math.atan2(across, along) * 180) / Math.PI), `${label}: degrees the lines lean off square on average`).toBeLessThan(3)
          expect(((turned / weight) * 180) / Math.PI, `${label}: degrees the lines curve off square, cell by cell`).toBeGreaterThan(2)
        }
  })

  it("keeps the place along the bands under a few pixels' drag and any mix, so the colors' order can't flip", () => {
    // A step is 0.004 of the frame's width, about 3 pixels of the preview at 16:9.
    for (const [name, arrow] of Object.entries(OWNER_ARROWS)) {
      const base = bandsFor(arrow, 44, 16 / 9)
      for (let k = -5; k <= 5; k++) {
        const moves: Record<string, { from: [number, number]; to: [number, number] }> = {
          'end along the arrow': { from: arrow.from, to: [arrow.to[0], arrow.to[1] + 0.004 * k * (16 / 9) * Math.sign(arrow.to[1] - arrow.from[1])] },
          'arrow sideways': { from: [arrow.from[0] + 0.004 * k, arrow.from[1]], to: [arrow.to[0] + 0.004 * k, arrow.to[1]] },
        }
        for (const [move, drag] of Object.entries(moves)) {
          const moved = bandsFor(drag, 44, 16 / 9)
          let most = 0
          for (let i = 0; i < base.place.length; i++) most = Math.max(most, Math.abs(moved.place[i] - base.place[i]))
          expect(most, `${name}, ${move} ${k}: the most any cell's place moves`).toBeLessThan(0.02 * Math.abs(k) + 1e-6)
        }
      }
      // The mix never reaches the design, so a slider step can't move the place at all.
      const mixed = composeMerged({ pack: PACKS[0], controls: { ...CONTROLS, drag: arrow }, seed: 44, aspect: 16 / 9, mix: setMetaBlue(PACKS[0], defaultMix(PACKS[0]), false).shares })
      expect(Array.from(mergedBands(mixed.params, 16 / 9, base.w, base.h).place), `${name}: the place under another mix`).toEqual(Array.from(base.place))
    }
  })
})
