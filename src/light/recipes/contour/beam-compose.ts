import type { ColorPack } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import { toneCurve } from '../../engine/output'
import { warmToe } from './curveCompose'

/** A seeded stream of numbers in [0, 1); the same seed and salt give the same stream. */
export function seededRandom(seed: number, salt: number): () => number {
  let state = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Piecewise geometric through (0, lo), (0.5, mid), (1, hi); for gains and widths (all > 0). */
export function geo(t: number, lo: number, mid: number, hi: number): number {
  const u = clamp01(t)
  return u < 0.5 ? lo * (mid / lo) ** (u * 2) : mid * (hi / mid) ** ((u - 0.5) * 2)
}

/** Rounds to 4 decimals, the precision presets and the lab sliders keep. */
export const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/** Half the frame's width and height in short-side units for an aspect (width / height). */
export function frameHalf(aspect: number): { halfW: number; halfH: number } {
  return { halfW: 0.5 * Math.max(aspect, 1), halfH: 0.5 * Math.max(1 / aspect, 1) }
}

export function luminanceOf(hex: string): number {
  const [r, g, b] = hexToLinear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Luminance of a color's light at the brightness where its brightest channel reaches 1. */
export function clipLuminanceOf(hex: string): number {
  return luminanceOf(hex) / Math.max(...hexToLinear(hex), 1e-6)
}

/**
 * Gain for one unit of scattered light: `luminance` over the haze's luminance for cool
 * lights; for warm ones `warmShare` of the haze's own clipping level, so warm light sits
 * near nominal (dimmer, it reads brown and olive).
 */
export function hazeGainFor(light: ContourLight, luminance: number, warmShare: number): number {
  if (light.toe > 0) return warmShare / Math.max(...hexToLinear(light.haze), 1e-6)
  return luminance / Math.max(luminanceOf(light.haze), 0.01)
}

/** Uniform for a dim haze param [r, g, b, below]: the color at unit luminance, and `below`. */
export function tailUniform(tail: readonly number[]): [number, number, number, number] {
  const lum = Math.max(0.2126 * tail[0] + 0.7152 * tail[1] + 0.0722 * tail[2], 1e-6)
  return [tail[0] / lum, tail[1] / lum, tail[2] / lum, tail[3] ?? 0]
}

/**
 * Dim haze param for a light: its tail color (linear) and the haze luminance below which
 * the haze drifts toward it, `below` times the haze's clipping level; off for cool lights.
 */
export function tailParam(light: ContourLight, below: number): number[] {
  if (!light.tail) return [1, 1, 1, 0]
  return [...hexToLinear(light.tail).map(round4), round4(below * clipLuminanceOf(light.haze))]
}

/**
 * The color a light (linear RGB) turns as it overexposes, at unit luminance: the camera
 * tone curve's own path to white three times past clipping, so Meta Blue goes toward a
 * pale cyan-white and never toward lavender.
 */
export function paleTarget(light: readonly number[]): [number, number, number] {
  const peak = Math.max(light[0], light[1], light[2], 1e-6)
  const c = toneCurve(light.map((v) => (3 * v) / peak))
  const lum = Math.max(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], 1e-6)
  return [c[0] / lum, c[1] / lum, c[2] / lum]
}

/** One light for a Contour image: the direct light's color, the color the haze scatters, and the base. */
export interface ContourLight {
  light: string
  haze: string
  base: string
  /** Level of the base color (dim room light); 0 with black. */
  baseLevel: number
  /** Paper toe: warm lights 0.85 (as Rim and Halo), cool lights 0. */
  toe: number
  /**
   * The color a warm light's dim haze drifts toward as it fades (amber; Forest's deep green
   * for Lime), so it never reads olive, brick or grey-brown; null for cool lights.
   */
  tail: string | null
}

/** Where a warm haze's dim tail drifts. */
const AMBER = '#FFB000'

function warm(hex: string, tail: string): { toe: number; tail: string | null } {
  const toe = warmToe(hex)
  return { toe, tail: toe > 0 ? tail : null }
}

function hexByName(pack: ColorPack, name: string): string {
  const color = pack.colors.find((c) => c.name === name)
  if (!color) throw new Error(`${pack.id} has no ${name}`)
  return color.hex
}

/**
 * The lights a pack offers, the first the one the look starts from. Each keeps
 * to one hue family, and its light and haze are the color that shows as the
 * area of light. Dark pack colors (Forest, Plum, Slate, Near-black) only appear
 * as bases, never as light. Warm lights stay on black: over a Meta Blue room,
 * Yellow haze turns grey-khaki and Orange-red pink, and Tan over Plum maroon.
 */
export function contourLights(pack: ColorPack): ContourLight[] {
  const blue = pack.colors[0].hex
  const cool = { toe: 0, tail: null }
  switch (pack.id) {
    case 'bold': {
      const cyan = hexByName(pack, 'Cyan')
      const yellow = hexByName(pack, 'Yellow')
      const orange = hexByName(pack, 'Orange-red')
      return [
        { light: cyan, haze: cyan, base: blue, baseLevel: 0.05, ...cool },
        { light: blue, haze: blue, base: '#000000', baseLevel: 0, ...cool },
        { light: yellow, haze: yellow, base: '#000000', baseLevel: 0, ...warm(yellow, AMBER) },
        { light: orange, haze: orange, base: '#000000', baseLevel: 0, ...warm(orange, AMBER) },
      ]
    }
    case 'elemental': {
      const lime = hexByName(pack, 'Lime')
      const tan = hexByName(pack, 'Tan')
      const forest = hexByName(pack, 'Forest')
      return [
        { light: blue, haze: blue, base: hexByName(pack, 'Plum'), baseLevel: 0.15, ...cool },
        { light: lime, haze: lime, base: forest, baseLevel: 0.12, ...warm(lime, forest) },
        { light: tan, haze: tan, base: '#000000', baseLevel: 0, ...warm(tan, AMBER) },
      ]
    }
    case 'atmospheric':
      return [
        { light: hexByName(pack, 'Ice'), haze: hexByName(pack, 'Steel'), base: hexByName(pack, 'Near-black'), baseLevel: 0.2, ...cool },
        { light: hexByName(pack, 'Ice'), haze: blue, base: hexByName(pack, 'Near-black'), baseLevel: 0.18, ...cool },
        { light: blue, haze: blue, base: hexByName(pack, 'Slate'), baseLevel: 0.1, ...cool },
      ]
    default: {
      const unknown: never = pack.id
      throw new Error(`Unknown pack: ${String(unknown)}`)
    }
  }
}

/**
 * Picks the light for a seed. Seeds come in blocks as long as the pack's list of lights, and
 * each block uses every light once in an order of its own, so seeds 1 to 8 show every light
 * color as the main light. It still takes one draw from the seed's stream, so the rest of
 * the scene stays as it was.
 */
export function pickContourLight(pack: ColorPack, seed: number, random: () => number): ContourLight {
  random()
  const lights = contourLights(pack)
  const n = lights.length
  const index = (((seed - 1) % n) + n) % n
  const order = lights.map((_, i) => i)
  const shuffle = seededRandom(Math.floor((seed - 1) / n), 0x11c7)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return lights[order[index]]
}
