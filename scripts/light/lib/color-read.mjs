// What each pixel of a frame reads as: a pack color, grey (pale bridges, white, greys), another color, or none
// (black). The reading behind color-shares.mjs and the palette check's mix rule; how the rules were set:
// scripts/light/README.md, "Color shares".

const META_BLUE = '#0064E0'

export const READ = {
  // Pixels darker than this (Oklab L) are black: none, left out of the shares.
  visible: 0.15,
  // A pixel reads as a hue rather than grey from this chroma: grey[0] up to L 0.35, rising to grey[1] from L 0.6.
  // In the dark a pack color's own dim shade has little chroma but still reads as that color (Elemental Beam's dim
  // Forest room: L 0.15 to 0.2, chroma 0.026 at Forest's hue), so for reading a pack color the limit is also at
  // most `greyDark` times the lightness; for calling a pixel another color it stays at `grey`.
  grey: [0.035, 0.05],
  greyDark: 0.12,
  // In a color's hue window a pixel reads as that color while it keeps this share of the color's own chroma at its
  // lightness (the hex dimmed in linear light below the hex, the hex mixed toward white above it). A greyer blue
  // reads as grey; a greyer warm color reads brown, khaki or olive (other).
  keep: 0.5,
  // Warm colors (hue 20 to 140) more than `purityBelow` darker than their hex keep this share of the hex's
  // chroma-to-lightness ratio, and darker than their hex turn at most `warmDimHue` degrees past it away from red:
  // dim Yellow at its own hue reads mustard or olive, dim Orange-red at amber's hue rust or brown (the palette
  // check's warm tail rule, C-025). Closer to the hex a greyer warm color is a pale tint (cream, butter, peach).
  purity: 0.85,
  purityBelow: 0.1,
  warmDimHue: 5,
  // From L 0.75 (ramping from the hex's lightness) hues under this read pink or salmon, not a warm pack color.
  pinkHue: 35,
  // Each chromatic color's hue window reaches halfway to the next pack color, and at most this far (degrees).
  window: 25,
  // Meta Blue (found by hex) toward violet: from about 15 degrees it reads indigo (palette check, compare round 11).
  violet: 12,
  // Between Meta Blue and a cyan in the pack, the hue boundary: halfway between the two hexes up to L 0.7, then 232
  // at L 0.8 and 227 from L 0.9 (palette check's pale-side rule, compare round 16): a pale blue there passes for Cyan.
  paleCyan: { from: 0.7, at: [0.8, 0.9], hue: [232, 227] },
  // Yellow, Lime and Tan only read as themselves when bright (dim they read olive or brown): down to this share of
  // their hex's light (1 stop, the palette check's warm rule). Dark pack colors (Forest, Plum): up to this many
  // times their hex's light (1 stop over); brighter, Forest reads aquamarine and Plum magenta.
  brightDown: 0.5,
  darkUp: 2,
}

const LIN = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})
const toLinear = (hex) => [1, 3, 5].map((i) => LIN[parseInt(hex.slice(i, i + 2), 16)])
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const hueOf = (a, b) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
const signedGap = (h, h0) => ((((h - h0) % 360) + 540) % 360) - 180
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t))

// A pack's reading rules: each chromatic color's hue window and lightness range, and the greys.
export function rulesFor(pack) {
  const colors = pack.colors.map((c) => {
    const [L0, a0, b0] = oklab(toLinear(c.hex))
    const C0 = Math.hypot(a0, b0)
    const h0 = hueOf(a0, b0)
    const neutral = C0 < 0.04
    const dark = L0 < 0.45
    const warm = !neutral && !dark && h0 >= 20 && h0 <= 140
    return { name: c.name, hex: c.hex, L0, C0, h0, neutral, dark, warm, blue: h0 >= 180 && h0 <= 290, brightOnly: warm && h0 >= 60, metaBlue: c.hex.toUpperCase() === META_BLUE }
  })
  const chromatic = colors.filter((c) => !c.neutral)
  for (const c of chromatic) {
    const gaps = (sign) => chromatic.filter((o) => o !== c).map((o) => (((sign * (o.h0 - c.h0)) % 360) + 360) % 360)
    c.minus = Math.min(READ.window, ...gaps(-1).map((d) => d / 2))
    c.plus = Math.min(READ.window, ...gaps(1).map((d) => d / 2), c.metaBlue ? READ.violet : Infinity)
    c.Lmin = c.brightOnly ? c.L0 * Math.cbrt(READ.brightDown) : 0
    c.Lmax = c.dark ? c.L0 * Math.cbrt(READ.darkUp) : 1
  }
  const blue = chromatic.find((c) => c.metaBlue) ?? null
  const cyan = blue ? chromatic.find((c) => !c.metaBlue && signedGap(c.h0, blue.h0) < 0 && signedGap(c.h0, blue.h0) > -60) ?? null : null
  return { colors, chromatic, blue, cyan, greys: colors.filter((c) => c.neutral).sort((x, y) => x.L0 - y.L0) }
}

// The hue where a pale blue stops reading as Meta Blue and reads as Cyan, at lightness L.
function cyanEdge(rules, L) {
  const { from, at, hue } = READ.paleCyan
  const mid = (rules.cyan.h0 + rules.blue.h0) / 2
  if (L <= at[0]) return lerp(mid, hue[0], (L - from) / (at[0] - from))
  return lerp(hue[0], hue[1], (L - at[0]) / (at[1] - at[0]))
}
// The color's own chroma at lightness L: its hex dimmed (chroma in proportion to L) or mixed toward white.
const ownChroma = (c, L) => (L <= c.L0 ? (c.C0 * L) / c.L0 : (c.C0 * Math.max(0, 1 - L)) / (1 - c.L0))
const greyLimit = (L) => lerp(READ.grey[0], READ.grey[1], (L - 0.35) / 0.25)

// What one pixel (Oklab) reads as: a pack color's name, 'grey', 'other' or 'none'.
export function readAs(rules, L, a, b) {
  if (L < READ.visible) return 'none'
  const C = Math.hypot(a, b)
  const h = hueOf(a, b)
  let best = null
  let bestGap = Infinity
  for (const c of rules.chromatic) {
    if (L < c.Lmin || L > c.Lmax) continue
    const d = signedGap(h, c.h0)
    let lo = -c.minus
    let hi = c.plus
    if (rules.cyan && c === rules.blue) lo = signedGap(cyanEdge(rules, L), c.h0)
    if (rules.cyan && c === rules.cyan) hi = signedGap(cyanEdge(rules, L), c.h0)
    if (c.warm && L < c.L0) hi = Math.min(hi, READ.warmDimHue)
    if (c.warm && L > c.L0) lo = Math.max(lo, lerp(lo, READ.pinkHue - c.h0, (L - c.L0) / Math.max(0.01, 0.75 - c.L0)))
    if (d < lo || d > hi || Math.abs(d) >= bestGap) continue
    bestGap = Math.abs(d)
    best = c
  }
  const greyish = C < greyLimit(L)
  if (best && C >= Math.min(greyLimit(L), READ.greyDark * L)) {
    const pure = !best.warm || L >= best.L0 - READ.purityBelow || C / L >= (READ.purity * best.C0) / best.L0
    if (pure && C >= READ.keep * ownChroma(best, L)) return best.name
    if (!best.blue && !greyish) return 'other'
  }
  if (!best && !greyish) return 'other'
  if (!rules.greys.length) return 'grey'
  // Atmospheric: greys and greyed blues are told apart by lightness, each up to halfway to the next.
  const g = rules.greys
  for (let i = 0; i < g.length - 1; i++) if (L < (g[i].L0 + g[i + 1].L0) / 2) return g[i].name
  return g[g.length - 1].name
}

export const LABELS = (rules) => [...rules.colors.map((c) => c.name), 'grey', 'other']

// Shares of one frame (RGB bytes, 3 per pixel) over its visibly lit pixels, and its label map when asked.
export function sharesOf(rules, rgb, n, wantMap = false) {
  const counts = Object.fromEntries([...LABELS(rules), 'none'].map((k) => [k, 0]))
  const labels = wantMap ? new Array(n) : null
  const cache = new Map()
  for (let p = 0; p < n; p++) {
    const key = (rgb[3 * p] << 16) | (rgb[3 * p + 1] << 8) | rgb[3 * p + 2]
    let label = cache.get(key)
    if (label === undefined) {
      const [L, a, b] = oklab([LIN[rgb[3 * p]], LIN[rgb[3 * p + 1]], LIN[rgb[3 * p + 2]]])
      label = readAs(rules, L, a, b)
      cache.set(key, label)
    }
    counts[label]++
    if (labels) labels[p] = label
  }
  const lit = n - counts.none
  const shares = Object.fromEntries(LABELS(rules).map((k) => [k, lit ? counts[k] / lit : 0]))
  return { shares, lit: lit / n, labels }
}

// A color mix by name, from src/light/color/mix.ts: `default`, `blue-off` (Meta Blue at 0%), or `<color>:<share>`
// such as `Cyan:0.6`, set on the default mix with the others keeping their ratios; null when the pack has no such
// color.
export function mixByName(mixes, pack, name) {
  if (name === 'default') return mixes.defaultMix(pack)
  if (name === 'blue-off') return mixes.setMetaBlue(pack, mixes.defaultMix(pack), false)
  const [color, share] = name.split(':')
  const index = pack.colors.findIndex((c) => c.name.toLowerCase() === color.toLowerCase())
  if (index < 0 || !(Number(share) >= 0)) return null
  return mixes.setShare(pack, mixes.defaultMix(pack), index, Number(share))
}
