// Color helpers: exact sRGB transfer, hex to linear RGB, Oklab (Ottosson).

export const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
export const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055)

export function hexToLinear(hex) {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255))
}

export function linearToHex(c) {
  return (
    '#' +
    c
      .map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

export function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export const LUMA = [0.2126, 0.7152, 0.0722]
export const luminance = (c) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]

export function oklch(c) {
  const [L, a, b] = linearToOklab(c[0], c[1], c[2])
  const C = Math.hypot(a, b)
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  return [L, C, h]
}
