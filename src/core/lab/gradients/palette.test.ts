import { describe, expect, it } from 'vitest'
import { resolveLookColorPlan } from '../colorDirection'
import {
  colorMixForPack,
  PALETTE_PACKS,
} from '@/features/background-generator/palette/registry'
import { selectedSwatches, weightedPalette, weightedPigment, weightedPigments } from './palette'

type Mix = { color: string; ratio: number; enabled: boolean }[]

function input(mix: Mix) {
  const ink = '#0064E0'
  const plan = resolveLookColorPlan({
    mix,
    ground: mix.at(-1)?.color ?? ink,
    ink,
    lookId: 'diffusion',
    complexity: .5,
  })
  return { plan, palette: plan.swatches.map(s => s.hex), ink }
}

function mix(colors: readonly string[], weights: readonly number[]): Mix {
  return colors.map((color, i) => ({ color, ratio: weights[i], enabled: true }))
}

function maxDifference(a: ArrayLike<number>, b: ArrayLike<number>) {
  expect(a.length).toBe(b.length)
  let difference = 0
  for (let i = 0; i < a.length; i++) difference = Math.max(difference, Math.abs(a[i] - b[i]))
  return difference
}

function meanRgbDifference(a: Uint8Array, b: Uint8Array) {
  expect(a.length).toBe(b.length)
  let difference = 0
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) difference += Math.abs(a[i + c] - b[i + c])
  }
  return difference / (a.length / 4 * 3)
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16 & 255, n >> 8 & 255, n & 255]
}

describe('gradient palette weights', () => {
  it.each([0, 1, 2])('fades a color continuously to removal at position %i', (position) => {
    const colors = ['#0064E0', '#FF4F00', '#25C8EE']
    const weights = [45, 40, 55]
    const removedMix = mix(colors, weights).filter((_, i) => i !== position)
    const removed = input(removedMix)
    const trace = (weight: number) => input(mix(colors, weights.map((w, i) => i === position ? weight : w)))

    for (const mixLight of [false, true]) {
      const absentRamp = weightedPalette(removed, mixLight)
      const errors = [10, 1, .1, .01, .001, .0001].map(weight =>
        meanRgbDifference(weightedPalette(trace(weight), mixLight), absentRamp))
      expect(errors[0]).toBeGreaterThan(1)
      for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeLessThanOrEqual(errors[i - 1])
      // A trace color cannot retain a full-strength interpolation stop,
      // including at the first and last texels. Allow one byte of rounding.
      expect(maxDifference(weightedPalette(trace(.0001), mixLight), absentRamp)).toBeLessThanOrEqual(1)
      expect(weightedPalette(trace(0), mixLight)).toEqual(absentRamp)
    }

    const traceSwatches = selectedSwatches(trace(.001))
    expect(traceSwatches.find(s => s.hex === colors[position])!.weight).toBeGreaterThan(0)
    expect(traceSwatches.find(s => s.hex === colors[position])!.weight).toBeLessThan(.0001)
    expect(selectedSwatches(trace(0)).map(s => s.hex)).toEqual(selectedSwatches(removed).map(s => s.hex))
    expect(weightedPigments(trace(0))).toEqual(weightedPigments(removed))
    for (const bias of [-1, 0, 1]) {
      expect(maxDifference(weightedPigment(trace(.0001), bias), weightedPigment(removed, bias)))
        .toBeLessThan(1 / 255)
      expect(weightedPigment(trace(0), bias)).toEqual(weightedPigment(removed, bias))
    }
  })

  it('excludes disabled and zero-weight rows through the actual color plan', () => {
    const active = mix(['#0064E0', '#25C8EE'], [40, 60])
    const withInactive = input([
      { color: '#FFD61E', ratio: 999, enabled: false },
      active[0],
      { color: '#FF4F00', ratio: 0, enabled: true },
      active[1],
    ])
    const expected = input(active)
    expect(selectedSwatches(withInactive)).toEqual(selectedSwatches(expected))
    expect(weightedPigments(withInactive)).toEqual(weightedPigments(expected))
    for (const light of [false, true]) expect(weightedPalette(withInactive, light)).toEqual(weightedPalette(expected, light))
    for (const bias of [-1, 0, 1]) expect(weightedPigment(withInactive, bias)).toEqual(weightedPigment(expected, bias))
  })

  it.each(PALETTE_PACKS)('preserves the exact weight ratios of $label', (pack) => {
    const rows = colorMixForPack(pack)
    const env = input(rows)
    const swatches = selectedSwatches(env)
    const pigments = weightedPigments(env)
    const total = rows.reduce((sum, row) => sum + row.ratio, 0)
    expect(swatches).toHaveLength(rows.length)
    expect(pigments).toHaveLength(rows.length * 4)
    for (let i = 0; i < rows.length; i++) {
      expect(swatches[i].weight).toBeCloseTo(rows[i].ratio / total, 12)
      expect(pigments[i * 4 + 3]).toBeCloseTo(rows[i].ratio / total, 7)
      expect(Array.from(pigments.slice(i * 4, i * 4 + 3), v => Math.round(v * 255))).toEqual(rgb(rows[i].color))
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[i].ratio === rows[j].ratio) expect(pigments[i * 4 + 3]).toBe(pigments[j * 4 + 3])
      }
    }
  })

  it.each([.0001, .1, 10, 10000])('keeps the same colors when every weight is scaled by %s', (scale) => {
    const colors = ['#0064E0', '#FFD61E', '#FF4F00', '#25C8EE']
    const weights = [40, 20, 20, 20]
    const original = input(mix(colors, weights))
    const scaled = input(mix(colors, weights.map(w => w * scale)))
    expect(maxDifference(selectedSwatches(original).map(s => s.weight), selectedSwatches(scaled).map(s => s.weight)))
      .toBeLessThan(1e-12)
    expect(maxDifference(weightedPigments(original), weightedPigments(scaled))).toBeLessThan(1e-7)
    for (const light of [false, true]) {
      expect(maxDifference(weightedPalette(original, light), weightedPalette(scaled, light))).toBeLessThanOrEqual(1)
    }
    for (const bias of [-1, 0, 1]) {
      expect(maxDifference(weightedPigment(original, bias), weightedPigment(scaled, bias))).toBeLessThan(1e-12)
    }
  })

  it.each(['#000000', '#FFFFFF', '#0064E0', '#FFD61E', '#25C8EE'])('keeps a single %s swatch exact', (color) => {
    const env = input(mix([color], [.001]))
    expect(selectedSwatches(env).map(s => s.weight)).toEqual([1])
    expect(Array.from(weightedPigments(env), (v, i) => i === 3 ? v : Math.round(v * 255))).toEqual([...rgb(color), 1])
    for (const light of [false, true]) {
      const palette = weightedPalette(env, light)
      for (let i = 0; i < palette.length; i += 4) expect(Array.from(palette.slice(i, i + 4))).toEqual([...rgb(color), 255])
    }
    for (const bias of [-1, 0, 1]) {
      expect(maxDifference(weightedPigment(env, bias), rgb(color).map(v => v / 255))).toBeLessThan(1e-12)
    }
  })

  it.each([
    { color: '#000000', bias: -1 },
    { color: '#FFFFFF', bias: 1 },
  ])('does not let trace $color control the weighted extreme', ({ color, bias }) => {
    const base = mix(['#0064E0', '#25C8EE'], [40, 60])
    for (const tail of [.2, .05]) {
      const original = weightedPigment(input(base), bias, tail)
      const extreme = (ratio: number) => weightedPigment(input([...base, { color, ratio, enabled: true }]), bias, tail)
      expect(maxDifference(original, extreme(.001))).toBeLessThan(1 / 255)
      expect(maxDifference(original, extreme(20))).toBeGreaterThan(.05)
      expect(extreme(0)).toEqual(original)
    }
  })

  it('retains selected blue endpoints for the concentrated exposure', () => {
    const pack = PALETTE_PACKS.find(pack => pack.id === 'blues')!
    const env = input(colorMixForPack(pack))
    expect(maxDifference(weightedPigment(env, -1, .05), rgb('#132682').map(v => v / 255))).toBeLessThan(1e-12)
    expect(maxDifference(weightedPigment(env, 1, .05), rgb('#0064E0').map(v => v / 255))).toBeLessThan(1e-12)
  })
})
