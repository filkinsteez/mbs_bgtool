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
  // In the shares, near-black counts less (coordinator, 2026-11-11 9:57 AM, compare round 41): a pixel counts by a
  // smooth step on Oklab L over this range, divided by the same at its color's own hex so each hex counts fully.
  // Atmospheric's greys count fully; grey and other take the plain step. What a pixel doesn't count for is left out,
  // like the black under `visible`: the shares are of the lit, colored part of the picture.
  nearBlack: [0.15, 0.35],
}

export const LIN = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})
const toLinear = (hex) => [1, 3, 5].map((i) => LIN[parseInt(hex.slice(i, i + 2), 16)])
export function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const hueOf = (a, b) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
const signedGap = (h, h0) => ((((h - h0) % 360) + 540) % 360) - 180
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t))

// A pack's reading rules: each chromatic color's hue window and lightness range, and the greys.
// `order`: the pack's color names in hue order (HUE_ORDER in src/light/color/packs.ts). Neighbours in it blend
// through the hue between them (owner, 2026-11-11 8:14 AM), so such a blend counts for both (neighbourSplit). Without
// it no blend between far hues counts (color-edges reads that way).
export function rulesFor(pack, order = []) {
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
  const byName = (name) => chromatic.find((c) => c.name === name)
  const neighbours = order
    .slice(1)
    .map((name, k) => [byName(order[k]), byName(name)])
    .filter(([x, y]) => x && y)
  return { colors, chromatic, blue, cyan, greys: colors.filter((c) => c.neutral).sort((x, y) => x.L0 - y.L0), neighbours }
}

/**
 * A blend of two hue neighbours (rules.neighbours): an Oklab pixel whose hue lies on the short way between their hues
 * and that keeps READ.keep of their own chroma at its lightness (weighed by where it sits), and isn't grey. Returns
 * { a, b, t } with t the part of b (0 at a's hue, 1 at b's), or null. Grey, brown and blends of colors that aren't
 * neighbours stay off-pack.
 */
export function neighbourSplit(rules, L, a, b) {
  if (L < READ.visible) return null
  const C = Math.hypot(a, b)
  if (C < Math.min(greyLimit(L), READ.greyDark * L)) return null
  const h = hueOf(a, b)
  for (const [ca, cb] of rules.neighbours ?? []) {
    const span = signedGap(cb.h0, ca.h0)
    const pos = signedGap(h, ca.h0)
    if (pos * span <= 0 || Math.abs(pos) >= Math.abs(span)) continue
    const u = pos / span
    if (C >= READ.keep * ((1 - u) * ownChroma(ca, L) + u * ownChroma(cb, L))) return { a: ca.name, b: cb.name, t: u }
  }
  return null
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

const nearBlackStep = (L) => {
  const [from, to] = READ.nearBlack
  const t = Math.min(1, Math.max(0, (L - from) / (to - from)))
  return t * t * (3 - 2 * t)
}
// How much a lit pixel at Oklab lightness L counts for `label` in the shares (READ.nearBlack).
export function countWeight(rules, label, L) {
  if (label === 'none') return 0
  const c = rules.colors.find((color) => color.name === label)
  if (c?.neutral) return 1
  return c ? Math.min(1, nearBlackStep(L) / Math.max(1e-6, nearBlackStep(c.L0))) : nearBlackStep(L)
}

// Shares of one frame (RGB bytes, 3 per pixel) over its visibly lit pixels, each counted by countWeight, and its
// label map when asked. `lit` is the share of the frame that is visibly lit, uncounted.
export function sharesOf(rules, rgb, n, wantMap = false) {
  const counts = Object.fromEntries(LABELS(rules).map((k) => [k, 0]))
  const labels = wantMap ? new Array(n) : null
  const cache = new Map()
  let lit = 0
  let total = 0
  for (let p = 0; p < n; p++) {
    const key = (rgb[3 * p] << 16) | (rgb[3 * p + 1] << 8) | rgb[3 * p + 2]
    let read = cache.get(key)
    if (read === undefined) {
      const [L, a, b] = oklab([LIN[rgb[3 * p]], LIN[rgb[3 * p + 1]], LIN[rgb[3 * p + 2]]])
      const label = readAs(rules, L, a, b)
      const split = label === 'other' ? neighbourSplit(rules, L, a, b) : null
      // A blend of hue neighbours counts for both; its label stays `other`.
      const parts = split ? [[split.a, 1 - split.t], [split.b, split.t]] : label === 'none' ? [] : [[label, 1]]
      read = { label, parts: parts.map(([k, share]) => [k, share * countWeight(rules, k, L)]) }
      cache.set(key, read)
    }
    if (read.label !== 'none') lit++
    for (const [k, w] of read.parts) {
      counts[k] += w
      total += w
    }
    if (labels) labels[p] = read.label
  }
  const shares = Object.fromEntries(LABELS(rules).map((k) => [k, total > 0 ? counts[k] / total : 0]))
  return { shares, lit: lit / n, labels }
}

// How Meta Blue carries light (owner, 2026-11-09 10:05 PM: "not sure i like how blue is just a solid field and the
// rest of the colors grab attention"), over the pixels that read as Meta Blue (`labels` from sharesOf): their share
// of the visibly lit pixels; the spread of their Oklab lightness (5th to 95th percentile); the share of them within
// 0.04 of their median lightness (one flat level); how far the brightest tenth's lightness lies above Meta Blue's
// hex; and `borrowed`, the share of that brightest tenth lying within 3% of the short side of a lit pixel at least
// 0.05 lighter that reads as another chromatic color (another pack color or `other`; white, grey and Atmospheric's
// greys are left out, and so is a pale pixel near Meta Blue's hue (BLUE_LIGHT.core), its own core whitening, so a
// blue glow around its core is Meta Blue's own): Meta Blue lit only where it meets another color's light. Null for a
// pack without Meta Blue.
export function blueLight(rules, rgb, width, height, labels) {
  if (!rules.blue) return null
  const n = width * height
  const L = new Float32Array(n)
  const ownCore = new Uint8Array(n)
  const values = []
  let lit = 0
  for (let p = 0; p < n; p++) {
    if (labels[p] === 'none') continue
    lit++
    const [l, a, b] = oklab([LIN[rgb[3 * p]], LIN[rgb[3 * p + 1]], LIN[rgb[3 * p + 2]]])
    L[p] = l
    if (labels[p] === rules.blue.name) values.push([l, p])
    else if (Math.hypot(a, b) < BLUE_LIGHT.core.chroma && Math.abs(signedGap(hueOf(a, b), rules.blue.h0)) <= BLUE_LIGHT.core.hue) ownCore[p] = 1
  }
  const share = lit ? values.length / lit : 0
  if (values.length < 50) return { share, spread: 0, flat: 1, peak: -1, borrowed: 0 }
  values.sort((x, y) => x[0] - y[0])
  const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))][0]
  const median = at(0.5)
  const brightest = values.slice(Math.floor(0.9 * values.length))
  const others = new Set(rules.chromatic.filter((c) => c !== rules.blue).map((c) => c.name).concat('other'))
  const r = Math.max(1, Math.round(0.03 * Math.min(width, height)))
  let borrowed = 0
  for (const [Lb, p] of brightest) {
    const x0 = p % width
    const y0 = Math.floor(p / width)
    search: for (let y = Math.max(0, y0 - r); y <= Math.min(height - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(width - 1, x0 + r); x++) {
        const q = y * width + x
        if (others.has(labels[q]) && !ownCore[q] && L[q] >= Lb + 0.05) {
          borrowed++
          break search
        }
      }
    }
  }
  return {
    share,
    spread: at(0.95) - at(0.05),
    flat: values.filter(([v]) => Math.abs(v - median) <= 0.04).length / values.length,
    peak: brightest[Math.floor(brightest.length / 2)][0] - rules.blue.L0,
    borrowed: borrowed / brightest.length,
  }
}

// Meta Blue carries light (set by eye in compare round 24 on frames with the color stage on and off, and on the
// owner's 10:05 PM screenshot, which fails as `borrowed`) when it covers `applies` or more of the lit pixels and:
// its lightness spreads `spread` or more (even skies and haze fields spread 0.08 to 0.18; skies and glows with light
// in them 0.28 and more), its brightest tenth reaches its hex's lightness (dim navy fields stay 0.2 under it), and
// under `borrowed` of that brightest tenth sits next to another color's lighter light (the screenshot 0.43, Bold
// skies lit only where they meet Cyan or Yellow 0.36 to 0.48, frames with their own blue light 0 to 0.26). A lighter
// pixel under `core.chroma` within `core.hue` degrees of Meta Blue's hue is its own core whitening, as white is: at
// 320 px a Contour line's white-hot core mixes with its blue glow into a pale lavender-blue (hue about 271 against
// Meta Blue's 259, chroma about 0.06) that reads as `other` (compare round 32).
export const BLUE_LIGHT = { applies: 0.1, spread: 0.25, peak: 0, borrowed: 0.3, core: { hue: 20, chroma: 0.1 } }
// The reasons Meta Blue doesn't carry light (`flat`, `dim`, `borrowed`), and whether the rule applies at all.
export function blueVerdict(light) {
  if (!light || light.share < BLUE_LIGHT.applies) return { applies: false, reasons: [] }
  const reasons = []
  if (light.spread < BLUE_LIGHT.spread) reasons.push('flat')
  if (light.peak < BLUE_LIGHT.peak) reasons.push('dim')
  if (light.borrowed >= BLUE_LIGHT.borrowed) reasons.push('borrowed')
  return { applies: true, reasons }
}

// The blend-aware reading (coordinator, 2026-11-10 3:25 AM, first in color-shares.mjs --blend; fixed in compare round
// 28): a soft blend between two pack colors is partly each. A lit pixel that reads as a pack color or as `other` counts
// toward two pack colors read near it when it lies between their own shades at its lightness in Oklab a and b: by how
// close it lies to each along the line joining them, when it lies within `slack` times that line's length of it. It
// must read as one of the two or as `other`: grey and white, and a third pack color between two others (Steel between
// Meta Blue and Ice), count as they read. Two low-chroma pack colors (Atmospheric's Ice, Steel, Slate and Near-black)
// are never paired, since they differ only in lightness and their a and b are noise. Every other pixel counts as its
// label.
export const BLEND = {
  slack: 0.35,
  // Two colors whose own shades at the pixel's lightness lie closer than this in a and b are not split there: near
  // white every color's own shade is nearly white, and a hint of blue in a white would count as half Meta Blue.
  gap: 0.03,
  // A pixel reading `other` splits only when it lies `end` or more of the way from both colors: at one end it is that
  // color gone off, as the first reading has it (dim Yellow at Yellow's own hue reads olive, a bluer violet indigo).
  end: 0.1,
  // Both colors are read within `reach` of the pixel (share of the short side). Where the colors change slowly the
  // window widens to `factor` times half the distance over which they would go from one color's shade to the other's at
  // the rate they change there (Oklab a and b smoothed over `smooth` of the short side), up to `wide`; where they change
  // more slowly still (a flat area, not a transition) it stays at `reach`. Set on merged Sunrise's wide sky blends and
  // the Color agent's round 11 renders (compare round 28).
  reach: 0.03,
  factor: 1.2,
  wide: 0.15,
  smooth: 0.01,
  // A light's own path toward white is that light's color. White reads as grey in packs without a white and stays
  // grey; in a pack whose lightest color is near white (Atmospheric's Ice, Oklab L `pale` or more), an area reading as
  // that color is a light's core, not a color it blends with, when it is a line (`line` of the short side thick or
  // thinner) or a center inside one color's light (`center` thick or thinner, with `enclosed` or more of a ring `ring`
  // wide round it on one chromatic color, the frame's edge counting against). A real area of it (a pale sky, a wide
  // pale band) blends with the colors it meets. Set by eye in compare round 28: Rush's white streaks are 1% to 5% thick
  // with 97% or more of their ring on Meta Blue, Contour's rim line 1%; merged Sunrise's pale skies are 45% to 51% thick
  // with 69% to 78% of their ring on Meta Blue, and Rush's wide pale bands 14% to 18%.
  pale: 0.9,
  line: 0.025,
  center: 0.08,
  ring: 0.02,
  enclosed: 0.6,
  // A pack color takes blended pixels only in a frame where it also reads as itself, in the first reading, on one
  // 8-connected area of `own` or more of the lit pixels (a light's pale core left out). Without it a color that shows
  // only as a mix of two others (mauve where Orange-red's and Meta Blue's lights overlap, with no Orange-red of its
  // own) would count as shown (coordinator, 2026-11-10 4:13 AM). Set by eye in compare round 29: Rush Bold s2's
  // Orange-red band (16:9, owner drag) is 1.4%, a Tan streak 1.1%, and both read as their color; areas under 1% are
  // specks, corners and slivers along an edge.
  own: 0.01,
}
// A pack color's own shade at lightness L, Oklab a and b: the hex dimmed below its lightness, mixed toward white above.
function ownShade(c, L) {
  const C = ownChroma(c, L)
  const h = (c.h0 * Math.PI) / 180
  return [C * Math.cos(h), C * Math.sin(h)]
}
// One row or column of the squared distance transform (Felzenszwalb and Huttenlocher).
function distanceRow(f, n, d, v, z) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - f[v[k]] - v[k] * v[k]) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - f[v[k]] - v[k] * v[k]) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}
// Per pixel, the squared distance in pixels to the nearest pixel for which `hit(p)` is true.
function squaredDistance(hit, width, height) {
  const m = Math.max(width, height)
  const f = new Float64Array(m)
  const d = new Float64Array(m)
  const v = new Int32Array(m)
  const z = new Float64Array(m + 1)
  const out = new Float64Array(width * height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = hit(y * width + x) ? 0 : 1e12
    distanceRow(f, height, d, v, z)
    for (let y = 0; y < height; y++) out[y * width + x] = d[y]
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = out[y * width + x]
    distanceRow(f, width, d, v, z)
    for (let x = 0; x < width; x++) out[y * width + x] = d[x]
  }
  return out
}
// A box blur of radius r over one channel.
function boxBlur(src, width, height, r) {
  const tmp = new Float32Array(width * height)
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let s = 0
      let c = 0
      for (let i = Math.max(0, x - r); i <= Math.min(width - 1, x + r); i++, c++) s += src[y * width + i]
      tmp[y * width + x] = s / c
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let s = 0
      let c = 0
      for (let j = Math.max(0, y - r); j <= Math.min(height - 1, y + r); j++, c++) s += tmp[j * width + x]
      out[y * width + x] = s / c
    }
  return out
}
// The pixels of a pack's near-white color (Oklab L `pale` or more) that are a light's core: each 8-connected area
// reading as that color is a core when it is a line or a center inside one chromatic color's light.
function paleCores(rules, labels, width, height, o) {
  const n = width * height
  const core = new Uint8Array(n)
  const short = Math.min(width, height)
  const ring = Math.max(1, Math.round(o.ring * short))
  const chromatic = new Set(rules.chromatic.map((c) => c.name))
  for (const pale of rules.colors.filter((c) => c.neutral && c.L0 >= o.pale)) {
    const seen = new Uint8Array(n)
    for (let start = 0; start < n; start++) {
      if (seen[start] || labels[start] !== pale.name) continue
      const area = []
      const stack = [start]
      seen[start] = 1
      while (stack.length) {
        const p = stack.pop()
        area.push(p)
        const x = p % width
        const y = (p - x) / width
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
            const q = yy * width + xx
            if (!seen[q] && labels[q] === pale.name) {
              seen[q] = 1
              stack.push(q)
            }
          }
      }
      // The area's box, with room for the ring.
      let [x0, y0, x1, y1] = [width, height, 0, 0]
      for (const p of area) {
        const x = p % width
        const y = (p - x) / width
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
      const onEdge = area.filter((p) => {
        const x = p % width
        const y = (p - x) / width
        return x === 0 || y === 0 || x === width - 1 || y === height - 1
      }).length
      ;[x0, y0] = [Math.max(0, x0 - ring - 1), Math.max(0, y0 - ring - 1)]
      ;[x1, y1] = [Math.min(width - 1, x1 + ring + 1), Math.min(height - 1, y1 + ring + 1)]
      const bw = x1 - x0 + 1
      const bh = y1 - y0 + 1
      const at = (q) => (y0 + Math.floor(q / bw)) * width + x0 + (q % bw)
      const inside = new Uint8Array(bw * bh)
      for (const p of area) inside[(Math.floor(p / width) - y0) * bw + (p % width) - x0] = 1
      // Thickness: twice the largest distance from inside the area to outside it.
      const out = squaredDistance((q) => !inside[q], bw, bh)
      let deepest = 0
      for (let q = 0; q < bw * bh; q++) if (inside[q]) deepest = Math.max(deepest, out[q])
      const thickness = 2 * Math.sqrt(deepest)
      let isCore = thickness <= o.line * short
      if (!isCore && thickness <= o.center * short) {
        const to = squaredDistance((q) => inside[q] === 1, bw, bh)
        const counts = new Map()
        // Each pixel of the area on the frame's edge stands for the ring it would have beyond the edge.
        let total = onEdge * ring
        for (let q = 0; q < bw * bh; q++) {
          if (inside[q] || to[q] > ring * ring) continue
          const label = labels[at(q)]
          total++
          counts.set(label, (counts.get(label) ?? 0) + 1)
        }
        const most = Math.max(0, ...[...counts].filter(([label]) => chromatic.has(label)).map(([, c]) => c))
        isCore = total > 0 && most / total >= o.enclosed
      }
      if (isCore) for (const p of area) core[p] = 1
    }
  }
  return core
}
// Per pack color (index into `names`), the pixel count of its largest 8-connected area in `labels`, cores left out.
function largestAreas(names, labels, core, width, height) {
  const n = width * height
  const index = new Map(names.map((name, k) => [name, k]))
  const largest = new Float64Array(names.length)
  const seen = new Uint8Array(n)
  const stack = new Int32Array(n)
  for (let start = 0; start < n; start++) {
    const k = index.get(labels[start])
    if (seen[start] || core[start] || k === undefined) continue
    let size = 0
    let top = 0
    stack[top++] = start
    seen[start] = 1
    while (top) {
      const p = stack[--top]
      size++
      const x = p % width
      const y = (p - x) / width
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          const q = yy * width + xx
          if (!seen[q] && !core[q] && labels[q] === labels[start]) {
            seen[q] = 1
            stack[top++] = q
          }
        }
    }
    largest[k] = Math.max(largest[k], size)
  }
  return largest
}
// Shares of one frame in the blend-aware reading (`labels` from sharesOf), and `own`: each pack color's largest area
// in the first reading, as a share of the lit pixels. With `wantMap`, also each pixel's split (the indexes of its two
// pack colors, -1 when not split, and how far it lies toward the second), its window in pixels and the pale cores.
// `options` overrides BLEND's values (for checks of the reading itself).
export function blendSharesOf(rules, rgb, width, height, labels, wantMap = false, options = {}) {
  const o = { ...BLEND, ...options }
  const n = width * height
  const keys = LABELS(rules)
  const names = rules.colors.map((c) => c.name)
  const short = Math.min(width, height)
  const reach = Math.max(1, o.reach * short)
  const widest = Math.max(reach, o.wide * short)
  const lab = new Float32Array(3 * n)
  for (let p = 0; p < n; p++) lab.set(oklab([LIN[rgb[3 * p]], LIN[rgb[3 * p + 1]], LIN[rgb[3 * p + 2]]]), 3 * p)
  // How fast a and b change at each pixel (per pixel, smoothed).
  const r = Math.max(1, Math.round(o.smooth * short))
  const A = boxBlur(Float32Array.from({ length: n }, (_, p) => lab[3 * p + 1]), width, height, r)
  const B = boxBlur(Float32Array.from({ length: n }, (_, p) => lab[3 * p + 2]), width, height, r)
  const rate = new Float32Array(n)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const l = y * width + Math.max(0, x - 1)
      const rr = y * width + Math.min(width - 1, x + 1)
      const u = Math.max(0, y - 1) * width + x
      const dn = Math.min(height - 1, y + 1) * width + x
      const sx = (Math.min(width - 1, x + 1) - Math.max(0, x - 1)) || 1
      const sy = (Math.min(height - 1, y + 1) - Math.max(0, y - 1)) || 1
      rate[y * width + x] = Math.hypot((A[rr] - A[l]) / sx, (A[dn] - A[u]) / sy, (B[rr] - B[l]) / sx, (B[dn] - B[u]) / sy)
    }
  const core = paleCores(rules, labels, width, height, o)
  let lit = 0
  for (let p = 0; p < n; p++) if (labels[p] !== 'none') lit++
  const area = largestAreas(names, labels, core, width, height)
  const shown = names.map((_, k) => lit > 0 && area[k] >= o.own * lit)
  const near = names.map((name, k) => (shown[k] ? squaredDistance((p) => labels[p] === name && !core[p], width, height) : null))
  const counts = Object.fromEntries(keys.map((k) => [k, 0]))
  let total = 0
  const split = wantMap ? { a: new Int8Array(n).fill(-1), b: new Int8Array(n).fill(-1), t: new Float32Array(n), window: new Float32Array(n), core } : null
  for (let p = 0; p < n; p++) {
    const label = labels[p]
    if (label === 'none') continue
    let best = null
    if (label !== 'grey' && !core[p]) {
      const L = lab[3 * p]
      const ks = names.flatMap((_, k) => (shown[k] && near[k][p] <= widest * widest ? [k] : []))
      for (let i = 0; i < ks.length; i++)
        for (let j = i + 1; j < ks.length; j++) {
          const ci = rules.colors[ks[i]]
          const cj = rules.colors[ks[j]]
          if (ci.neutral && cj.neutral) continue
          if (label !== 'other' && label !== ci.name && label !== cj.name) continue
          const ei = ownShade(ci, L)
          const ej = ownShade(cj, L)
          const dx = ej[0] - ei[0]
          const dy = ej[1] - ei[1]
          const len = Math.hypot(dx, dy)
          if (len < o.gap) continue
          const t = Math.min(1, Math.max(0, ((lab[3 * p + 1] - ei[0]) * dx + (lab[3 * p + 2] - ei[1]) * dy) / (len * len)))
          const d = Math.hypot(lab[3 * p + 1] - ei[0] - t * dx, lab[3 * p + 2] - ei[1] - t * dy)
          if (d > o.slack * len || (label === 'other' && (t < o.end || t > 1 - o.end))) continue
          const span = (o.factor * len) / Math.max(1e-9, rate[p]) / 2
          const window = span <= widest ? Math.max(reach, span) : reach
          if (near[ks[i]][p] > window * window || near[ks[j]][p] > window * window) continue
          if (!best || d < best.d) best = { i: ks[i], j: ks[j], t, d, window }
        }
    }
    const L = lab[3 * p]
    const between = !best && label === 'other' ? neighbourSplit(rules, L, lab[3 * p + 1], lab[3 * p + 2]) : null
    const parts = best ? [[names[best.i], 1 - best.t], [names[best.j], best.t]] : between ? [[between.a, 1 - between.t], [between.b, between.t]] : [[label, 1]]
    for (const [k, share] of parts) {
      const w = share * countWeight(rules, k, L)
      counts[k] += w
      total += w
    }
    if (best && split) {
      split.a[p] = best.i
      split.b[p] = best.j
      split.t[p] = best.t
      split.window[p] = best.window
    }
  }
  return { shares: Object.fromEntries(keys.map((k) => [k, total > 0 ? counts[k] / total : 0])), own: Object.fromEntries(names.map((name, k) => [name, lit ? area[k] / lit : 0])), split }
}

// The color the mix set holds at half (SHARED, Wed 8:31 AM).
export const HALF_COLOR = { bold: 'Yellow', elemental: 'Lime', atmospheric: 'Ice' }

// A color mix by name, from src/light/color/mix.ts: `default`, `blue-off` (Meta Blue at 0%), `even` (every color the
// same share), `half` (HALF_COLOR at 50%), or `<color>:<share>` such as `Cyan:0.6`, set on the default mix with the
// others keeping their ratios; null when the pack has no such color.
export function mixByName(mixes, pack, name) {
  if (name === 'default') return mixes.defaultMix(pack)
  if (name === 'blue-off') return mixes.setMetaBlue(pack, mixes.defaultMix(pack), false)
  if (name === 'even') return mixes.mixFromShares(pack, pack.colors.map(() => 1))
  if (name === 'half') return mixByName(mixes, pack, `${HALF_COLOR[pack.id]}:0.5`)
  const [color, share] = name.split(':')
  const index = pack.colors.findIndex((c) => c.name.toLowerCase() === color.toLowerCase())
  if (index < 0 || !(Number(share) >= 0)) return null
  return mixes.setShare(pack, mixes.defaultMix(pack), index, Number(share))
}
