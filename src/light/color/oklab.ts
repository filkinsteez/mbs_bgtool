import type { Rgb } from './srgb'

/** Oklab coordinates: L in 0..1, a and b roughly -0.4..0.4. */
export type Lab = [number, number, number]
/** OkLCh coordinates: lightness, chroma, hue in degrees 0..360. */
export type Lch = [number, number, number]

// Matrices from Björn Ottosson, "A perceptual color space for image processing" (2020).

export function linearToOklab(rgb: readonly number[]): Lab {
  const [r, g, b] = rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToLinear(lab: readonly number[]): Rgb {
  const [L, a, b] = lab
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function oklabToOklch(lab: readonly number[]): Lch {
  const [L, a, b] = lab
  const hue = (Math.atan2(b, a) * 180) / Math.PI
  return [L, Math.hypot(a, b), hue < 0 ? hue + 360 : hue]
}

export function oklchToOklab(lch: readonly number[]): Lab {
  const [L, C, h] = lch
  const radians = (h * Math.PI) / 180
  return [L, C * Math.cos(radians), C * Math.sin(radians)]
}

export function linearToOklch(rgb: readonly number[]): Lch {
  return oklabToOklch(linearToOklab(rgb))
}

export function oklchToLinear(lch: readonly number[]): Rgb {
  return oklabToLinear(oklchToOklab(lch))
}

/** Euclidean distance in Oklab (L on the 0..1 scale; a just-noticeable difference is about 0.02). */
export function deltaEOk(x: readonly number[], y: readonly number[]): number {
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
