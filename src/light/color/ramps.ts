/**
 * Each pack color's ramp: its shades from near-black to near-white through its own hex at its own lightness, so every
 * color can show at any lightness in a clean shade of itself (owner, 2026-11-11 11:31 AM: "if you crank a slider that
 * value doesnt seem represented"). The color stage paints with these shades and the shares reading counts them as the
 * color, so both use this file. It has no imports, so Node scripts can import it as it is.
 *
 * A ramp is a few Oklab points (lightness, chroma, hue in degrees), dark to light, one of them the hex itself. Between
 * points lightness, chroma and hue change together; under the first point chroma falls with lightness to black, over
 * the last it is white. A shade outside sRGB keeps its lightness and hue and loses chroma. Where a color would go olive,
 * brown, grey or pink at its own hue, its hue turns a little: Yellow toward gold and amber in the dark, Orange-red toward
 * apricot in the light, Lime toward green, Forest toward green-teal, Plum toward magenta and mauve. Atmospheric's greys
 * keep their own cool hues, apart enough that neighbours differ at the same lightness.
 */

/** A ramp point: Oklab lightness, chroma, hue in degrees. */
export type RampPoint = readonly [number, number, number]

/** The ramps by pack hex (upper case). */
export const RAMPS: Readonly<Record<string, readonly RampPoint[]>> = {
  // Meta Blue: navy, Meta Blue, a lighter blue, pale sky blue, white.
  '#0064E0': [
    [0.12, 0.07, 263],
    [0.3, 0.14, 262],
    [0.533, 0.205, 258.8],
    [0.68, 0.16, 254],
    [0.82, 0.1, 249],
    [0.93, 0.045, 246],
    [0.99, 0, 245],
  ],
  // Cyan: deep petrol, teal-blue, Cyan, pale aqua.
  '#1FCDF0': [
    [0.12, 0.035, 224],
    [0.32, 0.075, 222],
    [0.55, 0.11, 219],
    [0.783, 0.135, 216.6],
    [0.89, 0.085, 212],
    [0.96, 0.035, 208],
    [0.99, 0, 205],
  ],
  // Yellow: deep amber, dark gold, gold, Yellow, butter. At its own hue it would go olive and mustard as it dims; at
  // orange hues with the little chroma sRGB has there it goes brown, so the dark end keeps a gold hue near sRGB's edge.
  '#FFD61E': [
    [0.14, 0.06, 60],
    [0.3, 0.13, 64],
    [0.44, 0.17, 70],
    [0.6, 0.19, 78],
    [0.75, 0.185, 87],
    [0.885, 0.177, 94.4],
    [0.95, 0.1, 98],
    [0.99, 0, 100],
  ],
  // Orange-red: maroon, deep red-orange, Orange-red, apricot, peach. At its own hue it would go salmon and pink pale.
  '#FF4F00': [
    [0.13, 0.045, 28],
    [0.32, 0.12, 29],
    [0.5, 0.185, 33],
    [0.67, 0.222, 37.4],
    [0.8, 0.14, 50],
    [0.91, 0.07, 62],
    [0.99, 0, 70],
  ],
  // Lime: deep green, green, yellow-green, Lime. At its own hue it would go olive as it dims.
  '#D6F26C': [
    [0.13, 0.035, 148],
    [0.35, 0.1, 143],
    [0.56, 0.15, 131],
    [0.76, 0.172, 122],
    [0.914, 0.162, 119.6],
    [0.96, 0.08, 116],
    [0.99, 0, 115],
  ],
  // Forest: Forest, green-teal, pale mint. Brighter at its own low chroma it would go grey-green.
  '#0F3D33': [
    [0.12, 0.022, 175],
    [0.326, 0.052, 175.5],
    [0.5, 0.08, 177],
    [0.68, 0.085, 179],
    [0.84, 0.06, 181],
    [0.95, 0.025, 183],
    [0.99, 0, 185],
  ],
  // Tan: honey, caramel, Tan, sand, cream. Its dim end keeps a golden hue with more chroma, so it reads honey and
  // caramel, not grey-brown mud.
  '#B8996E': [
    [0.14, 0.03, 62],
    [0.36, 0.08, 66],
    [0.53, 0.09, 70],
    [0.701, 0.069, 75.3],
    [0.85, 0.045, 80],
    [0.95, 0.02, 84],
    [0.99, 0, 85],
  ],
  // Plum: Plum, magenta-plum, orchid, mauve, pale pink-mauve (the purple bleed the owner liked).
  '#4A0A3C': [
    [0.12, 0.045, 337],
    [0.286, 0.11, 338.8],
    [0.45, 0.15, 340],
    [0.62, 0.13, 336],
    [0.76, 0.095, 328],
    [0.88, 0.055, 321],
    [0.97, 0.018, 316],
    [0.99, 0, 315],
  ],
  // Ice: a near-neutral cool grey all the way.
  '#F2F4F7': [
    [0.12, 0.004, 258],
    [0.5, 0.005, 258],
    [0.966, 0.005, 258.3],
    [0.995, 0, 258],
  ],
  // Steel: a blue grey, the bluest of the greys.
  '#6A7788': [
    [0.12, 0.02, 264],
    [0.35, 0.036, 262],
    [0.565, 0.031, 255.2],
    [0.76, 0.034, 260],
    [0.9, 0.022, 262],
    [0.99, 0, 262],
  ],
  // Slate: a grey between blue and teal.
  '#384753': [
    [0.12, 0.018, 240],
    [0.39, 0.028, 242.6],
    [0.6, 0.032, 236],
    [0.8, 0.026, 232],
    [0.95, 0.012, 230],
    [0.99, 0, 230],
  ],
  // Near-black: a teal grey, the greenest of the greys. Under its hex it dims in its own hue, as its light does, so a
  // dimmed Near-black still reads as Near-black, not Slate.
  '#1C2B33': [
    [0.279, 0.025, 232.1],
    [0.5, 0.034, 214],
    [0.75, 0.03, 205],
    [0.95, 0.014, 200],
    [0.99, 0, 200],
  ],
  // White: white at its own lightness; under it a cool pale blue, as white light reads through Meta Blue's haze, so a
  // dimmed White never goes neutral grey or beige beside the blue.
  '#FFFFFF': [
    [0.14, 0.03, 262],
    [0.4, 0.05, 258],
    [0.65, 0.05, 252],
    [0.8, 0.035, 250],
    [0.9, 0.008, 248],
    [0.96, 0.003, 246],
    [1, 0, 246],
  ],
}

/**
 * Ramps a pack gives its own color in place of the one by hex. Primary's Near-black is a deep navy in mid light (where
 * Sunrise's far end puts it), so Meta Blue into Near-black reads as blue going dark, not grey; Atmospheric's keeps its
 * teal grey, apart from Slate.
 */
export const PACK_RAMPS: Readonly<Record<string, Readonly<Record<string, readonly RampPoint[]>>>> = {
  primary: {
    '#1C2B33': [
      [0.279, 0.025, 232.1],
      [0.34, 0.085, 259],
      [0.42, 0.13, 261],
      [0.5, 0.115, 260],
      [0.6, 0.075, 257],
      [0.7, 0.055, 256],
      [0.84, 0.018, 253],
      [0.92, 0.004, 251],
      [0.99, 0, 250],
    ],
  },
}

type Vec3 = [number, number, number]

function oklabToLinear([L, a, b]: readonly number[]): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const inGamut = (c: readonly number[]) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4)
const toLab = (L: number, C: number, h: number): Vec3 => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]

/** The ramp for a pack hex, or undefined for a color without one; with a pack id, the pack's own ramp comes first. */
export function rampFor(hex: string, pack?: string): readonly RampPoint[] | undefined {
  const key = hex.toUpperCase()
  return (pack === undefined ? undefined : PACK_RAMPS[pack]?.[key]) ?? RAMPS[key]
}

/** The ramp's point at Oklab lightness L, before fitting into sRGB. */
function rampPoint(ramp: readonly RampPoint[], L: number): RampPoint {
  const first = ramp[0]
  if (L <= first[0]) return [L, (first[1] * Math.max(L, 0)) / first[0], first[2]]
  for (let k = 1; k < ramp.length; k++) {
    const [p, q] = [ramp[k - 1], ramp[k]]
    if (L <= q[0]) {
      const t = (L - p[0]) / Math.max(q[0] - p[0], 1e-9)
      const dh = ((q[2] - p[2] + 540) % 360) - 180
      return [L, p[1] + (q[1] - p[1]) * t, (p[2] + dh * t + 360) % 360]
    }
  }
  return [Math.min(L, 1), 0, ramp[ramp.length - 1][2]]
}

/** A pack color's shade at Oklab lightness L as Oklab lightness, chroma and hue, fitted into sRGB. */
export function rampOklch(ramp: readonly RampPoint[], L: number): Vec3 {
  const [l, C, h] = rampPoint(ramp, Math.min(1, Math.max(0, L)))
  if (inGamut(oklabToLinear(toLab(l, C, h)))) return [l, C, h]
  let lo = 0
  let hi = C
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(oklabToLinear(toLab(l, mid, h)))) lo = mid
    else hi = mid
  }
  return [l, lo, h]
}

/** A pack color's shade at Oklab lightness L, in Oklab (lightness, a, b): what the shares reading compares a pixel to. */
export function rampOklab(ramp: readonly RampPoint[], L: number): Vec3 {
  const [l, C, h] = rampOklch(ramp, L)
  return toLab(l, C, h)
}

/** A pack color's shade at Oklab lightness L in linear RGB. */
export function rampLinear(ramp: readonly RampPoint[], L: number): Vec3 {
  return oklabToLinear(rampOklab(ramp, L)).map((v) => Math.min(1, Math.max(0, v))) as Vec3
}

/** A pack color's shade with luminance y (0 to 1) in linear RGB. */
export function rampAtLuminance(ramp: readonly RampPoint[], y: number): Vec3 {
  if (y <= 0) return [0, 0, 0]
  if (y >= 1) return [1, 1, 1]
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (luminance(rampLinear(ramp, mid)) < y) lo = mid
    else hi = mid
  }
  return rampLinear(ramp, (lo + hi) / 2)
}

/**
 * The ramp as the color stage's texture row: at each step's luminance (cube-root spaced from 0 to 1), the shade's color
 * scaled to luminance 1. The last step is white.
 */
export function rampSteps(ramp: readonly RampPoint[], steps: number): Float32Array {
  const out = new Float32Array(steps * 3)
  for (let j = 0; j < steps; j++) {
    const y = Math.max((j / (steps - 1)) ** 3, 1e-4)
    const c = rampAtLuminance(ramp, y)
    const l = Math.max(luminance(c), 1e-9)
    out.set([c[0] / l, c[1] / l, c[2] / l], 3 * j)
  }
  return out
}
