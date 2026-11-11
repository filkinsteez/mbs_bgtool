import { blurGrid, makeNoise, mulberry32, VISIBLE, type StageGrid } from './stageFields'
import { META_BLUE_HEX } from './mix'
import type { StageColor } from './stageSolve'

// Colors by area, for any mix (Color agent, round 37).
//
// 1. Each cell gets a place along the look's own shape: the length along its outline (Contour), or a place across its
//    grain that stays the same along each band (Sunrise's band stack, Rush's flow).
// 2. The colors take stretches of those places in the pack's hue order, each as long as its share of the colored area.
//    Along Contour's outline the stretches lie on the outline's own light, and its glow and haze take the colors of
//    the outline's light that reaches them.
// 3. Each color takes first the cells of its stretch whose light is nearest its swatch's lightness, and reaches past
//    its stretch or into other light only as far as its share of the colored area needs. The shader shows each color
//    at its swatch, dimmed toward black only where the design falls to black (SWATCH_DIM) and paler only in the
//    design's brightest part (colorSwatch in stageGlsl).

/** The kernel light spreads with: Gaussian sigmas in grid cells and their weights (a heavy tail, like haze). */
const CARRY_SIGMAS = [1.5, 4, 9] as const
const CARRY_WEIGHTS = [0.3, 0.35, 0.35] as const
/** The warp of the places across the grain: short sides per bump, its size, and how much more it bends far from the middle of the stack, so neighbouring boundaries don't run parallel. */
const WARP_SIZE = 0.6
const WARP_AMOUNT = 0.08
const WARP_FAN = 0.35
/** Passes of the spread along the grain, which make a place the same along each band. */
const GRAIN_PASSES = 40
/** How far past its stretch a color reaches easily, as a share of the colored area. */
const PLACE_REACH = 0.09
/** How far from its swatch's lightness a color sits easily (Oklab L). Meta Blue, the lead, sits in any light, so it carries the light on its stretch. */
const LIGHT_REACH = 0.13
/** Blur of the light a color's pull compares with its swatch (cells), so colors change along a rim, not across it. */
const LIGHT_BLUR = 3.5
/** Stretches of an outline whose light a color's pull compares with its swatch. */
const ALONG_BINS = 48
/** How much more than its share Meta Blue aims for when it leads (share 40% or more), so it stays at least 45%; it starts and finishes leading over this range of its share. */
const LEAD_MORE = 0.02
const LEAD_RANGE = [0.35, 0.45] as const
/** How much nearer the swatches' lightness one way of the hue order must be to beat the way the look's parts ask for. */
const FIT_CLEAR = 0.15
/** How far the look's parts must lean one way (in places times places along the order) to settle it alone. */
const AGREE_CLEAR = 0.1
/** Where neither way is clearly better, the two are drawn blended, over this much of the lean either way (0 to 1). */
const FLIP_BLEND = 0.5
/** Blur of each color's share on the grid (cells), so a hand-over is smooth where the places crowd together. */
const SHARE_BLUR = 1.5
/** Passes that set each color's pull until it covers its share. */
const PASSES = 24
/** The design lightness (cube root of luminance) at which the stage shows a color black, and from which it shows it at its swatch. */
export const SWATCH_DIM = [0.08, 0.45] as const
/** How far toward white the stage takes a color in the design's brightest light: a share of the way from its swatch's lightness to white. */
export const SWATCH_PALEST = 0.55

/**
 * The design lightness from which the stage shows a color with swatch lightness `own` at its swatch: SWATCH_DIM[1],
 * or the swatch's own lightness for a dark color, so a dark color shows at its swatch in light as dim as itself.
 */
export function swatchFull(own: number): number {
  return Math.min(SWATCH_DIM[1], Math.max(SWATCH_DIM[0] + 0.12, own))
}

/** At most how many times lighter than the design the stage shows a color in its falloff (bodyLevels in stage.ts). */
export const BODY_LIFT = 1.5

/**
 * About the lightness the stage shows a color with swatch lightness `own` at a design lightness (colorSwatch in
 * stageGlsl, with its falloff starting at own / BODY_LIFT): its swatch from there up, under it the design's falloff,
 * from the design's own lightness at the outer edge to the swatch, and paler from tone[2] to tone[3].
 */
function shownLightness(own: number, light: number, tone: readonly number[]): number {
  const t = Math.min(1, Math.max(0, (light - tone[2]) / Math.max(tone[3] - tone[2], 1e-6)))
  const from = own / BODY_LIFT
  const base = light < from ? light * BODY_LIFT ** (light / from) : own
  return base + SWATCH_PALEST * t * t * (3 - 2 * t) * (1 - base)
}

/**
 * `along`: the look's own place along its outline per cell (0 to 1), used instead of the estimate from the light.
 * `axis`: the look's own direction across its bands (Sunrise's sky direction, from its light up into the sky), else
 * the grain read from the light, turned to point along `toward` (Rush's run, across it). `lighterLast`: whether the
 * lighter end of the pack's hue order is its last color; that end goes at the start of the places (Sunrise's light,
 * the start of Contour's outline, Rush's side against `toward`), so no slider or drag can flip the order.
 */
export type CarryWay =
  | { kind: 'outline'; along?: Float32Array; lighterLast?: boolean }
  | { kind: 'grain'; axis: readonly [number, number] | null; toward?: readonly [number, number]; lighterLast?: boolean }

/**
 * Whether the lighter end of colors in hue order (their swatches' lightness) is the last one: lightness against place
 * in the order, over the whole pack, so a slider can't change it.
 */
export function lighterLast(lightness: readonly number[]): boolean {
  const n = lightness.length
  const mean = lightness.reduce((a, b) => a + b, 0) / Math.max(n, 1)
  return lightness.reduce((s, l, i) => s + (l - mean) * (i - (n - 1) / 2), 0) > 0
}

/** 0 under 0, 1 over 1, smooth between. */
function smooth01(v: number): number {
  const t = Math.min(1, Math.max(0, v))
  return t * t * (3 - 2 * t)
}

function carry(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length)
  CARRY_SIGMAS.forEach((sigma, s) => {
    const b = blurGrid(src, w, h, sigma)
    for (let i = 0; i < src.length; i++) out[i] += CARRY_WEIGHTS[s] * b[i]
  })
  return out
}

/** Shortest path lengths from `start` over the grid (8 neighbours), each step costing the mean of its cells' costs. */
function pathLengths(cost: Float32Array, w: number, h: number, start: number): Float64Array {
  const n = w * h
  const dist = new Float64Array(n).fill(Infinity)
  const heap: number[] = []
  const keys: number[] = []
  const push = (i: number, d: number) => {
    heap.push(i)
    keys.push(d)
    let c = heap.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (keys[p] <= keys[c]) break
      ;[heap[p], heap[c]] = [heap[c], heap[p]]
      ;[keys[p], keys[c]] = [keys[c], keys[p]]
      c = p
    }
  }
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0], keys[0]]
    const li = heap.pop() as number
    const lk = keys.pop() as number
    if (heap.length) {
      heap[0] = li
      keys[0] = lk
      let c = 0
      for (;;) {
        const a = 2 * c + 1
        const b = a + 1
        let m = c
        if (a < heap.length && keys[a] < keys[m]) m = a
        if (b < heap.length && keys[b] < keys[m]) m = b
        if (m === c) break
        ;[heap[m], heap[c]] = [heap[c], heap[m]]
        ;[keys[m], keys[c]] = [keys[c], keys[m]]
        c = m
      }
    }
    return top
  }
  dist[start] = 0
  push(start, 0)
  while (heap.length) {
    const [i, d] = pop()
    if (d > dist[i]) continue
    const x = i % w
    const y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        const nd = d + ((cost[i] + cost[j]) / 2) * (dx && dy ? Math.SQRT2 : 1)
        if (nd < dist[j]) {
          dist[j] = nd
          push(j, nd)
        }
      }
  }
  return dist
}

/** The length along the light's outline: shortest paths that run through bright cells, from one end of the light. */
function outlinePlace(emit: Float32Array, w: number, h: number): Float32Array {
  let top = 0
  let brightest = 0
  emit.forEach((e, i) => {
    if (e > top) {
      top = e
      brightest = i
    }
  })
  const cost = emit.map((e) => 1 / (e / Math.max(top, 1e-12) + 0.02))
  const fromBrightest = pathLengths(cost, w, h, brightest)
  let end = brightest
  let far = -1
  for (let i = 0; i < emit.length; i++)
    if (emit[i] > 0.05 * top && fromBrightest[i] > far) {
      far = fromBrightest[i]
      end = i
    }
  const along = pathLengths(cost, w, h, end)
  return Float32Array.from(along, (d) => (Number.isFinite(d) ? d : 0))
}

/** A place across the light's grain that stays the same along each band: a seeded, fanning warp of the axis, spread along the grain. */
function grainPlace(L: Float32Array, w: number, h: number, axis: readonly [number, number] | null, seed: number, toward?: readonly [number, number]): Float32Array {
  const n = w * h
  const short = Math.min(w, h)
  const lb = blurGrid(L, w, h, 1.5)
  const gxx = new Float32Array(n)
  const gxy = new Float32Array(n)
  const gyy = new Float32Array(n)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx = (lb[y * w + Math.min(w - 1, x + 1)] - lb[y * w + Math.max(0, x - 1)]) / 2
      const gy = (lb[Math.min(h - 1, y + 1) * w + x] - lb[Math.max(0, y - 1) * w + x]) / 2
      gxx[y * w + x] = gx * gx
      gxy[y * w + x] = gx * gy
      gyy[y * w + x] = gy * gy
    }
  let ux: number
  let uy: number
  if (axis) {
    // The look gives its sky direction in short-side units (Sunrise's `up`), and grid cells are square.
    const d = Math.hypot(axis[0], axis[1]) || 1
    ux = axis[0] / d
    uy = axis[1] / d
  } else {
    let jxx = 0
    let jxy = 0
    let jyy = 0
    for (let i = 0; i < n; i++) {
      jxx += gxx[i]
      jxy += gxy[i]
      jyy += gyy[i]
    }
    const theta = 0.5 * Math.atan2(2 * jxy, jxx - jyy)
    // The grain's direction has no sign of its own; turned along the look's, it doesn't flip as it passes upright.
    const sign = toward && Math.cos(theta) * toward[0] + Math.sin(theta) * toward[1] < 0 ? -1 : 1
    ux = sign * Math.cos(theta)
    uy = sign * Math.sin(theta)
  }
  const jx = blurGrid(gxx, w, h, 3)
  const jm = blurGrid(gxy, w, h, 3)
  const jy = blurGrid(gyy, w, h, 3)
  const scale = 0.6 / WARP_SIZE / short
  const rng = mulberry32(Math.imul(seed, 7919) + 101)
  const bend = makeNoise(rng, w * scale, h * scale)
  const fan = makeNoise(rng, w * scale, h * scale)
  let t = new Float32Array(n)
  let lo = Infinity
  let hi = -Infinity
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = ((x + 0.5) * ux + (y + 0.5) * uy) / short
      t[y * w + x] = p
      lo = Math.min(lo, p)
      hi = Math.max(hi, p)
    }
  const mid = (lo + hi) / 2
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const u = (x + 0.5) * scale
      const v = (y + 0.5) * scale
      t[i] += WARP_AMOUNT * bend(u, v) + WARP_FAN * (t[i] - mid) * fan(u, v)
    }
  // Along the grain: the direction of least change of the light, weighted by how clear that direction is.
  const ax = new Float32Array(n)
  const ay = new Float32Array(n)
  const clear = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const theta = 0.5 * Math.atan2(2 * jm[i], jx[i] - jy[i])
    ax[i] = -Math.sin(theta)
    ay[i] = Math.cos(theta)
    const sum = jx[i] + jy[i]
    clear[i] = sum > 1e-12 ? Math.hypot(jx[i] - jy[i], 2 * jm[i]) / sum : 0
  }
  const at = (src: Float32Array, fx: number, fy: number) => {
    const cx = Math.min(w - 1, Math.max(0, fx))
    const cy = Math.min(h - 1, Math.max(0, fy))
    const x0 = Math.floor(cx)
    const y0 = Math.floor(cy)
    const x1 = Math.min(w - 1, x0 + 1)
    const y1 = Math.min(h - 1, y0 + 1)
    const a = cx - x0
    const b = cy - y0
    return (src[y0 * w + x0] * (1 - a) + src[y0 * w + x1] * a) * (1 - b) + (src[y1 * w + x0] * (1 - a) + src[y1 * w + x1] * a) * b
  }
  for (let pass = 0; pass < GRAIN_PASSES; pass++) {
    const next = new Float32Array(n)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const c = clear[i]
        const ahead = at(t, x + ax[i], y + ay[i])
        const behind = at(t, x - ax[i], y - ay[i])
        next[i] = (1 - c / 2) * t[i] + (c / 4) * (ahead + behind)
      }
    t = next
  }
  return t
}

/**
 * Each color's share per grid cell. `fields[k]`: where the look's parts ask for color k (only to pick which end of the
 * hue order goes where, for a look that doesn't give it); `way`: how the look's light runs; `tone`: the design
 * lightness where the stage shows a color black, at its swatch, and where it starts and finishes going paler.
 */
export function carriedShares(grid: StageGrid, colors: readonly StageColor[], fields: readonly Float32Array[], seed: number, way: CarryWay, tone: readonly number[]): Float32Array[] {
  const { width: w, height: h } = grid
  const n = w * h
  const K = colors.length
  const L = grid.seen ?? grid.lightness
  const emit = L.map((v) => v * v * v)
  const coverage = grid.softCoverage ?? L.map((v) => (v >= VISIBLE ? 1 : 0))
  const area = coverage.reduce((a, b) => a + b, 0) > 1e-6 ? coverage : emit
  // Contour: the colors take their stretches on the outline's own light, and the glow and haze take the colors of the
  // outline's light that reaches them (owner, 2026-11-11 5:18 PM: "the banding here is really bad"). A place carried
  // into the glow from two stretches of the outline is a place between them, which laid the hue order out again as
  // arcs and gave unlit haze the colors at the outline's ends. The light is weighed squared, so the bright outline
  // outweighs the glow and haze round it.
  const fromRim = way.kind === 'outline'
  const src = fromRim ? emit.map((e) => e * e) : emit
  const place = way.kind === 'outline' ? (way.along ?? outlinePlace(emit, w, h)) : grainPlace(L, w, h, way.axis, seed, way.toward)
  // Each cell's place as the share of the colored area before it (along an outline, of the outline's light), so a
  // stretch's length is a share of the area.
  const rankBy = fromRim ? src : area
  const rankTotal = rankBy.reduce((a, b) => a + b, 0) || 1
  const byPlace = Array.from({ length: n }, (_, i) => i).sort((a, b) => place[a] - place[b])
  const u = new Float32Array(n)
  let run = 0
  for (const i of byPlace) {
    u[i] = (run + rankBy[i] / 2) / rankTotal
    run += rankBy[i]
  }
  const srcCarried = fromRim ? carry(src, w, h) : null
  const order = colors.map((_, k) => k).sort((a, b) => colors[a].packIndex - colors[b].packIndex)
  const mbK = colors.findIndex((c) => c.hex === META_BLUE_HEX)
  // The stretches: in hue order, each as long as its share, one run of the order along Contour's outline too, so its
  // colors change slowly along the rim (owner, 2026-11-11 5:18 PM).
  const sum = colors.reduce((a, c) => a + Math.max(c.share, 1e-4), 0)
  const width = colors.map((c) => Math.max(c.share, 1e-4) / sum)
  const slots: { k: number; lo: number; hi: number }[] = []
  let x = 0
  for (const k of order) {
    slots.push({ k, lo: x, hi: x + width[k] })
    x += width[k]
  }
  // How far each cell's light is from each color's swatch lightness (owner, 2026-11-11 11:44 AM: shades as close as
  // possible to the swatches). A cell spans the light from its mean to its brightest point, so a thin bright rim can
  // carry a light color.
  let Lc = blurGrid(L, w, h, LIGHT_BLUR)
  // Along an outline a cell's light is the light of its stretch of the outline (the colored area at its place), so
  // colors change along the rim and never split across it.
  if (way.kind === 'outline') {
    const nb = ALONG_BINS
    const sum = new Float64Array(nb)
    const wsum = new Float64Array(nb)
    for (let i = 0; i < n; i++) {
      const b = Math.min(nb - 1, Math.floor(u[i] * nb))
      sum[b] += rankBy[i] * Lc[i] ** 3
      wsum[b] += rankBy[i]
    }
    const binLight = Float64Array.from(sum, (v, b) => Math.cbrt(wsum[b] > 1e-9 ? v / wsum[b] : 0))
    Lc = Float32Array.from(u, (v) => {
      const x = Math.min(nb - 1, Math.max(0, v * nb - 0.5))
      const b0 = Math.floor(x)
      const b1 = Math.min(nb - 1, b0 + 1)
      return binLight[b0] + (binLight[b1] - binLight[b0]) * (x - b0)
    })
  }
  const Lp = grid.peak && way.kind !== 'outline' ? blurGrid(grid.peak, w, h, LIGHT_BLUR) : Lc
  // Meta Blue, the lead, sits in any light, so it carries the light on its stretch.
  const lightOff = colors.map((c, k) =>
    Float32Array.from(Lc, (lo, i) => {
      if (k === mbK) return 0
      const off = Math.min(Math.abs(shownLightness(c.lightness, lo, tone) - c.lightness), Math.abs(shownLightness(c.lightness, Math.max(lo, Lp[i]), tone) - c.lightness))
      return (off / LIGHT_REACH) ** 2
    }),
  )
  // How much a cell counts for each color in the shares, as the shares reading counts the color as the stage shows it
  // there (near-black counts less, but a color's own lightness counts fully; greys count fully).
  const step = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - 0.15) / 0.2))
    return t * t * (3 - 2 * t)
  }
  const counts = colors.map((c) => Float32Array.from(L, (v, i) => area[i] * (c.chroma < 0.04 ? 1 : Math.min(1, step(shownLightness(c.lightness, v, tone)) / Math.max(1e-6, step(c.lightness))))))
  // Which end of the hue order goes where. No small change of a slider or a drag may flip it, or whole colors would
  // jump from one side of the picture to the other (owner, 2026-11-11 4:40 PM: "colors pop in and out from really
  // small adjustments"). The looks in the tool give it (`lighterLast`), whatever the shares and the light. Otherwise
  // the way whose stretches lie on light clearly nearer their colors' swatches, else the way that keeps each color
  // nearer the part of the look that asks for it; where neither is clear, both ways are drawn, blended by how far
  // each leans.
  let flipBy: number
  if (way.lighterLast !== undefined) flipBy = way.lighterLast ? 1 : 0
  else {
    // The way is picked by the design's own light against the swatches' lightness, as before the stage showed colors
    // at their swatches, so a seed's colors keep their sides.
    const designOff = colors.map((c, k) =>
      Float32Array.from(Lc, (lo, i) => {
        if (k === mbK) return 0
        const hi = Math.max(lo, Lp[i])
        const off = c.lightness < lo ? lo - c.lightness : c.lightness > hi ? c.lightness - hi : 0
        return Math.min(4, (off / LIGHT_REACH) ** 2)
      }),
    )
    const fit = (flip: boolean) => {
      let f = 0
      for (const s of slots)
        for (let i = 0; i < n; i++) {
          const v = flip ? 1 - u[i] : u[i]
          if (v >= s.lo && v < s.hi) f += area[i] * designOff[s.k][i]
        }
      return f
    }
    let agree = 0
    colors.forEach((_, k) => {
      let s = 0
      let m = 0
      for (let i = 0; i < n; i++) {
        const f = (fields[k]?.[i] ?? 0) * emit[i]
        s += f
        m += f * u[i]
      }
      if (s > 1e-12) agree += (m / s - 0.5) * (order.indexOf(k) - (K - 1) / 2)
    })
    const [kept, flipped] = [fit(false), fit(true)]
    const byFit = Math.max(-1, Math.min(1, (kept - flipped) / Math.max(kept, flipped, 1e-9) / FIT_CLEAR))
    const byParts = Math.max(-1, Math.min(1, -agree / AGREE_CLEAR))
    flipBy = smooth01((byFit + (1 - Math.abs(byFit)) * byParts + FLIP_BLEND) / (2 * FLIP_BLEND))
  }
  // Each color's pull, set until it covers its share of the colored area: it takes the cells nearest what it asks for
  // first and reaches further only as far as its share needs.
  const mbShare = colors[mbK]?.share ?? 0
  const lead = mbK >= 0 ? Math.min(LEAD_MORE, 1 - mbShare) * smooth01((mbShare - LEAD_RANGE[0]) / (LEAD_RANGE[1] - LEAD_RANGE[0])) : 0
  const aim = colors.map((c, k) => (k === mbK ? c.share + lead : (c.share * (1 - mbShare - lead)) / Math.max(1e-6, 1 - mbShare)))
  const solve = (places: Float32Array): Float32Array[] => {
    // How far each cell is from what each color asks for: past the color's stretch, and off its swatch's lightness.
    const cost = colors.map((_, k) => {
      const own = slots.filter((s) => s.k === k)
      return Float32Array.from(places, (v, i) => {
        let past = Infinity
        for (const s of own) past = Math.min(past, v < s.lo ? s.lo - v : v > s.hi ? v - s.hi : 0)
        return (past / PLACE_REACH) ** 2 + lightOff[k][i]
      })
    })
    const pull = new Float64Array(K)
    const shares = colors.map(() => new Float32Array(n))
    const raw = colors.map(() => new Float32Array(n))
    for (let pass = 0; pass <= PASSES; pass++) {
      for (let i = 0; i < n; i++) {
        let top = -Infinity
        for (let k = 0; k < K; k++) top = Math.max(top, pull[k] - cost[k][i])
        let s = 0
        for (let k = 0; k < K; k++) {
          raw[k][i] = Math.exp(pull[k] - cost[k][i] - top)
          s += raw[k][i]
        }
        for (let k = 0; k < K; k++) raw[k][i] /= s
      }
      // Along an outline each cell takes the colors of the light that reaches it; elsewhere a short blur smooths the
      // hand-overs where the places crowd together.
      const soft = srcCarried ? raw.map((r) => carry(Float32Array.from(r, (v, i) => v * src[i]), w, h).map((v, i) => (srcCarried[i] > 1e-12 ? v / srcCarried[i] : 0))) : raw.map((r) => blurGrid(r, w, h, SHARE_BLUR))
      for (let i = 0; i < n; i++) {
        let s = 0
        for (let k = 0; k < K; k++) s += soft[k][i]
        for (let k = 0; k < K; k++) shares[k][i] = s > 1e-9 ? soft[k][i] / s : 1 / K
      }
      let counted = 0
      const shown = colors.map((_, k) => {
        let v = 0
        for (let i = 0; i < n; i++) v += counts[k][i] * shares[k][i]
        counted += v
        return v
      })
      for (let k = 0; k < K; k++) shown[k] /= counted || 1
      if (pass === PASSES) break
      colors.forEach((_, k) => {
        pull[k] += 0.9 * Math.log(Math.max(aim[k], 1e-4) / Math.max(shown[k], 1e-6))
      })
    }
    return shares
  }
  const kept = flipBy < 1 ? solve(u) : null
  const flipped = flipBy > 0 ? solve(u.map((v) => 1 - v)) : null
  if (!flipped) return kept as Float32Array[]
  if (!kept) return flipped
  return kept.map((s, k) => s.map((v, i) => v + flipBy * (flipped[k][i] - v)))
}
