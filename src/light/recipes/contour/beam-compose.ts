import type { ColorPack } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'

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

/** The largest linear channel of a color; light clips once this channel passes 1. */
export function peakChannelOf(hex: string): number {
  return Math.max(...hexToLinear(hex))
}

/** One light for a Contour image: the direct light's color, the color the haze scatters, and the base. */
export interface ContourLight {
  light: string
  haze: string
  base: string
  /** Level of the base color (dim room light); 0 with black. */
  baseLevel: number
}

function hexByName(pack: ColorPack, name: string): string {
  const color = pack.colors.find((c) => c.name === name)
  if (!color) throw new Error(`${pack.id} has no ${name}`)
  return color.hex
}

/**
 * The lights a pack offers, in the order a seed is most likely to pick them.
 * Each keeps to one hue family. Dark pack colors (Forest, Plum, Slate,
 * Near-black) only appear as bases, never as light.
 */
export function contourLights(pack: ColorPack): ContourLight[] {
  const blue = pack.colors[0].hex
  switch (pack.id) {
    case 'bold':
      return [
        { light: hexByName(pack, 'Cyan'), haze: blue, base: blue, baseLevel: 0.025 },
        { light: blue, haze: blue, base: '#000000', baseLevel: 0 },
        { light: hexByName(pack, 'Yellow'), haze: hexByName(pack, 'Orange-red'), base: '#000000', baseLevel: 0 },
      ]
    case 'elemental':
      return [
        { light: blue, haze: blue, base: hexByName(pack, 'Forest'), baseLevel: 0.15 },
        { light: hexByName(pack, 'Lime'), haze: hexByName(pack, 'Lime'), base: hexByName(pack, 'Forest'), baseLevel: 0.12 },
        { light: hexByName(pack, 'Tan'), haze: hexByName(pack, 'Tan'), base: hexByName(pack, 'Plum'), baseLevel: 0.12 },
      ]
    case 'atmospheric':
      return [
        { light: hexByName(pack, 'Ice'), haze: hexByName(pack, 'Steel'), base: hexByName(pack, 'Near-black'), baseLevel: 0.2 },
        { light: hexByName(pack, 'Ice'), haze: blue, base: hexByName(pack, 'Near-black'), baseLevel: 0.18 },
        { light: blue, haze: blue, base: hexByName(pack, 'Slate'), baseLevel: 0.1 },
      ]
    default: {
      const unknown: never = pack.id
      throw new Error(`Unknown pack: ${String(unknown)}`)
    }
  }
}

/** Picks a light: the first one most of the time, the others less often. */
export function pickContourLight(pack: ColorPack, random: () => number): ContourLight {
  const lights = contourLights(pack)
  const u = random()
  if (u < 0.5) return lights[0]
  if (u < 0.8) return lights[1]
  return lights[2]
}
