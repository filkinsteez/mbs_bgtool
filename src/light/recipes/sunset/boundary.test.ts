import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from '../../../../scripts/light/lib/harness.mjs'
import { BOUNDARY_GLSL, calibrateBoundary, type BoundaryParams } from './boundary'

// Bold sky from prototypes/organic-boundaries (lib/production.mjs), in short-side units with s0 = p.y.
const SKY: BoundaryParams = {
  wander: [
    [-0.04, 0.016],
    [0.14, 0.012],
    [0.2, 0.018],
    [0.32, 0.006],
  ],
  transitions: [
    { at: -0.04, width: 0.42 },
    { at: 0.2, width: 0.2 },
    { at: 0.32, width: 0.06 },
  ],
}
// A hill line: large wander in distance mode, little shared.
const HORIZON: BoundaryParams = { wander: [[0, 0.03]], share: 0.15, vertical: 'distance', ly: 0.3, sharedScale: 0.35, scale: 0.35 }
// Poster-like bands with two close edges, in edge mode.
const BANDS: BoundaryParams = {
  mode: 'edges',
  wander: [
    [-0.3, 0.008],
    [-0.1, 0.012],
    [0.05, 0.015],
    [0.12, 0.025],
    [0.25, 0.02],
  ],
  transitions: [
    { at: -0.3, width: 0.06 },
    { at: -0.1, width: 0.14 },
    { at: 0.05, width: 0.07 },
    { at: 0.12, width: 0.045 },
    { at: 0.25, width: 0.08 },
  ],
  share: 0.2,
  ly: 1,
  minGap: 0.3,
}
// Far too much fine independent wander: the guard has to work hard.
const STRESS: BoundaryParams = { wander: [[0, 0.06]], share: 0, vertical: 'distance', ly: 0.06, clip: 0, alongMod: { amount: 0, scale: 1 } }

const ASPECTS = [16 / 9, 1, 4 / 5, 9 / 16]
const frame = (aspect: number) => ({ halfW: 0.5 * Math.max(aspect, 1), halfH: 0.5 * Math.max(1 / aspect, 1) })
const spread = (values: number[]) => {
  const m = values.reduce((s, v) => s + v, 0) / values.length
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length)
}
const correlation = (x: number[], y: number[]) => {
  const mx = x.reduce((s, v) => s + v, 0) / x.length
  const my = y.reduce((s, v) => s + v, 0) / y.length
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy || 1e-12)
}

describe('boundary model on the CPU', () => {
  it('never folds: over seeds, aspects and parameters, t stays monotone and edges stay apart', { timeout: 120_000 }, () => {
    for (const params of [SKY, HORIZON, STRESS]) {
      for (const aspect of ASPECTS) {
        const { halfW, halfH } = frame(aspect)
        for (let seed = 1; seed <= 6; seed++) {
          const { field } = calibrateBoundary(params, aspect, seed)
          // a different grid from the calibration's, offset from it
          let lowest = 0
          const h = 0.0015
          for (let i = 0; i < 151; i++) {
            const a = -halfW + (2 * halfW * (i + 0.37)) / 151
            for (let k = 1; k < 263; k++) {
              const s0 = -halfH + (2 * halfH * (k + 0.61)) / 263
              lowest = Math.min(lowest, (field.warp(a, s0 + h) - field.warp(a, s0 - h)) / (2 * h))
            }
          }
          expect(lowest, `slope, aspect ${aspect.toFixed(2)}, seed ${seed}`).toBeGreaterThan(-0.78)
        }
      }
    }
    const edges = BANDS.transitions ?? []
    for (const aspect of ASPECTS) {
      const { halfW } = frame(aspect)
      for (let seed = 1; seed <= 6; seed++) {
        const { field } = calibrateBoundary(BANDS, aspect, seed)
        for (let j = 0; j + 1 < edges.length; j++) {
          const need = (0.3 * (edges[j].width + edges[j + 1].width)) / 2
          for (let i = 0; i < 173; i++) {
            const a = -halfW + (2 * halfW * (i + 0.37)) / 173
            const gap = edges[j + 1].at + field.edge(a, j + 1) - edges[j].at - field.edge(a, j)
            expect(gap, `edges ${j}-${j + 1}, aspect ${aspect.toFixed(2)}, seed ${seed}`).toBeGreaterThan(need * 0.98)
          }
        }
      }
    }
  })

  it('calms only the steep part: the guard is local, not one factor for the whole frame', () => {
    // the sky's one steep spot (seed 4) is calmed over a tenth of the width; the rest keeps its wander
    const sky = calibrateBoundary(SKY, 16 / 9, 4).report
    expect(sky.guardMin).toBeLessThan(0.95)
    expect(sky.guardShare).toBeLessThan(0.25)
    sky.realized.forEach((r, k) => expect(r / sky.requested[k]).toBeGreaterThan(0.95))
    // a steep hill line is calmed where it is steep: on most seeds part of the width stays untouched
    let local = 0
    for (let seed = 1; seed <= 10; seed++) if (calibrateBoundary(HORIZON, 16 / 9, seed).report.guardShare < 0.9) local++
    expect(local).toBeGreaterThanOrEqual(6)
  }, 30_000)

  it('shows the requested wander: within 10 % over the calibration window', () => {
    let checked = 0
    let skipped = 0
    for (const aspect of [16 / 9, 1, 9 / 16]) {
      const { halfW } = frame(aspect)
      const halfCal = Math.max(halfW, 0.6)
      for (let seed = 1; seed <= 10; seed++) {
        const { field, report } = calibrateBoundary(SKY, aspect, seed)
        if (report.guardMin < 0.999) {
          skipped++
          continue
        }
        SKY.wander.forEach(([s0], k) => {
          const values = Array.from({ length: 400 }, (_, i) => field.warp(-halfCal + (2 * halfCal * (i + 0.5)) / 400, s0))
          const ratio = spread(values) / report.requested[k]
          expect(ratio, `knot ${k}, aspect ${aspect.toFixed(2)}, seed ${seed}`).toBeGreaterThan(0.9)
          expect(ratio, `knot ${k}, aspect ${aspect.toFixed(2)}, seed ${seed}`).toBeLessThan(1.1)
        })
        checked++
      }
    }
    expect(skipped).toBeLessThanOrEqual(checked / 3)
  })

  it('lowers the wander on very wide transitions', () => {
    const { report } = calibrateBoundary(SKY, 16 / 9, 1)
    expect(report.requested[0]).toBeCloseTo(0.016 * (0.25 / 0.42), 6)
    expect(report.requested[2]).toBeCloseTo(0.018, 6)
    const off = calibrateBoundary({ ...SKY, wideWidth: 0 }, 16 / 9, 1)
    expect(off.report.requested[0]).toBeCloseTo(0.016, 6)
  })

  it('keeps neighbouring boundaries loosely related at the default share: correlation 0.2-0.7', () => {
    const edges = SKY.transitions ?? []
    const values: number[] = []
    for (let seed = 1; seed <= 40; seed++) {
      const { field } = calibrateBoundary(SKY, 16 / 9, seed)
      const at = Array.from({ length: 256 }, (_, i) => -0.89 + (1.78 * (i + 0.5)) / 256)
      for (let j = 0; j + 1 < edges.length; j++) {
        values.push(correlation(at.map((a) => field.warp(a, edges[j].at)), at.map((a) => field.warp(a, edges[j + 1].at))))
      }
    }
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    expect(mean).toBeGreaterThan(0.2)
    expect(mean).toBeLessThan(0.7)
  })

  it('gives the same uniforms for the same seed, and others for another seed', () => {
    for (const params of [SKY, HORIZON, BANDS, STRESS]) {
      const a = calibrateBoundary(params, 16 / 9, 7).uniforms
      const b = calibrateBoundary(params, 16 / 9, 7).uniforms
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      expect(JSON.stringify(calibrateBoundary(params, 16 / 9, 8).uniforms)).not.toBe(JSON.stringify(a))
    }
  })
})

// The shader through the engine: headless system Chrome via scripts/light's harness.
const chrome = process.platform === 'darwin' ? existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') : true
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

describe.skipIf(!chrome || process.env.LIGHT_SKIP_GPU === '1')('boundary model in the engine', () => {
  let harness: Awaited<ReturnType<typeof startHarness>> | null = null
  beforeAll(async () => {
    harness = await startHarness()
  }, 60_000)
  afterAll(async () => {
    await harness?.close()
  })

  it('compiles in a recipe program and matches the CPU field', { timeout: 60_000 }, async () => {
    const width = 320
    const height = 180
    const fragment = `${BOUNDARY_GLSL}
vec3 radiance(vec2 uv, vec2 p) {
  return vec3(0.5 + 5.0 * boundaryWarp(p.x, p.y), 0.5 + 5.0 * boundaryEdge(p.x, 1), 0.4 * boundarySoft(p.x, 1));
}
`
    for (const seed of [1, 2]) {
      const { uniforms, field } = calibrateBoundary(SKY, width / height, seed)
      // Sent as a string: vitest rewrites import() in functions, and this code runs in the page.
      const pixels = (await harness!.page.evaluate(`(async ({ fragment, uniforms, width, height, seed }) => {
        const { ProgramRenderer } = await import('/src/light/engine/programRenderer.ts')
        const program = { id: 'test.boundary', colorSlots: [], defaultColors: [], params: [], fragment, uniforms: () => uniforms }
        const renderer = new ProgramRenderer(document.createElement('canvas'))
        renderer.renderProgram(program, { seed, lens: { bloom: 0, halation: 0 }, output: { grain: 0, exposure: 0 } }, { width, height, supersample: 1, dither: false })
        const data = Array.from(renderer.readPixels())
        renderer.dispose()
        return data
      })(${JSON.stringify({ fragment, uniforms, width, height, seed })})`)) as number[]
      let worstWarp = 0
      let worstEdge = 0
      let worstSoft = 0
      for (let y = 4; y < height; y += 11) {
        for (let x = 3; x < width; x += 13) {
          const i = (y * width + x) * 4
          const px = ((x + 0.5) / width - 0.5) * (width / height)
          const py = (y + 0.5) / height - 0.5
          const lin = [0, 1, 2].map((c) => srgbToLinear(pixels[i + c] / 255))
          worstWarp = Math.max(worstWarp, Math.abs((lin[0] - 0.5) / 5 - field.warp(px, py)))
          worstEdge = Math.max(worstEdge, Math.abs((lin[1] - 0.5) / 5 - field.edge(px, 1)))
          worstSoft = Math.max(worstSoft, Math.abs(lin[2] / 0.4 - field.soft(px, 1)))
        }
      }
      // one 8-bit step at these levels is about 0.001 short sides of warp
      expect(worstWarp, `seed ${seed}`).toBeLessThan(0.002)
      expect(worstEdge, `seed ${seed}`).toBeLessThan(0.002)
      expect(worstSoft, `seed ${seed}`).toBeLessThan(0.02)
    }
  })
})
