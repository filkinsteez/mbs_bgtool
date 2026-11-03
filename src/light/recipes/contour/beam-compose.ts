import type { ColorPack } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import { toneCurve } from '../../engine/output'

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
  /** Share of seeds that pick this light. */
  weight: number
  /** Paper toe for warm lights, so their dim light reads amber, red or green instead of olive or brown. */
  toe: number
}

/**
 * Paper toe for the warm lights (Yellow, Orange-red, Lime, Tan): dim Orange-red stays red
 * instead of brown and dim Lime green instead of olive. Blue, Cyan and Ice lights keep 0.
 */
const WARM_TOE = 1

function hexByName(pack: ColorPack, name: string): string {
  const color = pack.colors.find((c) => c.name === name)
  if (!color) throw new Error(`${pack.id} has no ${name}`)
  return color.hex
}

/**
 * The lights a pack offers, the first the one the look starts from. Each keeps
 * to one hue family, and its light and haze are the color that shows as the
 * area of light. Dark pack colors (Forest, Plum, Slate, Near-black) only appear
 * as bases, never as light. Weights add up to 1.
 */
export function contourLights(pack: ColorPack): ContourLight[] {
  const blue = pack.colors[0].hex
  switch (pack.id) {
    case 'bold': {
      const cyan = hexByName(pack, 'Cyan')
      const yellow = hexByName(pack, 'Yellow')
      const orange = hexByName(pack, 'Orange-red')
      return [
        { light: cyan, haze: cyan, base: blue, baseLevel: 0.05, weight: 0.3, toe: 0 },
        { light: blue, haze: blue, base: '#000000', baseLevel: 0, weight: 0.3, toe: 0 },
        { light: yellow, haze: yellow, base: '#000000', baseLevel: 0, weight: 0.2, toe: WARM_TOE },
        { light: orange, haze: orange, base: '#000000', baseLevel: 0, weight: 0.2, toe: WARM_TOE },
      ]
    }
    case 'elemental': {
      const lime = hexByName(pack, 'Lime')
      const tan = hexByName(pack, 'Tan')
      return [
        { light: blue, haze: blue, base: hexByName(pack, 'Forest'), baseLevel: 0.15, weight: 0.4, toe: 0 },
        { light: lime, haze: lime, base: hexByName(pack, 'Forest'), baseLevel: 0.12, weight: 0.3, toe: WARM_TOE },
        { light: tan, haze: tan, base: hexByName(pack, 'Plum'), baseLevel: 0.12, weight: 0.3, toe: WARM_TOE },
      ]
    }
    case 'atmospheric':
      return [
        { light: hexByName(pack, 'Ice'), haze: hexByName(pack, 'Steel'), base: hexByName(pack, 'Near-black'), baseLevel: 0.2, weight: 0.5, toe: 0 },
        { light: hexByName(pack, 'Ice'), haze: blue, base: hexByName(pack, 'Near-black'), baseLevel: 0.18, weight: 0.3, toe: 0 },
        { light: blue, haze: blue, base: hexByName(pack, 'Slate'), baseLevel: 0.1, weight: 0.2, toe: 0 },
      ]
    default: {
      const unknown: never = pack.id
      throw new Error(`Unknown pack: ${String(unknown)}`)
    }
  }
}

/** Picks a light by the lights' weights, with one draw from the seed. */
export function pickContourLight(pack: ColorPack, random: () => number): ContourLight {
  const lights = contourLights(pack)
  let u = random()
  for (const light of lights) {
    if (u < light.weight) return light
    u -= light.weight
  }
  return lights[lights.length - 1]
}
