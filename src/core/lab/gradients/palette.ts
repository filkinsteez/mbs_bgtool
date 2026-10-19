import type { LookColorPlan } from '../colorDirection'

export type GradientPaletteInput = {
  plan?: LookColorPlan
  palette: string[]
  ink: string
}

export function selectedSwatches(env: GradientPaletteInput) {
  const candidates = env.plan?.swatches.length
    ? env.plan.swatches
    : (env.palette.length ? env.palette : [env.ink]).map(hex => ({ hex, weight: 1 }))
  const active = candidates.filter(s => Number.isFinite(s.weight) && s.weight > 0)
  const colors = active.length ? active : [{ hex: env.ink, weight: 1 }]
  const total = colors.reduce((sum, s) => sum + s.weight, 0)
  return colors.map(s => {
    const n = parseInt(s.hex.replace('#', ''), 16)
    return { hex: s.hex, weight: s.weight / total, rgb: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }
  })
}

// One entry per selected color. Alpha carries its continuous weight; the RGB
// value supplies a stable field identity when another row is removed.
export function weightedPigments(env: GradientPaletteInput): Float32Array {
  return new Float32Array(selectedSwatches(env).flatMap(s => [...s.rgb, s.weight]))
}

// Tonal intervals keep small dark/light selections visible without treating
// every color as a broad contribution at every pixel.
export function pigmentIntervals(env: GradientPaletteInput): Float32Array {
  const swatches = selectedSwatches(env)
  const sorted = swatches.map((s, index) => ({ ...s, index }))
    .sort((a, b) => a.rgb[0] * .2126 + a.rgb[1] * .7152 + a.rgb[2] * .0722
      - b.rgb[0] * .2126 - b.rgb[1] * .7152 - b.rgb[2] * .0722)
  const intervals = new Float32Array(swatches.length * 2)
  let edge = 0
  for (const swatch of sorted) {
    intervals[swatch.index * 2] = edge
    edge += swatch.weight
    intervals[swatch.index * 2 + 1] = edge
  }
  return intervals
}

export function paletteLightness(env: GradientPaletteInput): number[] {
  const colors = selectedSwatches(env).map(s => ({
    value: s.rgb[0] * .2126 + s.rgb[1] * .7152 + s.rgb[2] * .0722,
    weight: s.weight,
  })).sort((a, b) => a.value - b.value)
  let edge = 0, low = 0, high = 0, mean = 0
  for (const s of colors) {
    const start = edge
    edge += s.weight
    low += s.value * Math.max(0, Math.min(edge, .05) - start) / .05
    high += s.value * Math.max(0, edge - Math.max(start, .95)) / .05
    mean += s.value * s.weight
  }
  return [low, high, mean]
}

export function weightedPigment(
  env: GradientPaletteInput,
  luminanceBias = 0,
  tailWidth = .2,
): number[] {
  const colors = selectedSwatches(env).sort((a, b) =>
    a.rgb[0] * .2126 + a.rgb[1] * .7152 + a.rgb[2] * .0722 -
    b.rgb[0] * .2126 - b.rgb[1] * .7152 - b.rgb[2] * .0722)
  const light = [0, 0, 0]
  let total = 0, value = 0, edge = 0
  for (const s of colors) {
    const start = edge
    edge += s.weight
    // Integrate a finite tail of the weighted distribution (a fifth by
    // default). Trace black or white contributes only its share of that tail.
    const w = luminanceBias < 0 ? Math.max(0, Math.min(edge, tailWidth) - start)
      : luminanceBias > 0 ? Math.max(0, edge - Math.max(start, 1 - tailWidth)) : s.weight
    for (let c = 0; c < 3; c++) light[c] += s.rgb[c] ** 2.2 * w
    value += Math.max(...s.rgb) * w
    total += w
  }
  const rgb = light.map(v => (v / total) ** (1 / 2.2))
  const gain = value / total / Math.max(1e-12, ...rgb)
  return rgb.map(v => v * gain)
}

// Integral of a compact, smooth blur kernel. Integrating each color's finite
// interval makes its contribution approach zero with its weight, even at the
// ends of the ramp. Fixed interpolation stops do not have that property.
function coverage(x: number) {
  const u = Math.max(-1, Math.min(1, x))
  return .5 + .9375 * (u - 2 / 3 * u ** 3 + .2 * u ** 5)
}

export function weightedPalette(
  env: GradientPaletteInput,
  mixLight = false,
  radius = .26,
): Uint8Array {
  let edge = 0
  const intervals = selectedSwatches(env).map(s => {
    const start = edge
    edge += s.weight
    return { ...s, start, end: edge }
  })
  const data = new Uint8Array(512 * 4)
  for (let i = 0; i < 512; i++) {
    const t = i / 511, rgb = [0, 0, 0]
    let total = 0, value = 0
    for (const s of intervals) {
      const w = coverage((s.end - t) / radius) - coverage((s.start - t) / radius)
      for (let c = 0; c < 3; c++) rgb[c] += (mixLight ? s.rgb[c] ** 2.2 : s.rgb[c]) * w
      value += Math.max(...s.rgb) * w
      total += w
    }
    const mixed = rgb.map(v => mixLight ? (v / total) ** (1 / 2.2) : v / total)
    const gain = mixLight ? value / total / Math.max(1e-12, ...mixed) : 1
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(mixed[c] * gain * 255)
    data[i * 4 + 3] = 255
  }
  return data
}
