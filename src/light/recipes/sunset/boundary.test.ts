import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from '../../../../scripts/light/lib/harness.mjs'
import { BOUNDARY_GLSL, boundaryContrast, calibrateBoundary, type BoundaryField, type BoundaryParams } from './boundary'

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

// The production layouts of prototypes/organic-boundaries (lib/production.mjs): stops in
// frame heights, wander as a share of the frame height, and each pack's colors with
// their gains. In a tall frame everything grows with the frame height, so the
// boundaries ask for 1.78 times the wander of a 16:9 frame in short sides.
const LAYOUTS: Record<string, { colors: Array<[string, number]>; stops: Array<[number, number]> }> = {
  bold: {
    colors: [['#0064E0', 1], ['#1FCDF0', 0.9], ['#FFD61E', 1], ['#0064E0', 0.3]],
    stops: [[0.46, 0.42], [0.7, 0.2], [0.82, 0.06]],
  },
  elemental: {
    colors: [['#0064E0', 1], ['#B8996E', 1.1], ['#0F3D33', 1], ['#4A0A3C', 0.9]],
    stops: [[0.56, 0.34], [0.76, 0.07], [0.92, 0.14]],
  },
  atmospheric: {
    colors: [['#0064E0', 1], ['#F2F4F7', 0.95], ['#6A7788', 1], ['#384753', 1], ['#1C2B33', 1]],
    stops: [[0.5, 0.4], [0.73, 0.1], [0.84, 0.1], [0.95, 0.12]],
  },
}
const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function layout(pack: string, aspect: number, withContrast = true): BoundaryParams {
  const L = LAYOUTS[pack]
  const tall = Math.max(1, 1 / aspect)
  const toS = (pos: number) => (pos - 0.5) * tall
  const Y = L.colors.map(([hex, gain]) => luminance(hex) * gain)
  const horizon = L.stops[1][0]
  return {
    wander: [
      [toS(L.stops[0][0]), 0.016 * tall],
      [toS(horizon - 0.06), 0.012 * tall],
      [toS(horizon), 0.018 * tall],
      [toS(horizon + 0.12), 0.006 * tall],
    ],
    transitions: L.stops.map(([pos, width], j) => ({ at: toS(pos), width: width * tall, ...(withContrast ? { contrast: boundaryContrast(Y[j], Y[j + 1]) } : {}) })),
    range: [-tall / 2, tall / 2],
  }
}

const ASPECTS = [16 / 9, 1, 4 / 5, 9 / 16]
const FORMATS = [21 / 9, 16 / 9, 4 / 3, 1, 4 / 5, 9 / 16, 9 / 21]
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
const columnsOf = (aspect: number, n: number) => {
  const { halfW } = frame(aspect)
  return Array.from({ length: n }, (_, i) => -halfW + (2 * halfW * (i + 0.5)) / n)
}
// The 50% line of transition j in every column: where s0 + warp = at (coordinate mode,
// by bisection) or at + edge (edge mode).
function line(field: BoundaryField, params: BoundaryParams, j: number, xs: number[]): number[] {
  const at = params.transitions![j].at
  if (params.mode === 'edges') return xs.map((a) => at + field.edge(a, j))
  return xs.map((a) => {
    let lo = at - 0.3
    let hi = at + 0.3
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2
      if (mid + field.warp(a, mid) < at) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  })
}
// Least squares polynomial on x in -1..1 and what is left of y.
function residual(y: number[], degree: number): number[] {
  const n = degree + 1
  const xs = y.map((_, i) => ((i + 0.5) / y.length) * 2 - 1)
  const M = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0))
  xs.forEach((x, i) => {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) M[r][c] += x ** r * x ** c
      M[r][n] += x ** r * y[i]
    }
  })
  for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) if (r !== c) for (let k = n; k >= c; k--) M[r][k] -= (M[r][c] / M[c][c]) * M[c][k]
  const q = M.map((rowValues, k) => rowValues[n] / rowValues[k])
  return y.map((v, i) => v - q.reduce((s, qk, k) => s + qk * xs[i] ** k, 0))
}
const dct = (v: number[], k: number) => v.reduce((s, x, i) => s + x * Math.cos((Math.PI * k * (i + 0.5)) / v.length), 0)
// The audit's bump aspect (prototypes/organic-boundaries/lib/isolines.mjs): main wavelength
// of the line with its tilt removed (k >= 2) or with tilt and bow removed (k >= 1), the
// shorter one, over 2 sqrt(2) times the wiggle RMS; not measured below 0.3% of the height.
function auditAspect(y: number[], span: number, height: number): number {
  const wiggle = residual(y, 2)
  const sigma = Math.sqrt(wiggle.reduce((s, v) => s + v * v, 0) / y.length)
  if (sigma <= 0.003 * height) return Infinity
  const top = (v: number[], from: number) => {
    let best = from
    for (let k = from; k < 64; k++) if (Math.abs(dct(v, k)) > Math.abs(dct(v, best))) best = k
    return best
  }
  return (2 * span) / Math.max(top(residual(y, 1), 2), top(wiggle, 1)) / (2 * Math.SQRT2 * sigma)
}
// pi over the steepest slope, as a sine's bump aspect at its steepest point.
function steepness(y: number[], span: number): number {
  let steepest = 0
  for (let i = 1; i < y.length; i++) steepest = Math.max(steepest, (Math.abs(y[i] - y[i - 1]) * y.length) / span)
  return Math.PI / steepest
}
// Share of the wiggle's energy at wavelengths shorter than `shorter`.
function shortShare(y: number[], span: number, shorter: number): number {
  const wiggle = residual(y, 2)
  let total = 0
  let short = 0
  for (let k = 1; k < 64; k++) {
    const e = dct(wiggle, k) ** 2
    total += e
    if ((2 * span) / k < shorter) short += e
  }
  return short / total
}

describe('boundary model on the CPU', () => {
  it('never folds: over seeds, aspects and parameters, t stays monotone and edges stay apart', { timeout: 120_000 }, () => {
    for (const params of [SKY, HORIZON, STRESS, layout('elemental', 9 / 16)]) {
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

  it('keeps the bump aspect at 10 or more in every frame and format, measured in the frame', { timeout: 180_000 }, () => {
    // the production layouts ask for more wander in tall frames (it grows with the frame height)
    for (const format of FORMATS) {
      const { halfW, halfH } = frame(format)
      const xs = columnsOf(format, 320)
      const cases: Array<[string, BoundaryParams]> = [...Object.keys(LAYOUTS).map((pack) => [pack, layout(pack, format)] as [string, BoundaryParams]), ['sky', SKY], ['bands', BANDS]]
      for (const [name, params] of cases) {
        for (let seed = 1; seed <= 3; seed++) {
          const { field } = calibrateBoundary(params, format, seed)
          params.transitions!.forEach((t, j) => {
            const y = line(field, params, j, xs)
            const where = `${name} ${format.toFixed(2)} seed ${seed} transition ${j}`
            expect(auditAspect(y, 2 * halfW, 2 * halfH), where).toBeGreaterThanOrEqual(10)
            // no cliffs anywhere, and an edge over a much darker ground stays gentle at its steepest
            expect(steepness(y, 2 * halfW), where).toBeGreaterThan((t.contrast ?? 0) >= 0.8 && t.width < 0.12 ? 9 : 4.5)
          })
        }
      }
    }
  })

  it('keeps an edge over a much darker ground soft at its crests, in long waves and in one piece', { timeout: 60_000 }, () => {
    for (const format of [16 / 9, 9 / 16]) {
      const { halfW } = frame(format)
      const xs = columnsOf(format, 256)
      const dark = layout('elemental', format)
      // the same layout with no contrast on the horizon (transition 1: tan over forest)
      const plain: BoundaryParams = { ...dark, transitions: dark.transitions!.map((t, j) => (j === 1 ? { at: t.at, width: t.width } : t)) }
      const t = dark.transitions![1]
      expect(t.contrast).toBeGreaterThan(0.8)
      let shortDark = 0
      let shortPlain = 0
      let crestRatio = 0
      let crestCorr = 0
      for (let seed = 1; seed <= 6; seed++) {
        const D = calibrateBoundary(dark, format, seed).field
        const P = calibrateBoundary(plain, format, seed).field
        // in one piece: the top and the bottom of the edge move alike
        const top = xs.map((a) => D.warp(a, t.at - 0.5 * t.width))
        const bottom = xs.map((a) => D.warp(a, t.at + 0.5 * t.width))
        expect(correlation(top, bottom), `seed ${seed}`).toBeGreaterThan(0.99)
        expect(spread(top) / spread(bottom), `seed ${seed}`).toBeGreaterThan(0.95)
        expect(spread(top) / spread(bottom), `seed ${seed}`).toBeLessThan(1.05)
        // soft at its crests: softer where the dark ground reaches highest into the sky (y points down)
        const y = line(D, dark, 1, xs)
        const lift = y.map((v) => -v)
        const soft = xs.map((a) => D.soft(a, 1))
        const order = lift.map((v, i) => [v, soft[i]]).sort((p, q) => p[0] - q[0])
        const n15 = Math.round(order.length * 0.15)
        const mean = (part: number[][]) => part.reduce((s, p) => s + p[1], 0) / part.length
        crestRatio += mean(order.slice(-n15)) / mean(order.slice(0, n15)) / 6
        crestCorr += correlation(lift, soft) / 6
        expect(Math.min(...soft) / Math.max(...soft), `seed ${seed}`).toBeGreaterThan(0.45)
        // long waves and gentle: less of its wiggle in short waves than without the contrast
        shortDark += shortShare(y, 2 * halfW, 0.25)
        shortPlain += shortShare(line(P, plain, 1, xs), 2 * halfW, 0.25)
        expect(steepness(y, 2 * halfW), `seed ${seed}`).toBeGreaterThan(9)
      }
      expect(crestRatio, `format ${format.toFixed(2)}`).toBeGreaterThan(1.12)
      expect(crestCorr, `format ${format.toFixed(2)}`).toBeGreaterThan(0.4)
      expect(shortDark, `format ${format.toFixed(2)}`).toBeLessThan(0.6 * shortPlain)
    }
  })

  it('calms only the steep part: the guard is local, not one factor for the whole frame', () => {
    // the sky's one steep spot (seed 4) is calmed over part of the width; the rest keeps its wander
    const sky = calibrateBoundary(SKY, 16 / 9, 4).report
    expect(sky.guardMin).toBeLessThan(0.95)
    expect(sky.guardShare).toBeLessThan(0.3)
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
        // where the guard or the bump rule lowers it, the request is not what the frame should show
        if (report.guardMin < 0.999 || report.scale.some((s) => s < 0.999)) {
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
    for (const params of [SKY, HORIZON, BANDS, STRESS, layout('atmospheric', 9 / 16)]) {
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

  it('compiles in a recipe program and matches the CPU field', { timeout: 90_000 }, async () => {
    const fragment = `${BOUNDARY_GLSL}
vec3 radiance(vec2 uv, vec2 p) {
  return vec3(0.5 + 5.0 * boundaryWarp(p.x, p.y), 0.5 + 5.0 * boundaryEdge(p.x, 1), 0.4 * boundarySoft(p.x, 1));
}
`
    // a sky, and a tall frame whose horizon (transition 1) lies over a much darker ground
    const cases: Array<[string, BoundaryParams, number, number, number]> = [
      ['sky', SKY, 320, 180, 1],
      ['sky', SKY, 320, 180, 2],
      ['dark ground', layout('elemental', 9 / 16), 180, 320, 1],
    ]
    for (const [name, params, width, height, seed] of cases) {
      const aspect = width / height
      const { uniforms, field } = calibrateBoundary(params, aspect, seed)
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
          const px = ((x + 0.5) / width - 0.5) * Math.max(aspect, 1)
          const py = ((y + 0.5) / height - 0.5) * Math.max(1 / aspect, 1)
          const lin = [0, 1, 2].map((c) => srgbToLinear(pixels[i + c] / 255))
          worstWarp = Math.max(worstWarp, Math.abs((lin[0] - 0.5) / 5 - field.warp(px, py)))
          worstEdge = Math.max(worstEdge, Math.abs((lin[1] - 0.5) / 5 - field.edge(px, 1)))
          worstSoft = Math.max(worstSoft, Math.abs(lin[2] / 0.4 - field.soft(px, 1)))
        }
      }
      // one 8-bit step at these levels is about 0.001 short sides of warp
      expect(worstWarp, `${name} seed ${seed}`).toBeLessThan(0.002)
      expect(worstEdge, `${name} seed ${seed}`).toBeLessThan(0.002)
      expect(worstSoft, `${name} seed ${seed}`).toBeLessThan(0.02)
    }
  })
})
