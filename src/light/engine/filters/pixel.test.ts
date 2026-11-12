import { describe, expect, it } from 'vitest'
import { linearToOklab } from '../../color/oklab'
import { hexToLinear } from '../../color/srgb'
import { EXPORT_SIZES } from '../frame'
import { buildOutputShader } from '../output'
import { OUTPUT_FILTERS } from '.'
import {
  PIXEL_FILTER,
  PIXEL_LINE_CONTRAST,
  PIXEL_LINE_MAX,
  PIXEL_LINE_SHARE,
  PIXEL_MAX_CELLS,
  PIXEL_MIN_CELLS,
  pixelCells,
  pixelGrid,
  pixelLineArea,
  pixelLineCoverage,
  pixelBaseCells,
  pixelBaseGrid,
  pixelBlockVivid,
  pixelCellColor,
  pixelLayout,
  pixelLevelWeights,
  pixelLineWidth,
  pixelUniforms,
  pixelVivid,
} from './pixel'

const STEPS = Array.from({ length: 101 }, (_, k) => k / 100)
const source = PIXEL_FILTER.source!
const samplesAt = (frame: { width: number; height: number; seed: number }, density: number) => {
  const samples = source.samples
  return typeof samples === 'function' ? samples(frame, density) : samples
}

describe('pixel filter', () => {
  it('is a stage of the output chain, after grain', () => {
    expect(OUTPUT_FILTERS.indexOf(PIXEL_FILTER)).toBeGreaterThan(0)
    expect(PIXEL_FILTER.glsl).toContain('vec3 filterPixel(vec3 display, ivec2 px, float weight)')
    expect(buildOutputShader([PIXEL_FILTER])).toContain('display = filterPixel(display, px, weight);')
  })

  it('sets the cell size: 8 cells on the short side at 0, 144 at 1, by the same ratio per step', () => {
    expect(pixelCells(0)).toBe(PIXEL_MIN_CELLS)
    expect(pixelCells(1)).toBe(PIXEL_MAX_CELLS)
    expect(PIXEL_MAX_CELLS).toBeGreaterThanOrEqual(144)
    // The biggest cells are more than twice the old biggest (18 cells on the short side).
    expect(PIXEL_MIN_CELLS).toBeLessThanOrEqual(9)
    expect([0.25, 0.5, 0.75].map(pixelCells)).toEqual([16, 34, 70])
    expect(pixelCells(Number.NaN)).toBe(pixelCells(0.5))
    for (let k = 0; k < STEPS.length; k++) {
      expect(Math.abs(pixelCells(STEPS[k]) - PIXEL_MIN_CELLS * (PIXEL_MAX_CELLS / PIXEL_MIN_CELLS) ** STEPS[k])).toBeLessThanOrEqual(0.5)
      if (k > 0) expect(pixelCells(STEPS[k])).toBeGreaterThanOrEqual(pixelCells(STEPS[k - 1]))
      // Each value gives the size 1 - value gave when 0 was the smallest cells, so the range of sizes is the same.
      expect(pixelCells(STEPS[k])).toBe(Math.round(PIXEL_MAX_CELLS * (PIXEL_MIN_CELLS / PIXEL_MAX_CELLS) ** (1 - STEPS[k])))
    }
  })

  it('fills every export size with whole cells at every density, square within the long side rounding to whole cells', () => {
    for (const { width, height } of Object.values(EXPORT_SIZES)) {
      const aspect = Math.max(width, height) / Math.min(width, height)
      for (const d of STEPS) {
        const { across, down } = pixelGrid({ width, height }, d)
        expect(Math.min(across, down)).toBe(pixelCells(d))
        expect(Math.abs(Math.max(across, down) - pixelCells(d) * aspect)).toBeLessThanOrEqual(0.5)
        // Half a cell of rounding on a long side of 12.5 cells (4:5 at 10 cells) is the worst: 4 %.
        expect(Math.abs(width / across / (height / down) - 1)).toBeLessThan(0.045)
      }
    }
  })

  it('reads an even number of source texels a base cell (one from 128 base cells), at least 36 on the short side, drawn finely enough, the same for a preview and the export', () => {
    for (const { width, height } of Object.values(EXPORT_SIZES)) {
      const frame = { width, height, seed: 1 }
      for (const d of STEPS) {
        const size = source.size(frame, d)
        const { across, down } = pixelBaseGrid(frame, d)
        const base = pixelBaseCells(d)
        expect(base).toBe(2 * pixelCells(d))
        const texels = base >= 128 ? 1 : 2 * Math.ceil(18 / base)
        expect(size).toEqual({ width: texels * across, height: texels * down })
        expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(36)
        expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(512)
        const samples = samplesAt(frame, d)!
        expect(samples).toBeGreaterThanOrEqual(2)
        expect(samples).toBeLessThanOrEqual(8)
        expect(Math.min(size.width, size.height) * samples).toBeGreaterThanOrEqual(288)
      }
      for (const scale of [0.13, 0.25, 0.4, 1 / 3]) {
        // Previews are fitted in whole pixels, so their aspect is off by up to a pixel.
        for (const nudge of [-1, 0, 1]) {
          const preview = { width: Math.round(width * scale) + nudge, height: Math.round(height * scale), seed: 1 }
          for (const d of [0, 0.37, 1]) {
            expect(source.size(preview, d)).toEqual(source.size(frame, d))
            expect(samplesAt(preview, d)).toBe(samplesAt(frame, d))
          }
        }
      }
    }
  })

  it('draws crisp lines 2/24 of a cell wide, at most 2 px at 1080 px on the short side, so a preview shows the grid an export shows', () => {
    expect(PIXEL_LINE_SHARE).toBeCloseTo(2 / 24, 6)
    expect(PIXEL_LINE_MAX).toBeCloseTo(2 / 1080, 9)
    // Line width in a 4K export (2160 px on the short side) at a density.
    const px4k = (d: number) => (pixelLineWidth(d) * 2160) / pixelCells(d)
    expect(pixelLineWidth(1)).toBe(PIXEL_LINE_SHARE)
    expect(px4k(1)).toBeCloseTo(1.25, 6)
    for (const d of [0, 0.25, 0.5]) expect(px4k(d)).toBeCloseTo(4, 6)
    for (let k = 1; k < STEPS.length; k++) {
      expect(px4k(STEPS[k])).toBeLessThanOrEqual(4 + 1e-9)
      expect(px4k(STEPS[k])).toBeLessThanOrEqual(px4k(STEPS[k - 1]) + 1e-9)
    }
    // A pixel on the border is covered, one well inside its cell isn't, and the crossings count once.
    expect(pixelLineCoverage(0, 0.4, 0.06, 0.02)).toBe(1)
    expect(pixelLineCoverage(0.4, 0.4, 0.06, 0.02)).toBe(0)
    expect(pixelLineCoverage(0, 0, 0.06, 0.02)).toBe(1)
    // A line thinner than a pixel covers that pixel by its share.
    expect(pixelLineCoverage(0, 0.4, 0.01, 0.02)).toBeCloseTo(0.5, 6)
  })

  it('keeps every cell its mean: the lines get lighter and the inside darker by the same light', () => {
    // Cells of a few sizes with lines 2/24 of a cell, and the biggest cells with the capped lines: 4 px in a 4K
    // export, 1.12 px in a 606 px tall preview.
    const cases: [number, number][] = [...[6, 12, 42, 120].map((cellPx): [number, number] => [cellPx, PIXEL_LINE_SHARE]), [270, 4 / 270], [76, 1.12 / 76]]
    for (const [cellPx, width] of cases) {
      const pixel = 1 / cellPx
      const area = pixelLineArea(width)
      // The brightness factor at each pixel of a cell, as the shader draws it, averaged over the cell.
      let sum = 0
      let lines = 0
      let n = 0
      for (let j = 0; j < cellPx; j++) {
        for (let i = 0; i < cellPx; i++) {
          const dx = (i + 0.5) / cellPx - 0.5
          const dy = (j + 0.5) / cellPx - 0.5
          const cover = pixelLineCoverage(0.5 - Math.abs(dx), 0.5 - Math.abs(dy), width, pixel)
          sum += 1 + (PIXEL_LINE_CONTRAST * (cover - area)) / (1 - area)
          lines = Math.max(lines, cover)
          n++
        }
      }
      expect(sum / n, `${cellPx} px cells`).toBeCloseTo(1, 2)
      expect(lines).toBeGreaterThan(0.3)
    }
  })

  describe('big cells keep their colors (owner, 2026-11-12 7:22 AM)', () => {
    const lab = (rgb: readonly number[]) => linearToOklab(rgb)
    const chroma = (rgb: readonly number[]) => Math.hypot(lab(rgb)[1], lab(rgb)[2])
    const hue = (rgb: readonly number[]) => ((Math.atan2(lab(rgb)[2], lab(rgb)[1]) * 180) / Math.PI + 360) % 360
    const gap = (x: readonly number[], y: readonly number[]) => Math.hypot(...lab(x).map((v, q) => v - lab(y)[q]))
    const cell = (parts: readonly [string, number][]) => {
      const texels: number[][] = []
      for (const [hex, count] of parts) for (let k = 0; k < count; k++) texels.push(hexToLinear(hex))
      return texels
    }
    const [orange, blue, cyan, yellow] = ['#FF4F00', '#0064E0', '#1FCDF0', '#FFD61E']

    it('keeps a cell of one color exactly that color', () => {
      for (const hex of [orange, blue, cyan, yellow, '#4A0A3C', '#6A7788']) {
        const color = pixelCellColor(cell([[hex, 36]]), 1)
        hexToLinear(hex).forEach((v, q) => expect(color[q]).toBeCloseTo(v, 5))
      }
    })

    it('shows the color covering most of a cell across far hues, not the grey or brown of their mixed light', () => {
      const texels = cell([
        [orange, 22],
        [blue, 14],
      ])
      const mean = pixelCellColor(texels, 0)
      const kept = pixelCellColor(texels, 1)
      expect(chroma(kept)).toBeGreaterThan(chroma(mean) + 0.05)
      expect(Math.abs(hue(kept) - hue(hexToLinear(orange)))).toBeLessThan(25)
    })

    it('blends neighbours in the hue order through the hue between them at a tie', () => {
      const kept = pixelCellColor(
        cell([
          [cyan, 18],
          [yellow, 18],
        ]),
        1,
      )
      expect(hue(kept)).toBeGreaterThan(hue(hexToLinear(yellow)) + 20)
      expect(hue(kept)).toBeLessThan(hue(hexToLinear(cyan)) - 20)
      expect(chroma(kept)).toBeGreaterThan(0.09)
    })

    it('blends over a range as the shares of two colors in a cell pass a tie, never flipping from one to the other', () => {
      // One texel of 36 at a time: a flip would cover the whole way between the two colors in one step.
      for (const [x, y] of [
        [orange, blue],
        [cyan, yellow],
        [orange, cyan],
      ]) {
        const at = (k: number) => pixelCellColor(cell([[x, k], [y, 36 - k]]), 1)
        const whole = gap(at(36), at(0))
        for (let k = 1; k <= 36; k++) expect(gap(at(k), at(k - 1))).toBeLessThan(0.25 * whole)
      }
    })

    it('leaves a dark cell with a little color about as it was', () => {
      const texels = cell([
        ['#000000', 30],
        [cyan, 6],
      ])
      expect(gap(pixelCellColor(texels, 1), pixelCellColor(texels, 0))).toBeLessThan(0.02)
    })

    it('keeps colors fully at the biggest cells and not at all at the smallest, less as cells shrink', () => {
      expect(pixelVivid(0)).toBe(1)
      expect(pixelVivid(1)).toBe(0)
      expect(pixelVivid(0.75)).toBeLessThan(0.1)
      for (let k = 1; k <= 100; k++) expect(pixelVivid(k / 100)).toBeLessThanOrEqual(pixelVivid((k - 1) / 100))
      const texels = cell([
        [orange, 18],
        [blue, 18],
      ])
      expect(pixelCellColor(texels, 0)).toEqual(texels[0].map((_, q) => texels.reduce((s, t) => s + t[q], 0) / texels.length))
    })

    it('keeps colors fully in the biggest blocks and not at all in the smallest, less as blocks shrink', () => {
      expect(pixelBlockVivid(4)).toBe(1)
      expect(pixelBlockVivid(12)).toBe(1)
      expect(pixelBlockVivid(90)).toBe(0)
      for (let n = 5; n <= 300; n++) expect(pixelBlockVivid(n)).toBeLessThanOrEqual(pixelBlockVivid(n - 1))
    })

    it('works each base cell out once per frame, two texels a base cell', () => {
      const reduce = PIXEL_FILTER.source!.reduce!
      for (const density of [0, 0.5, 1]) {
        const { across, down } = pixelBaseGrid({ width: 1080, height: 1350 }, density)
        expect(reduce.size({ width: 1080, height: 1350, seed: 1 }, density)).toEqual({ width: 2 * across, height: down })
      }
      expect(reduce.glsl).toContain(`vec4 ${reduce.apply}(ivec2 texel)`)
      expect(PIXEL_FILTER.glsl).toContain(`uniform sampler2D ${reduce.uniform};`)
    })
  })

  describe('blocks of several sizes on one grid (owner, 2026-11-12 7:25 AM)', () => {
    const grid = (across: number, down: number, at: (x: number, y: number) => number) =>
      Array.from({ length: across * down }, (_, i) => at(i % across, Math.floor(i / across)))
    const shows = (layout: { split4: number[]; split2: number[] }, i: number) => pixelLevelWeights(layout.split4[i], layout.split2[i])

    it('makes a flat design big blocks and splits where the light changes', () => {
      const [across, down] = [32, 20]
      const flat = pixelLayout(grid(across, down, () => 0.5), across, down, 3)
      for (let i = 0; i < across * down; i++) expect(shows(flat, i)).toEqual([1, 0, 0])
      // A step in the light between x = 12 and 13: split at the step, 2 x 2 beside it, 4 x 4 further away.
      const step = pixelLayout(grid(across, down, (x) => (x < 13 ? 0.3 : 0.7)), across, down, 3)
      for (let y = 0; y < down; y++) {
        expect(shows(step, y * across + 12)).toEqual([0, 0, 1])
        expect(shows(step, y * across + 13)).toEqual([0, 0, 1])
        expect(shows(step, y * across + 14)).toEqual([0, 1, 0])
        expect(shows(step, y * across + 8)).toEqual([1, 0, 0])
        expect(shows(step, y * across + 16)).toEqual([1, 0, 0])
      }
    })

    it('puts every block on the base grid: the cells of a 2 x 2 or 4 x 4 group share its split, and a group past the edge is split', () => {
      const [across, down] = [37, 23]
      const light = grid(across, down, (x, y) => 0.5 + 0.2 * Math.sin(x * 0.4) * Math.cos(y * 0.3))
      const { split4, split2 } = pixelLayout(light, across, down, 9)
      for (let i = 0; i < across * down; i++) {
        const [x, y] = [i % across, Math.floor(i / across)]
        expect(split4[i]).toBe(split4[(y - (y % 4)) * across + (x - (x % 4))])
        expect(split2[i]).toBe(split2[(y - (y % 2)) * across + (x - (x % 2))])
        if (x >= 36 || y >= 20) expect(split4[i]).toBe(1)
        if (x >= 36 || y >= 22) expect(split2[i]).toBe(1)
      }
    })

    it('splits by seed where the light is near a limit, the same way every time for the same seed', () => {
      const [across, down] = [32, 20]
      const ramp = grid(across, down, (x) => 0.2 + 0.025 * x)
      const [a, b] = [pixelLayout(ramp, across, down, 1), pixelLayout(ramp, across, down, 2)]
      expect(a).toEqual(pixelLayout(ramp, across, down, 1))
      expect(a.split4.some((v, i) => Math.abs(v - b.split4[i]) > 0.1)).toBe(true)
    })

    it('splits and merges gradually when the light moves a little, as under a small drag', () => {
      const [across, down] = [48, 30]
      const glow = (c: number) => grid(across, down, (x, y) => 0.25 + 0.5 * Math.exp(-((x - c) ** 2 + (y - 15) ** 2) / 120))
      let last = pixelLayout(glow(20), across, down, 4)
      let most = 0
      for (let k = 1; k <= 20; k++) {
        const next = pixelLayout(glow(20 + 0.1 * k), across, down, 4)
        for (let i = 0; i < across * down; i++) {
          const [a, b] = [shows(next, i), shows(last, i)]
          most = Math.max(most, ...a.map((v, q) => Math.abs(v - b[q])))
        }
        last = next
      }
      // A tenth of a base cell of movement moves no cell more than a third of the way between two block sizes.
      expect(most).toBeLessThan(1 / 3)
    })
  })

  it('passes the base grid at the density, the output size and the seed as uniforms', () => {
    expect(pixelUniforms(0.5, { width: 3840, height: 2160, seed: 3 })).toEqual({
      uPixelCells: [121, 68],
      uPixelFrame: [3840, 2160],
      uPixelLine: 2 * PIXEL_LINE_MAX * 34,
      uPixelShort: 68,
      uPixelSeed: 3,
    })
    expect(pixelUniforms(0, { width: 1080, height: 1920, seed: 3 })).toEqual({ uPixelCells: [16, 28], uPixelFrame: [1080, 1920], uPixelLine: 2 * PIXEL_LINE_MAX * 8, uPixelShort: 16, uPixelSeed: 3 })
    expect(pixelUniforms(1, { width: 1080, height: 1350, seed: 3 })).toEqual({
      uPixelCells: [288, 360],
      uPixelFrame: [1080, 1350],
      uPixelLine: 2 * PIXEL_LINE_SHARE,
      uPixelShort: 288,
      uPixelSeed: 3,
    })
  })
})
