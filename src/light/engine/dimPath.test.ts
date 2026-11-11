import { describe, expect, it } from 'vitest'
import { linearToOklch } from '../color/oklab'
import { DIM_FIRE, dimPathAt, dimPathColor, dimPaths, dimPathSteps } from './dimPath'

const ELEMENTAL = ['#0064E0', '#D6F26C', '#0F3D33', '#B8996E', '#4A0A3C']
const BOLD = ['#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00']
const ATMOSPHERIC = ['#0064E0', '#F2F4F7', '#6A7788', '#384753', '#1C2B33']
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

describe('pack dim paths', () => {
  it('turns each light color into its darker pack color of a near hue', () => {
    const [blue, lime, forest, tan, plum] = dimPaths(ELEMENTAL)
    expect(blue).toHaveLength(1)
    expect(lime).toHaveLength(2)
    expect(lime[1]).toEqual(forest[0])
    expect(forest).toHaveLength(1)
    expect(plum).toHaveLength(1)
    // Tan keeps its hue to just above Forest's lightness, then turns into Forest.
    expect(tan).toHaveLength(3)
    expect(tan[1][2]).toBeCloseTo(tan[0][2], 6)
    expect(tan[2]).toEqual(forest[0])
    const [, cyan, yellow, orange] = dimPaths(BOLD)
    expect(cyan.map((p) => Math.round(p[2]))).toEqual([Math.round(cyan[0][2]), Math.round(dimPaths(BOLD)[0][0][2])])
    expect(yellow[1]).toEqual(orange[0])
    expect(yellow.slice(2)).toEqual(DIM_FIRE)
    const [, ice, steel, slate, near] = dimPaths(ATMOSPHERIC)
    expect(ice.slice(1)).toEqual([steel[0], slate[0], near[0]])
  })

  it('turns Lime green as soon as it dims: palette-check.mjs anchor at lightness 0.6, never olive', () => {
    const lime = dimPaths(ELEMENTAL)[1]
    const mid = dimPathAt(lime, 0.6)
    expect(mid[2]).toBeGreaterThan(146)
    expect(mid[2]).toBeLessThan(154)
    expect(mid[1]).toBeGreaterThan(0.09)
    // Under lightness 0.75 the hue is past 135, out of the olive range (100 to 135 there).
    for (const L of [0.74, 0.7, 0.65]) expect(dimPathAt(lime, L)[2]).toBeGreaterThan(135)
  })

  it('gives each level its own luminance, and the steps follow the path', () => {
    const lime = dimPaths(ELEMENTAL)[1]
    const top = linearToOklch(dimPathColor(lime, 1))
    expect(top[0]).toBeCloseTo(lime[0][0], 3)
    const steps = dimPathSteps(lime, [0.5, 0.25, 0.125])
    expect(steps.map((s) => s.at)).toEqual([0.5, 0.25, 0.125])
    for (const s of steps) expect(0.2126 * s.hue[0] + 0.7152 * s.hue[1] + 0.0722 * s.hue[2]).toBeCloseTo(1, 6)
    const hues = steps.map((s) => linearToOklch(s.hue)[2])
    expect(hues[0]).toBeLessThan(hues[1])
    expect(hues[1]).toBeLessThan(hues[2])
    expect(hueGap(hues[2], dimPaths(ELEMENTAL)[2][0][2])).toBeLessThan(25)
    // A color with nothing to turn into has no steps.
    expect(dimPathSteps(dimPaths(ELEMENTAL)[0], [0.5])).toEqual([])
  })
})
