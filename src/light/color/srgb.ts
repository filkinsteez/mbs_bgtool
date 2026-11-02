export type Rgb = [number, number, number]

/** Exact piecewise sRGB decode (IEC 61966-2-1), one channel in 0..1. */
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

/** Exact piecewise sRGB encode, one channel. Values outside 0..1 are not clamped. */
export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
}

export function srgbToLinearRgb(rgb: readonly number[]): Rgb {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]
}

export function linearToSrgbRgb(rgb: readonly number[]): Rgb {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])]
}

/** 8-bit code value (0..255) for an encoded sRGB channel; clamps and rounds to nearest. */
export function toByte(encoded: number): number {
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

export function isHex(value: string): boolean {
  return HEX_PATTERN.test(value.trim())
}

/** Parses `#RRGGBB` or `#RGB` into 8-bit code values. */
export function hexToBytes(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex.trim())
  if (!match) throw new Error(`Not a hex color: ${hex}`)
  let digits = match[1]
  if (digits.length === 3) digits = digits.replace(/./g, (d) => d + d)
  const n = parseInt(digits, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function bytesToHex(bytes: readonly number[]): string {
  return (
    '#' +
    bytes
      .slice(0, 3)
      .map((b) => Math.round(Math.min(255, Math.max(0, b))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

/** Hex to encoded sRGB channels in 0..1. */
export function hexToSrgb(hex: string): Rgb {
  const [r, g, b] = hexToBytes(hex)
  return [r / 255, g / 255, b / 255]
}

/** Encoded sRGB channels (clamped to 0..1) to the nearest hex. */
export function srgbToHex(rgb: readonly number[]): string {
  return bytesToHex([toByte(rgb[0]), toByte(rgb[1]), toByte(rgb[2])])
}

export function hexToLinear(hex: string): Rgb {
  return srgbToLinearRgb(hexToSrgb(hex))
}

/** Linear sRGB to the nearest hex; out-of-range channels are clamped after encoding. */
export function linearToHex(rgb: readonly number[]): string {
  return srgbToHex(linearToSrgbRgb(rgb))
}

export function normalizeHex(hex: string): string {
  return bytesToHex(hexToBytes(hex))
}
