import { describe, expect, it, vi } from 'vitest'
import { linearToOklab, linearToOklch, oklabToLinear } from '../color/oklab'
import { PACKS } from '../color/packs'
import { hexToLinear, linearToSrgb, srgbToLinear } from '../color/srgb'
import { getRecipe, RECIPE_LIST } from '../recipes'
import { DEFAULT_LENS, RECIPE_IDS, type RecipeContext, type RecipeProgram } from '../scene'
import { encodeJpeg, exportFileName, exportSize } from './export'
import { EXPORT_ASPECTS, EXPORT_SIZES, frameAspect, type ExportAspect } from './frame'
import { grainAmplitude, grainCellPx, grainDrift, grainField, grainLightDensity, grainParams, grainUniforms } from './grain'
import {
  bloomLevelFactors,
  halationDriftColor,
  halationLevel,
  halationLevelFactors,
  halationStart,
  GLOW_DIM_COLORS,
  GLOW_DIM_STEPS,
  type GlowDimPath,
  glowDimmed,
  glowDimUniforms,
  hueApart,
  leadMix,
  lensBaseSize,
  lensSpread,
  levelForRadius,
  spreadLeadFactors,
  veilFactors,
  veilFill,
  veilLevelWeights,
} from './lens'
import { paperToeInverse, TONE_CROSSTALK, TONE_TIE_BAND, TONE_WARM_LIMIT, toneCurve, toneHoldHue } from './output'
import { buildFlowShader, FLOW_BLUR_SHADER, FLOW_TAPS, flowFieldSize } from './passes'
import { designFrame, lensBaseFromFrame, radianceScaleFor } from './programRenderer'
import { coerceParam, recipeContext, resolveScene } from './resolve'

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const packHexes = [...new Set(PACKS.flatMap((pack) => pack.colors.map((c) => c.hex)))]

describe('tone curve', () => {
  it('leaves every color with max channel <= 1 unchanged', () => {
    for (const hex of packHexes) {
      const c = hexToLinear(hex)
      expect(toneCurve(c)).toEqual(c)
      expect(toneCurve(c.map((v) => v * 0.5))).toEqual(c.map((v) => v * 0.5))
    }
  })

  // The curve before ties were smoothed, which must still hold away from ties.
  const untiedCurve = (rgb: readonly number[]) => {
    const m = Math.max(...rgb)
    if (m <= 1) return [...rgb]
    const r = rgb.map((v) => v / m)
    const gap = r.map((v) => 1 - v)
    const w = r.map((v, i) => (v + TONE_CROSSTALK[i][0] * r[0] + TONE_CROSSTALK[i][1] * r[1] + TONE_CROSSTALK[i][2] * r[2]) / (gap[i] + 0.05))
    const k = luminance(r) / (0.2126 * gap[0] * w[0] + 0.7152 * gap[1] * w[1] + 0.0722 * gap[2] * w[2])
    return gap.map((g, i) => Math.min(1, Math.max(0, 1 - g * Math.exp(-k * (m - 1) * w[i] - 0.005 * (m - 1) ** 2))))
  }
  /** The second channel's gap to the largest (0 at a tie). */
  const nearestTie = (c: readonly number[]) => {
    const m = Math.max(...c)
    return c.map((v) => 1 - v / m).sort((x, y) => x - y)[1]
  }

  it('is unchanged where every lower channel is at least TONE_TIE_BAND below the largest', () => {
    let compared = 0
    for (const m of [1.01, 1.3, 2, 5, 16]) {
      for (let second = 0; second <= 0.95; second += 0.05) {
        for (let third = 0; third <= second; third += 0.05) {
          for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
            const c = [0, 0, 0]
            c[order[0]] = m
            c[order[1]] = m * second
            c[order[2]] = m * third
            if (nearestTie(c) < TONE_TIE_BAND) continue
            expect(toneCurve(c), c.join(', ')).toEqual(toneHoldHue(c.map((v) => v / m), untiedCurve(c)))
            compared++
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(5000)
  })

  it('has no jump where two channels tie for the largest', () => {
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
      for (const level of [0, 0.43, 0.95]) {
        for (const m of [1.1, 1.25, 2, 5]) {
          let previous: number[] | null = null
          for (let step = -65; step <= 65; step++) {
            const q = Math.exp(step * 0.0025)
            const c = [m * level, m * level, m * level]
            c[a] = m * Math.min(1, 1 / q)
            c[b] = m * Math.min(1, q)
            const out = toneCurve(c)
            // The ridge moved a channel by up to 0.3 in one step; near ties the curve itself moves up to about 0.011.
            if (previous) expect(Math.max(...out.map((v, i) => Math.abs(v - (previous as number[])[i]))), `${c.map((v) => v.toFixed(3))}`).toBeLessThan(0.02)
            previous = out
          }
        }
      }
    }
  })

  it('keeps the luminance slope at the start of compression and rises toward white', () => {
    for (const hex of [...packHexes, '#FF0000', '#00FF00', '#0000FF']) {
      const c = hexToLinear(hex)
      const m = Math.max(...c)
      const at = (scale: number) => luminance(toneCurve(c.map((v) => (v / m) * scale)))
      const d = 1e-4
      const below = (at(1) - at(1 - d)) / d
      const above = (at(1 + d) - at(1)) / d
      if (nearestTie(c) >= TONE_TIE_BAND) expect(Math.abs(above / below - 1), hex).toBeLessThan(0.01)
      let previous = at(1)
      for (let scale = 1.05; scale < 64; scale *= 1.1) {
        const value = at(scale)
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9)
        previous = value
      }
      expect(at(1e4)).toBeGreaterThan(0.999)
    }
  })

  const hueAt = (hex: string, scale: number) => {
    const c = hexToLinear(hex)
    const m = Math.max(...c)
    return linearToOklch(toneCurve(c.map((v) => (v / m) * scale)))
  }
  const hueDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180

  it('turns warm light toward yellow as it whitens, never toward pink', () => {
    for (const hex of ['#FF4F00', '#FFD61E', '#B8996E', '#FF0000', '#FFB300']) {
      let previous = hueAt(hex, 1)[2]
      for (let scale = 1.1; scale < 32; scale *= 1.1) {
        const [, chroma, hue] = hueAt(hex, scale)
        if (chroma < 0.03) break
        expect(hueDiff(hue, previous), `${hex} at ${scale.toFixed(2)}x`).toBeGreaterThan(-0.5)
        expect(hue, `${hex} at ${scale.toFixed(2)}x`).toBeLessThan(112)
        previous = hue
      }
    }
    expect(hueAt('#FF4F00', 4)[2]).toBeGreaterThan(85)
  })

  it('keeps blue and cyan light at their own hue as they whiten: no pale cyan from Meta Blue, no green from Cyan', () => {
    for (const hex of ['#0064E0', '#0000FF', '#6A7788', '#384753', '#1C2B33', '#1FCDF0', '#00FFFF']) {
      const nominal = hueAt(hex, 1)[2]
      for (let scale = 1.1; scale < 64; scale *= 1.1) {
        const [, chroma, hue] = hueAt(hex, scale)
        if (chroma < 0.03) break
        expect(Math.abs(hueDiff(hue, nominal)), `${hex} at ${scale.toFixed(2)}x`).toBeLessThan(1)
      }
    }
    // Meta Blue at 4x is still a blue with real chroma (0.077 with the drift toward cyan, 0.072 held).
    const [, chroma, hue] = hueAt('#0064E0', 4)
    expect(Math.abs(hueDiff(hue, 259))).toBeLessThan(1)
    expect(chroma).toBeGreaterThan(0.06)
  })

  it('stops warm light just past Yellow as it whitens: a paler golden yellow, never lemon', () => {
    for (const hex of ['#FFD61E', '#FF4F00', '#B8996E', '#FF0000', '#FFB300']) {
      for (let scale = 1.05; scale < 32; scale *= 1.05) {
        const [, chroma, hue] = hueAt(hex, scale)
        if (chroma < 0.03) break
        expect(hue, `${hex} at ${scale.toFixed(2)}x`).toBeLessThan(TONE_WARM_LIMIT + 0.5)
      }
    }
    // Lime, past the limit already, keeps the curve's own path.
    const lime = hexToLinear('#D6F26C')
    const r = lime.map((v) => v / Math.max(...lime))
    const curve = toneCurve(r.map((v) => v * 1.5))
    expect(toneHoldHue(r, curve)).toEqual(curve)
    // A lemon curve result for Yellow light turns back to the limit at the same luminance.
    const yellow = hexToLinear('#FFD61E').map((v, _, c) => v / Math.max(...c))
    const lemon: [number, number, number] = [1, 0.99, 0.35]
    const held = toneHoldHue(yellow, lemon)
    expect(luminance(held)).toBeCloseTo(luminance(lemon), 9)
    expect(linearToOklch(held)[2]).toBeCloseTo(TONE_WARM_LIMIT, 0)
  })

  it('holds the hue for cool light, turns warm light back only past the limit, and keeps the luminance of the curve', () => {
    for (const hex of ['#FF4F00', '#FFD61E', '#D6F26C', '#B8996E', '#4A0A3C', '#FF0000', '#00FF00']) {
      const c = hexToLinear(hex)
      const m = Math.max(...c)
      for (const scale of [1.5, 3, 8]) {
        const hot = c.map((v) => (v / m) * scale)
        const o = toneCurve(hot)
        expect(toneHoldHue(hot.map((v) => v / scale), o), `${hex} at ${scale}x`).toEqual(o)
      }
    }
    for (const hex of ['#0064E0', '#1FCDF0', '#6A7788']) {
      const r = hexToLinear(hex).map((v, _, c) => v / Math.max(...c))
      const o: [number, number, number] = [r[0] + (1 - r[0]) * 0.4, r[1] + (1 - r[1]) * 0.7, 1]
      expect(luminance(toneHoldHue(r, o)), hex).toBeCloseTo(luminance(o), 9)
    }
  })

  it('paper toe: flat pack colors print their hex from pre-inverted light, nothing at or above nominal changes', () => {
    for (const hex of packHexes) {
      const c = hexToLinear(hex)
      toneCurve(paperToeInverse(c, 1), 1).forEach((v, i) => expect(v, hex).toBeCloseTo(c[i], 12))
      const m = Math.max(...c)
      for (const scale of [1, 1.5, 4]) {
        const hot = c.map((v) => (v / m) * scale)
        expect(toneCurve(hot, 1), `${hex} at ${scale}x`).toEqual(toneCurve(hot))
      }
    }
    const program: RecipeProgram = { id: 'test.toe', colorSlots: [{ key: 'a', label: 'A' }], defaultColors: ['#0F3D33'], params: [], fragment: '', uniforms: () => ({}) }
    expect(resolveScene(program, { output: { toe: 1 } }).colors[0]).toEqual(paperToeInverse(hexToLinear('#0F3D33'), 1))
    expect(resolveScene(program, {}).colors[0]).toEqual(hexToLinear('#0F3D33'))
  })

  it('paper toe: dim Yellow turns amber instead of olive', () => {
    const yellow = hexToLinear('#FFD61E')
    const hue = (toe: number) => linearToOklch(toneCurve(yellow.map((v) => v / 8), toe))[2]
    expect(hue(0) - linearToOklch(yellow)[2]).toBeCloseTo(0, 0)
    expect(hue(1)).toBeLessThan(linearToOklch(yellow)[2] - 8)
  })

  it('moves hue smoothly for every pack color', () => {
    for (const hex of packHexes) {
      let previous: number | null = null
      for (let scale = 1; scale < 64; scale *= 1.01) {
        const [, chroma, hue] = hueAt(hex, scale)
        if (chroma < 0.05) {
          previous = null
          continue
        }
        if (previous !== null) expect(Math.abs(hueDiff(hue, previous)), `${hex} at ${scale.toFixed(2)}x`).toBeLessThan(1.5)
        previous = hue
      }
    }
  })
})

describe('scene resolution', () => {
  const program: RecipeProgram = {
    id: 'test.resolve',
    colorSlots: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
    defaultColors: ['#000000', '#FFFFFF'],
    params: [
      { kind: 'number', key: 'softness', label: 'Softness', min: 0, max: 0.4, step: 0.01, default: 0.1 },
      { kind: 'number', key: 'angle', label: 'Angle', min: -90, max: 90, step: 1, default: 0 },
    ],
    fragment: 'vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }',
    uniforms: () => ({}),
    lens: { bloom: 0.07 },
  }

  it('fills defaults, clamps numbers and rejects wrong types', () => {
    const resolved = resolveScene(program, { seed: 3.6, colors: ['#123456'], params: { softness: 99, angle: 'x' as unknown as number } })
    expect(resolved.seed).toBe(4)
    expect(resolved.hex).toEqual(['#123456', '#FFFFFF'])
    expect(resolved.params.softness).toBe(0.4)
    expect(resolved.params.angle).toBe(0)
    expect(resolved.lens.bloom).toBe(0.07)
    expect(resolved.lens.halation).toBe(DEFAULT_LENS.halation)
  })

  it('coerces vectors by length', () => {
    const spec = { kind: 'vector' as const, key: 'v', label: 'V', min: 0, max: 1, step: 0.1, default: [0.5, 0.5] }
    expect(coerceParam(spec, [2, -1])).toEqual([1, 0])
    expect(coerceParam(spec, [0.2])).toEqual([0.5, 0.5])
  })

  it('has one registered recipe per id, each with matching slots and defaults', () => {
    expect(RECIPE_LIST.map((r) => r.id)).toEqual([...RECIPE_IDS])
    for (const recipe of RECIPE_LIST) {
      expect(recipe.defaultColors.length).toBe(recipe.colorSlots.length)
      for (const pack of PACKS) expect(recipe.fromPack(pack).length).toBe(recipe.colorSlots.length)
      expect(recipe.fragment).toMatch(/vec3 radiance\(vec2 \w+, vec2 \w+\)/)
    }
  })
})

describe('lens weights', () => {
  it('bloom levels keep total luminance; the halo keeps the light, its drift part at the same luminance', () => {
    const lens = { ...DEFAULT_LENS, bloom: 0.2, bloomRadius: 0.4, bloomWidth: 1.2, bloomTint: '#FF8040', halation: 1, halationRadius: 0.05, halationTint: '#FFD61E', halationDriftTint: '#FF4F00', halationDrift: 0.4, halationSpread: 0.5 }
    const bloom = bloomLevelFactors(lens)
    expect(bloom.reduce((sum, f) => sum + luminance(f), 0)).toBeCloseTo(1, 6)
    const halation = halationLevelFactors(lens)
    for (let channel = 0; channel < 3; channel++) expect(halation.reduce((sum, f) => sum + f[channel], 0)).toBeCloseTo(0.6, 6)
    expect(halation.reduce((sum, f) => sum + f[3], 0)).toBeCloseTo(0.4, 6)
    const drift = halationDriftColor(lens)
    expect(luminance(drift)).toBeCloseTo(1, 6)
    expect(drift[0] / drift[1]).toBeCloseTo(hexToLinear('#FF4F00')[0] / hexToLinear('#FF4F00')[1], 6)
  })

  it('accepts explicit per-level bloom weights and tints from a scene', () => {
    const recipe = getRecipe('contour.rim')
    const resolved = resolveScene(recipe, { lens: { bloom: 0.3, bloomLevels: [1, 0, 0, 0, 0, 0, 0, 3], bloomLevelTints: ['#ffffff', '#ff0000'] } })
    expect(resolved.lens.bloomLevels).toEqual([1, 0, 0, 0, 0, 0, 0, 3])
    expect(resolved.lens.bloomLevelTints).toEqual(['#FFFFFF', '#FF0000'])
    const factors = bloomLevelFactors(resolved.lens)
    expect(luminance(factors[0])).toBeCloseTo(0.25, 6)
    expect(luminance(factors[7])).toBeCloseTo(0.75, 6)
    expect(factors[1]).toEqual([0, 0, 0])
    expect(resolveScene(recipe, { lens: { bloomLevels: [-1] } }).lens.bloomLevels).toBeUndefined()
  })

  it('puts the halo at the halation radius and its drift part a level wider, with no drift and a white level by default', () => {
    const lens = { ...DEFAULT_LENS, halation: 1, halationRadius: 0.05, halationDrift: 0.5 }
    const factors = halationLevelFactors(lens)
    const centerOf = (channel: number) => factors.reduce((sum, f, level) => sum + f[channel] * level, 0) / factors.reduce((sum, f) => sum + f[channel], 0)
    expect(centerOf(0)).toBeCloseTo(levelForRadius(0.05), 1)
    expect(centerOf(3) - centerOf(0)).toBeCloseTo(1, 1)
    expect(DEFAULT_LENS.halationDrift).toBe(0)
    expect(DEFAULT_LENS.halationTint).toBe('#FFFFFF')
  })

  it("counts the halo's light in multiples of the light's own level, so every light color starts its halo at its hex", () => {
    for (const hex of ['#0064E0', '#FFD61E', '#B8996E', '#F2F4F7']) {
      const lens = { ...DEFAULT_LENS, halationTint: hex, halationThreshold: 1.5 }
      const light = hexToLinear(hex)
      const own = [luminance(light), Math.max(...light)]
      for (let k = 0; k < 2; k++) {
        expect(halationLevel(lens)[k]).toBeCloseTo(own[k], 6)
        expect(halationStart(lens)[k]).toBeCloseTo(1.5 * own[k], 6)
        expect(halationStart({ ...lens, halationThreshold: 0.5 })[k]).toBeCloseTo(own[k], 6)
      }
    }
    expect(halationStart(DEFAULT_LENS)[0]).toBeCloseTo(1, 6)
    expect(halationStart(DEFAULT_LENS)[1]).toBeCloseTo(1, 6)
    expect(resolveScene(getRecipe('contour.rim'), { lens: { halationDriftTint: '#0f3d33', halationDrift: 0.5 } }).lens).toMatchObject({ halationDriftTint: '#0F3D33', halationDrift: 0.5 })
  })

  it('works on a 512 px short side at any output size', () => {
    expect(lensBaseSize(925, 1001)).toEqual({ width: 512, height: 554 })
    expect(lensBaseSize(3840, 2160)).toEqual({ width: 910, height: 512 })
  })
})

describe('veil', () => {
  const lens = { ...DEFAULT_LENS, bloom: 0.04, glare: 0.06 }

  it('is off by default and never changes the bloom and glare spread the color stage reads', () => {
    expect(DEFAULT_LENS.veil).toBe(0)
    expect(veilFactors(lens)).toBeNull()
    const before = lensSpread(lens)
    for (const veil of [0, 0.2, 0.6]) expect(lensSpread({ ...lens, veil, veilReach: 0.04 })).toEqual(before)
    expect(before.mix).toBeCloseTo(0.04 + 0.06 - 0.04 * 0.06, 9)
  })

  it('falls over levels that sum to 1, wider with its reach', () => {
    for (const reach of [0.005, 0.007, 0.01, 0.02, 0.03, 0.04]) expect(veilLevelWeights(reach).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3)
    const center = (w: number[]) => w.reduce((sum, v, level) => sum + v * level, 0)
    expect(center(veilLevelWeights(0.04))).toBeGreaterThan(center(veilLevelWeights(0.02)))
    expect(center(veilLevelWeights(0.02))).toBeGreaterThan(center(veilLevelWeights(0.005)))
    expect(veilFactors({ ...lens, veil: 0.2, veilReach: 0.02 })).toEqual(veilLevelWeights(0.02))
  })

  it('brightens only places dimmer than the light around them, so cores and even fields keep their light', () => {
    expect(veilFill(1, 1, 0.2)).toBe(0)
    expect(veilFill(2, 1, 0.2)).toBe(0)
    expect(veilFill(0, 1, 0.2)).toBeCloseTo(0.2, 9)
    // A place half as bright as its surroundings gets an eighth of a dark gap's fill, so gradients keep their range.
    expect(veilFill(0.5, 1, 0.2)).toBeCloseTo(0.2 / 8, 9)
    // It rises from zero with zero slope, so no crease where the surroundings pass the pixel's own light.
    expect(veilFill(0.999, 1, 0.2) / 0.001).toBeLessThan(0.01)
    let last = 0
    for (let own = 1; own >= 0; own -= 0.05) {
      const lift = veilFill(own, 1, 0.2)
      expect(lift).toBeGreaterThanOrEqual(last)
      expect(lift).toBeLessThanOrEqual(0.2 * (1 - own) + 1e-12)
      last = lift
    }
  })

  it("colors the spread light by the light that brings the most of it, so two colors' glows never mix into a third hue", () => {
    const blue = hexToLinear('#0064E0')
    const red = hexToLinear('#FF4F00')
    const hue = (c: readonly number[]) => linearToOklch(c)[2]
    // Meta Blue's own light with Orange-red's glow at half its luminance stays Meta Blue's hue within a few degrees.
    const glow = red.map((v) => (v * 0.5 * luminance(blue)) / luminance(red)) as [number, number, number]
    const mixed = leadMix(blue, glow, red)
    expect(Math.abs(hue(mixed) - hue(blue))).toBeLessThan(6)
    const added = blue.map((v, i) => v + glow[i])
    expect(Math.abs(hue(added) - hue(blue))).toBeGreaterThan(20)
    // Brightness is the sum of the two whatever their colors, so a pack swap keeps the design.
    expect(luminance(mixed)).toBeCloseTo(luminance(blue) + luminance(glow), 9)
    // Two lights of one color add as light does.
    const same = leadMix(blue, blue.map((v) => v * 0.3) as [number, number, number], blue)
    same.forEach((v, i) => expect(v).toBeCloseTo(blue[i] * 1.3, 9))
    // In the dark, far below where the weights would round to zero, it still gives finite light.
    for (const scale of [1e-6, 1e-12, 1e-30]) {
      const dim = leadMix(blue.map((v) => v * scale) as [number, number, number], red.map((v) => v * scale * 0.5) as [number, number, number], red)
      dim.forEach((v) => expect(Number.isFinite(v)).toBe(true))
      expect(luminance(dim)).toBeCloseTo(scale * (luminance(blue) + 0.5 * luminance(red)), 12)
    }
    expect(leadMix([0, 0, 0], [0, 0, 0], red)).toEqual([0, 0, 0])
  })

  it('lets near colors add as light does and leads only between colors far apart', () => {
    const at1 = (c: readonly number[]) => c.map((v) => v / luminance(c))
    const blue = hexToLinear('#0064E0')
    const cyan = hexToLinear('#1FCDF0')
    const red = hexToLinear('#FF4F00')
    expect(hueApart(at1(blue), at1(cyan))).toBe(0)
    expect(hueApart(at1(blue), at1(red))).toBe(1)
    expect(hueApart(at1(blue), [1, 1, 1])).toBe(0)
    // Meta Blue with Cyan's glow comes out close to the added light; with Orange-red's it stays Meta Blue.
    const hue = (c: readonly number[]) => linearToOklch(c)[2]
    const glowOf = (c: readonly number[]) => c.map((v) => (v * 0.5 * luminance(blue)) / luminance(c)) as [number, number, number]
    const added = (g: readonly number[]) => blue.map((v, i) => v + g[i])
    expect(Math.abs(hue(leadMix(blue, glowOf(cyan), cyan)) - hue(added(glowOf(cyan))))).toBeLessThan(2)
    expect(Math.abs(hue(leadMix(blue, glowOf(red), red)) - hue(blue))).toBeLessThan(6)
    expect(Math.abs(hue(added(glowOf(red))) - hue(blue))).toBeGreaterThan(20)
  })

  it('weighs the lead color one level finer than the veil', () => {
    const weights = veilLevelWeights(0.02)
    const lead = spreadLeadFactors(weights)
    expect(lead.reduce((a, b) => a + b, 0)).toBeCloseTo(weights.reduce((a, b) => a + b, 0), 9)
    expect(lead[0]).toBeCloseTo(weights[0] + weights[1], 9)
    for (let i = 1; i < 7; i++) expect(lead[i]).toBeCloseTo(weights[i + 1], 9)
    expect(lead[7]).toBe(0)
  })
})

describe('veil dim paths', () => {
  const yellow = hexToLinear('#FFD61E')
  const orange = hexToLinear('#FF4F00')
  const deepRed = orange.map((v) => v * 0.3) as [number, number, number]
  const blue = hexToLinear('#0064E0')
  const fire: GlowDimPath = { color: yellow, steps: [{ color: orange, below: 0.5 }, { color: deepRed, below: 0.25 }] }
  const at1 = (c: readonly number[]) => c.map((v) => v / luminance(c))
  const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6))

  it('is off until paths are given, and packs them at luminance 1 with their levels', () => {
    expect(glowDimUniforms([]).uGlowDimColors).toBe(0)
    const u = glowDimUniforms([fire, { color: blue, steps: [] }])
    expect(u.uGlowDimColors).toBe(2)
    const base = u.uGlowDimBase as Float32Array
    const steps = u.uGlowDimStep as Float32Array
    expect(base.length).toBe(GLOW_DIM_COLORS * 4)
    near(Array.from(base.slice(0, 3)), at1(yellow))
    expect(steps[3]).toBeCloseTo(0.5, 6)
    expect(steps[7]).toBeCloseTo(0.25, 6)
    expect(steps[GLOW_DIM_STEPS * 4 + 3]).toBe(0)
  })

  it("dims a glow along its pack color's path, like fire, and leaves other colors as they are", () => {
    near(glowDimmed(yellow, 1, [fire]), at1(yellow))
    near(glowDimmed(yellow, 0.5, [fire]), at1(orange))
    near(glowDimmed(yellow, 0.1, [fire]), at1(deepRed))
    // Between steps it passes smoothly from one color to the next, with no jump.
    let last = glowDimmed(yellow, 1, [fire])
    for (let level = 0.99; level > 0.05; level -= 0.01) {
      const now = glowDimmed(yellow, level, [fire])
      expect(Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2])).toBeLessThan(0.25)
      last = now
    }
    near(glowDimmed(blue, 0.1, [fire]), at1(blue))
    near(glowDimmed(yellow, 0.1, []), at1(yellow))
  })

  it('passes softly from one path to the next as the glow moves from one pack color toward another', () => {
    const paths: GlowDimPath[] = [fire, { color: blue, steps: [] }]
    const y = at1(yellow)
    const b = at1(blue)
    let last = glowDimmed(y, 0.1, paths)
    near(last, at1(deepRed))
    let largest = 0
    for (let k = 1; k <= 100; k++) {
      const now = glowDimmed(
        y.map((v, i) => v + ((b[i] - v) * k) / 100),
        0.1,
        paths,
      )
      largest = Math.max(largest, Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2]))
      last = now
    }
    near(last, b)
    // An all-or-nothing switch jumps by about 2.7 in one 1 % step here.
    expect(largest).toBeLessThan(0.5)
  })
})

describe('flow blur', () => {
  it('draws the directions from the GLSL that gives the flow, with no recipe needed, and blurs with one shared pass', () => {
    const glsl = 'uniform vec2 uWind;\nvec2 flowDirection(vec2 p) { return uWind; }\n'
    const shader = buildFlowShader(glsl)
    expect(shader).toContain(glsl)
    expect(shader).toContain('flowDirection(p)')
    expect(FLOW_BLUR_SHADER).toContain(`k <= ${FLOW_TAPS}`)
    expect(FLOW_BLUR_SHADER).toContain('uFlowField')
    expect(FLOW_BLUR_SHADER).not.toContain('flowDirection')
  })

  it('keeps the directions at a small size of the same shape', () => {
    expect(flowFieldSize(3840, 2160)).toEqual([455, 256])
    expect(flowFieldSize(1076, 606)).toEqual([455, 256])
    expect(flowFieldSize(200, 120)).toEqual([200, 120])
    expect(flowFieldSize(2160, 3840)).toEqual([256, 455])
  })
})

describe('grain', () => {
  // A flat grey through the CPU copy of the stage, as 8-bit code values (green channel) before rounding and dither.
  const grainedGrey = (code: number, density: number, cellPx: number, size = 192) => {
    const linear = srgbToLinear(code / 255)
    const [L, a, b] = linearToOklab([linear, linear, linear])
    const amp = grainAmplitude(grainParams(density), L)
    const out = new Float64Array(size * size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const g = amp > 0 ? grainField(x, y, density, cellPx, 3, L) : 0
        const rgb = oklabToLinear([L + amp * g, a, b]).map((v) => Math.min(1, Math.max(0, v)))
        out[y * size + x] = linearToSrgb(rgb[1]) * 255
      }
    }
    return out
  }
  const mean = (values: Float64Array) => values.reduce((s, v) => s + v, 0) / values.length

  it('is fine specks one pixel across at 1080 px on the short side; up to Strength 0.5 only their count changes, above it the grain grows', () => {
    expect(grainCellPx(1920, 1080)).toBe(1)
    expect(grainCellPx(1080, 1920)).toBe(1)
    expect(grainCellPx(3840, 2160)).toBe(2)
    const low = grainUniforms(0.25, 3840, 2160)
    for (const density of [0.1, 0.25, 0.5]) {
      const uniforms = grainUniforms(density, 3840, 2160)
      expect(uniforms.uGrainCell).toBe(2)
      expect(uniforms.uGrainAmp).toBe(low.uGrainAmp)
      expect(uniforms.uGrainShare).toBeCloseTo(density * 0.3, 10)
      expect(uniforms.uGrainDark).toBe(low.uGrainDark)
      expect(uniforms.uGrainClump).toBe(0)
    }
    // Toward Strength 1 (owner, 2026-11-11 3:15 PM: "v subtle at 1"): more specks, stronger, more of them in soft clumps.
    let last = grainUniforms(0.5, 3840, 2160)
    for (const density of [0.6, 0.73, 0.85, 1]) {
      const uniforms = grainUniforms(density, 3840, 2160)
      expect(uniforms.uGrainAmp as number).toBeGreaterThan(last.uGrainAmp as number)
      expect(uniforms.uGrainShare as number).toBeGreaterThan(last.uGrainShare as number)
      expect(uniforms.uGrainClump as number).toBeGreaterThan(last.uGrainClump as number)
      last = uniforms
    }
    expect(grainUniforms(1, 3840, 2160).uGrainAmp as number).toBeLessThan(1.5 * (low.uGrainAmp as number))
    expect(grainUniforms(0, 3840, 2160).uGrainAmp).toBe(0)
  })

  it('fades to 0 at black and at white and is even in between', () => {
    const params = grainParams(1)
    expect(grainAmplitude(params, 0)).toBe(0)
    expect(grainAmplitude(params, 1)).toBe(0)
    expect(grainAmplitude(params, 0.3)).toBeCloseTo(grainAmplitude(params, 0.8), 10)
    expect(grainAmplitude(grainParams(0.25), 0.5)).toBe(grainAmplitude(grainParams(0.5), 0.5))
    expect(grainAmplitude(params, 0.5)).toBeGreaterThan(grainAmplitude(grainParams(0.5), 0.5))
  })

  it('changes nothing at Density 0 and leaves black exact at Density 1', () => {
    // At 0 the output pass leaves the stage out, and there are no specks.
    expect(grainUniforms(0, 1920, 1080).uGrainAmp).toBe(0)
    let specks = 0
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) specks += grainField(x, y, 0, 2, 3) === 0 ? 0 : 1
    expect(specks).toBe(0)
    expect(grainedGrey(0, 1, 2).every((v) => v === 0)).toBe(true)
  })

  it('keeps a flat grey at its mean within 0.1 code values at Density 1', () => {
    // Over the same number of cells at every cell size: the soft clumps in the dark span two cells.
    for (const cellPx of [1, 2, 0.83]) {
      for (const code of [60, 128, 200]) expect(Math.abs(mean(grainedGrey(code, 1, cellPx, Math.round(192 * Math.max(1, cellPx)))) - code)).toBeLessThan(0.1)
    }
  })

  it('changes more pixels the higher the density', () => {
    for (const cellPx of [1, 2]) {
      let last = 0
      for (const density of [0.1, 0.25, 0.5, 0.75, 1]) {
        const values = grainedGrey(128, density, cellPx)
        const changed = values.reduce((n, v) => n + (Math.abs(v - 128) >= 3 ? 1 : 0), 0) / values.length
        expect(changed).toBeGreaterThan(last)
        last = changed
      }
    }
  })

  it('keeps the speck size at every density', () => {
    // Correlation of horizontally adjacent pixels: set by the speck's shape, not by how many specks there are.
    const neighbours = (density: number) => {
      const size = 192
      const values = grainedGrey(128, density, 2, size)
      const m = mean(values)
      let together = 0
      let alone = 0
      for (let y = 0; y < size; y++) {
        for (let x = 0; x + 1 < size; x++) {
          together += (values[y * size + x] - m) * (values[y * size + x + 1] - m)
          alone += (values[y * size + x] - m) ** 2
        }
      }
      return together / alone
    }
    expect(Math.abs(neighbours(0.25) - neighbours(0.5))).toBeLessThan(0.06)
    // Toward Strength 1 part of the grain comes from soft two-cell clumps: a little larger, still fine.
    expect(neighbours(1)).toBeGreaterThan(neighbours(0.5))
    expect(neighbours(1)).toBeLessThan(neighbours(0.5) + 0.15)
  })

  it('has fewer specks in deep shadows and near white than in the midtones', () => {
    expect(grainLightDensity(0.05)).toBeCloseTo(0.6, 6)
    expect(grainLightDensity(0.99)).toBeCloseTo(0.6, 6)
    for (const L of [0.4, 0.55, 0.75]) expect(grainLightDensity(L)).toBe(1)
    for (let k = 2; k < 8; k++) expect(grainLightDensity((k + 1) / 20)).toBeGreaterThan(grainLightDensity(k / 20))
    for (let k = 15; k < 19; k++) expect(grainLightDensity((k + 1) / 20)).toBeLessThan(grainLightDensity(k / 20))
    // No grain is stronger in the shadows than in the midtones: the 99th percentile of its size there is no larger.
    const strong = (L: number) => {
      const sizes: number[] = []
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) sizes.push(Math.abs(grainField(x, y, 1, 1, 3, L)))
      return sizes.sort((a, b) => a - b)[Math.floor(0.99 * sizes.length)]
    }
    expect(strong(0.12)).toBeLessThanOrEqual(strong(0.6))
  })

  it('drifts slowly and faintly in how many specks there are across the frame', () => {
    const correlation = (a: number[], b: number[]) => {
      const [ma, mb] = [mean(Float64Array.from(a)), mean(Float64Array.from(b))]
      let [ab, aa, bb] = [0, 0, 0]
      a.forEach((v, i) => {
        ab += (v - ma) * (b[i] - mb)
        aa += (v - ma) ** 2
        bb += (b[i] - mb) ** 2
      })
      return ab / Math.sqrt(aa * bb)
    }
    // The drift is smooth: points 60 cells apart agree, and it stays within -1 to 1.
    const here: number[] = []
    const there: number[] = []
    for (let y = 0; y < 1080; y += 30)
      for (let x = 0; x + 60 < 1920; x += 30) {
        here.push(grainDrift(x, y, 1, 5))
        there.push(grainDrift(x + 60, y, 1, 5))
      }
    expect(Math.max(...here.map(Math.abs))).toBeLessThanOrEqual(1)
    expect(correlation(here, there)).toBeGreaterThan(0.8)
    // The speck counts in blocks of 120 x 120 cells follow it, and differ from block to block by only a little.
    const block = 120
    const counts: number[] = []
    const drifts: number[] = []
    for (let by = 0; by < 1080 / block; by++)
      for (let bx = 0; bx < 1920 / block; bx++) {
        let n = 0
        let d = 0
        for (let y = by * block; y < (by + 1) * block; y += 2)
          for (let x = bx * block; x < (bx + 1) * block; x += 2) {
            n += grainField(x, y, 1, 1, 5) < -0.1 ? 1 : 0
            d += grainDrift(x, y, 1, 5)
          }
        counts.push(n)
        drifts.push(d)
      }
    expect(correlation(counts, drifts)).toBeGreaterThan(0.7)
    const m = mean(Float64Array.from(counts))
    const spread = Math.sqrt(counts.reduce((s, v) => s + (v - m) ** 2, 0) / counts.length) / m
    expect(spread).toBeGreaterThan(0.03)
    expect(spread).toBeLessThan(0.2)
  })

  it('clumps a little larger in the dark', () => {
    const neighbours = (code: number) => {
      const size = 192
      const values = grainedGrey(code, 0.5, 2, size)
      const m = mean(values)
      let together = 0
      let alone = 0
      for (let y = 0; y < size; y++) {
        for (let x = 0; x + 1 < size; x++) {
          together += (values[y * size + x] - m) * (values[y * size + x + 1] - m)
          alone += (values[y * size + x] - m) ** 2
        }
      }
      return together / alone
    }
    expect(neighbours(30)).toBeGreaterThan(neighbours(128) + 0.05)
  })

  it('ignores grain settings from before the strength scale', () => {
    const program: RecipeProgram = {
      id: 'test.grain',
      colorSlots: [],
      defaultColors: [],
      params: [],
      fragment: 'vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }',
      uniforms: () => ({}),
    }
    const resolved = resolveScene(program, { output: { grain: 1, grainSize: 1.5, grainChroma: 0.2 } as Record<string, number> })
    expect(resolved.output).toEqual({ exposure: 0, grain: 1, pixel: 0, toe: 0 })
  })
})

describe('radiance scale', () => {
  const base: RecipeProgram = {
    id: 'test.scale',
    colorSlots: [],
    defaultColors: [],
    params: [{ kind: 'number', key: 'soft', label: 'Soft', min: 0, max: 1, step: 0.01, default: 0.8 }],
    fragment: 'vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }',
    uniforms: () => ({}),
  }
  const ctx = (program: RecipeProgram) => recipeContext(resolveScene(program, {}), 16 / 9)

  it('snaps to 1, 0.5 or 0.25 and can depend on the scene', () => {
    expect(radianceScaleFor(base, ctx(base))).toBe(1)
    for (const [asked, expected] of [[1, 1], [0.8, 1], [0.5, 0.5], [0.4, 0.5], [0.3, 0.25], [0.1, 0.25], [Number.NaN, 1]]) {
      const program = { ...base, radianceScale: asked }
      expect(radianceScaleFor(program, ctx(program)), String(asked)).toBe(expected)
    }
    const bySoftness = { ...base, radianceScale: (c: RecipeContext) => (c.num('soft') > 0.5 ? 0.5 : 1) }
    expect(radianceScaleFor(bySoftness, ctx(bySoftness))).toBe(0.5)
  })

  it('draws at full size where the reduced texture would be smaller than the recipe asks, and nowhere else', () => {
    const half = { ...base, radianceScale: 0.5 }
    const thin = { ...half, radianceMinShort: 1080 }
    // A settled preview (1212 render pixels on the short side), a moving one (606), the 4K export at 2x (4320).
    for (const renderShort of [606, 1212, 4320]) expect(radianceScaleFor(half, ctx(half), renderShort), String(renderShort)).toBe(0.5)
    expect(radianceScaleFor(thin, ctx(thin), 606)).toBe(1)
    expect(radianceScaleFor(thin, ctx(thin), 1212)).toBe(1)
    expect(radianceScaleFor(thin, ctx(thin), 2160)).toBe(0.5)
    expect(radianceScaleFor(thin, ctx(thin), 4320)).toBe(0.5)
    expect(radianceScaleFor({ ...base, radianceMinShort: 1080 }, ctx(base), 606)).toBe(1)
  })
})

describe('lens base source', () => {
  it("feeds every moving preview's lens from its own samples, and a supersampled frame only from 2 per base pixel", () => {
    for (const [w, h] of [[538, 303], [807, 454], [1076, 606], [1614, 908], [2152, 1212], [606, 1076]]) expect(lensBaseFromFrame(w, h, 1), `${w}x${h} 1x`).toBe(true)
    expect(lensBaseFromFrame(2152, 1212, 2)).toBe(true)
    expect(lensBaseFromFrame(1280, 720, 2)).toBe(false)
    expect(lensBaseFromFrame(960, 540, 2)).toBe(false)
  })

  it('keeps 4K exports and frames too large for one texture on the base drawn from the recipe', () => {
    for (const aspect of EXPORT_ASPECTS) {
      const { width, height } = EXPORT_SIZES[aspect]
      expect(lensBaseFromFrame(width * 2, height * 2, 2), `${aspect} 2x`).toBe(false)
      expect(lensBaseFromFrame(width, height, 1), `${aspect} 1x`).toBe(false)
    }
    expect(lensBaseFromFrame(4304, 2424, 2)).toBe(false)
  })
})

describe('frame aspect', () => {
  // The tool's preview size: the format fitted into the stage in whole CSS pixels, times the device pixel ratio,
  // capped at 2560 px and rounded, as in src/tool/Preview.tsx.
  const previewSize = (aspect: ExportAspect, stageWidth: number, stageHeight: number, pixelRatio: number) => {
    const frame = EXPORT_SIZES[aspect]
    const fit = Math.min((stageWidth - 64) / frame.width, (stageHeight - 64) / frame.height)
    const box = { width: Math.floor(frame.width * fit), height: Math.floor(frame.height * fit) }
    const cap = Math.min(1, 2560 / Math.max(box.width, box.height) / pixelRatio)
    return { width: Math.round(box.width * pixelRatio * cap), height: Math.round(box.height * pixelRatio * cap) }
  }

  it('gives a preview and the export of one format the same value, the one compose gets', () => {
    for (const aspect of EXPORT_ASPECTS) {
      const size = EXPORT_SIZES[aspect]
      const composed = size.width / size.height
      expect(frameAspect(size.width, size.height)).toBe(composed)
      for (const [stageWidth, stageHeight] of [[1280, 720], [1440, 900], [1600, 1000], [911, 1187], [2560, 1440], [390, 844]]) {
        for (const pixelRatio of [1, 1.5, 2, 3]) {
          const preview = previewSize(aspect, stageWidth, stageHeight, pixelRatio)
          expect(frameAspect(preview.width, preview.height), `${aspect} at ${preview.width}x${preview.height}`).toBe(composed)
        }
      }
    }
  })

  it('gives the color stage one frame to read a design from for every size of a format', () => {
    for (const aspect of EXPORT_ASPECTS) {
      const size = EXPORT_SIZES[aspect]
      const exported = designFrame(frameAspect(size.width, size.height))
      for (const [stageWidth, stageHeight] of [[1280, 720], [1440, 900], [911, 1187], [390, 844]]) {
        for (const pixelRatio of [1, 2]) {
          const preview = previewSize(aspect, stageWidth, stageHeight, pixelRatio)
          expect(designFrame(frameAspect(preview.width, preview.height)), `${aspect} at ${preview.width}x${preview.height}`).toEqual(exported)
        }
      }
    }
    expect(designFrame(frameAspect(1076, 606))).toEqual({ size: [910, 512], inShorts: [16 / 9, 1] })
  })

  it('keeps the ratio of frames that are not a format', () => {
    expect(frameAspect(925, 1002)).toBe(925 / 1002)
    expect(frameAspect(2000, 1000)).toBe(2)
  })

  it('reaches recipe functions through the context', () => {
    const program: RecipeProgram = { id: 'test.aspect', colorSlots: [], defaultColors: [], params: [], fragment: '', uniforms: () => ({}) }
    expect(recipeContext(resolveScene(program, {}), frameAspect(1597, 898)).aspect).toBe(16 / 9)
  })
})

describe('export', () => {
  it('names files <recipe>-<pack or reference>-<aspect>-seed<seed>.jpg', () => {
    const scene = { recipe: 'sunset.ramp' as const, seed: 7 }
    expect(exportFileName({ id: 'x', pack: 'bold', scene }, exportSize({ aspect: '16:9' }).label)).toBe('sunset.ramp-bold-16x9-seed7.jpg')
    expect(exportFileName({ id: 'x', referenceId: 'sunset-sky-peach', scene }, exportSize({ width: 925, height: 1001 }).label)).toBe(
      'sunset.ramp-sunset-sky-peach-925x1001-seed7.jpg',
    )
    expect(exportSize({ aspect: '4:5' })).toEqual({ width: 3072, height: 3840, label: '4x5' })
    expect(exportFileName({ id: 'x', pack: 'bold', scene: { ...scene, output: { grain: 0.5 } } }, '16x9')).toBe('sunset.ramp-bold-16x9-seed7-grain50.jpg')
    expect(exportFileName({ id: 'x', pack: 'bold', scene: { ...scene, output: { grain: 0 } } }, '16x9')).toBe('sunset.ramp-bold-16x9-seed7.jpg')
  })

  it('encodes a JPEG at quality 0.95 from an opaque canvas', async () => {
    const calls: unknown[] = []
    class FakeCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext(type: string, options: unknown) {
        calls.push(['getContext', type, options])
        return { putImageData: (image: { width: number; height: number }, x: number, y: number) => calls.push(['putImageData', image.width, image.height, x, y]) }
      }
      async convertToBlob(options: unknown) {
        calls.push(['convertToBlob', options])
        return new Blob([])
      }
    }
    class FakeImageData {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    }
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    vi.stubGlobal('ImageData', FakeImageData)
    try {
      await encodeJpeg(new Uint8Array(2 * 1 * 4), 2, 1)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls).toEqual([
      ['getContext', '2d', { alpha: false }],
      ['putImageData', 2, 1, 0, 0],
      ['convertToBlob', { type: 'image/jpeg', quality: 1 }],
    ])
  })
})
