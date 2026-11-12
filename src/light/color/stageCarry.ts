import { blurGrid, makeNoise, mulberry32, VISIBLE, type StageGrid } from './stageFields'
import { META_BLUE_HEX } from './mix'
import type { StageColor } from './stageSolve'

// Colors by area, for any mix (Color agent, round 37).
//
// 1. Each cell gets a place along the look's own shape: the length along its outline (Contour; a cell off the outline
//    takes the place of the light that reaches it), or a place across its grain that stays the same along each band
//    (Sunrise's band stack, Rush's flow).
// 2. The colors take stretches of those places in the pack's hue order, each as long as its share of the colored area.
//    In Contour they are mirrored round Meta Blue on the main light.
// 3. Each color takes first the cells of its stretch whose light is nearest its swatch's lightness, and reaches past
//    its stretch or into other light only as far as its share of the colored area needs. The shader shows each color
//    at the design's light from its ramp (ramps.ts): paler where the light is bright, deeper where it is dim.

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
const LEAD_MORE = 0.05
const LEAD_RANGE = [0.3, 0.4] as const
/** How much nearer the swatches' lightness one way of the hue order must be to beat the way the look's parts ask for. */
const FIT_CLEAR = 0.15
/** Blur of each color's share on the grid (cells), so a hand-over is smooth where the places crowd together. */
const SHARE_BLUR = 1.5
/** Passes that set each color's pull until it covers its share. */
const PASSES = 24

export type CarryWay = { kind: 'outline' } | { kind: 'grain'; axis: readonly [number, number] | null }

/** 0 under 0, 1 over 1, smooth between. */
function smooth01(v: number): number {
  const t = Math.min(1, Math.max(0, v))
  return t * t * (3 - 2 * t)
}

/** How much a place v lies inside a stretch, with soft ends (a share of the places); the first and last stretches run on past 0 and 1. */
const STRETCH_EDGE = 0.015
function softStretch(v: number, lo: number, hi: number): number {
  const a = lo <= 1e-6 ? -1 : lo
  const b = hi >= 1 - 1e-6 ? 2 : hi
  return smooth01((v - a + STRETCH_EDGE) / (2 * STRETCH_EDGE)) * smooth01((b + STRETCH_EDGE - v) / (2 * STRETCH_EDGE))
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
function grainPlace(L: Float32Array, w: number, h: number, axis: readonly [number, number] | null, seed: number): Float32Array {
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
    const dx = axis[0] * w
    const dy = axis[1] * h
    const d = Math.hypot(dx, dy) || 1
    ux = dx / d
    uy = dy / d
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
    ux = Math.cos(theta)
    uy = Math.sin(theta)
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
 * hue order goes where, and where Meta Blue's main light is); `way`: how the look's light runs.
 */
export function carriedShares(grid: StageGrid, colors: readonly StageColor[], fields: readonly Float32Array[], seed: number, way: CarryWay): Float32Array[] {
  const { width: w, height: h } = grid
  const n = w * h
  const K = colors.length
  const L = grid.seen ?? grid.lightness
  const emit = L.map((v) => v * v * v)
  const coverage = grid.softCoverage ?? L.map((v) => (v >= VISIBLE ? 1 : 0))
  const area = coverage.reduce((a, b) => a + b, 0) > 1e-6 ? coverage : emit
  // Along Contour's outline the shares are of the light, not of the area (owner, 2026-11-11 6:12 PM: a maroon field
  // over the dark top, "looking splotchy as hell"): a cell counts by the square of its light, so the dark room and its
  // faint haze count for little and no color has to cover them to reach its share. Sunrise and Rush count by area.
  const lit = way.kind === 'outline' ? L.map((v) => v * v) : area
  const litTotal = lit.reduce((a, b) => a + b, 0) || 1
  let place: Float32Array
  if (way.kind === 'outline') {
    const along = outlinePlace(emit, w, h)
    const num = carry(Float32Array.from(emit, (e, i) => e * along[i]), w, h)
    const den = carry(emit, w, h)
    place = num.map((v, i) => (den[i] > 1e-12 ? v / den[i] : along[i]))
  } else place = grainPlace(L, w, h, way.axis, seed)
  // Each cell's place as the share of the light before it, so a stretch's length is a share of the light; and as the
  // share of the colored area before it, which only picks which end of the hue order goes where, as before.
  const byPlace = Array.from({ length: n }, (_, i) => i).sort((a, b) => place[a] - place[b])
  const areaTotal = area.reduce((a, b) => a + b, 0) || 1
  const u = new Float32Array(n)
  const byArea = new Float32Array(n)
  let run = 0
  let areaRun = 0
  for (const i of byPlace) {
    u[i] = (run + lit[i] / 2) / litTotal
    run += lit[i]
    byArea[i] = (areaRun + area[i] / 2) / areaTotal
    areaRun += area[i]
  }
  const order = colors.map((_, k) => k).sort((a, b) => colors[a].packIndex - colors[b].packIndex)
  const mbK = colors.findIndex((c) => c.hex === META_BLUE_HEX)
  const mbAt = order.indexOf(mbK)
  const mirror = way.kind === 'outline' && mbAt >= 0 && K > 1 && (mbAt === 0 || mbAt === K - 1)
  const sideColors = mirror ? (mbAt === 0 ? order.slice(1) : order.slice(0, -1).reverse()) : []
  // Where Meta Blue's main light is along the places: the light-weighted middle of the part that asks for it.
  let center = 0.5
  if (mirror) {
    let s = 0
    let m = 0
    for (let i = 0; i < n; i++) {
      const f = (fields[mbK]?.[i] ?? 0) * emit[i]
      s += f
      m += f * u[i]
    }
    if (s > 1e-12) center = m / s
  }
  // The stretches: in hue order, each as long as its share, or mirrored round Meta Blue, which sits on the main light
  // with the other colors beside it on both sides.
  const sum = colors.reduce((a, c) => a + Math.max(c.share, 1e-4), 0)
  const width = colors.map((c) => Math.max(c.share, 1e-4) / sum)
  const slots: { k: number; lo: number; hi: number }[] = []
  if (mirror) {
    const wm = width[mbK]
    const half = sideColors.reduce((a, k) => a + width[k] / 2, 0)
    const sl = half > 0 ? Math.max(0, center - wm / 2) / half : 0
    const sr = half > 0 ? Math.max(0, 1 - center - wm / 2) / half : 0
    const norm = wm + half * (sl + sr) || 1
    let x = 0
    for (const k of [...sideColors].reverse()) {
      const wd = ((width[k] / 2) * sl) / norm
      if (wd > 0) slots.push({ k, lo: x, hi: x + wd })
      x += wd
    }
    slots.push({ k: mbK, lo: x, hi: x + wm / norm })
    x += wm / norm
    for (const k of sideColors) {
      const wd = ((width[k] / 2) * sr) / norm
      if (wd > 0) slots.push({ k, lo: x, hi: x + wd })
      x += wd
    }
  } else {
    let x = 0
    for (const k of order) {
      slots.push({ k, lo: x, hi: x + width[k] })
      x += width[k]
    }
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
      const b = Math.min(nb - 1, Math.floor(byArea[i] * nb))
      sum[b] += area[i] * Lc[i] ** 3
      wsum[b] += area[i]
    }
    const binLight = Float64Array.from(sum, (v, b) => Math.cbrt(wsum[b] > 1e-9 ? v / wsum[b] : 0))
    Lc = Float32Array.from(byArea, (v) => {
      const x = Math.min(nb - 1, Math.max(0, v * nb - 0.5))
      const b0 = Math.floor(x)
      const b1 = Math.min(nb - 1, b0 + 1)
      return binLight[b0] + (binLight[b1] - binLight[b0]) * (x - b0)
    })
  }
  const Lp = grid.peak && way.kind !== 'outline' ? blurGrid(grid.peak, w, h, LIGHT_BLUR) : Lc
  const lightOff = colors.map((c, k) =>
    Float32Array.from(Lc, (lo, i) => {
      if (k === mbK) return 0
      const hi = Math.max(lo, Lp[i])
      const off = c.lightness < lo ? lo - c.lightness : c.lightness > hi ? c.lightness - hi : 0
      return (off / LIGHT_REACH) ** 2
    }),
  )
  // How much a cell counts for each color in the shares: along an outline its light; elsewhere its area, as the shares
  // reading counts it (near-black counts less, but a color's own lightness counts fully; greys count fully).
  const step = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - 0.15) / 0.2))
    return t * t * (3 - 2 * t)
  }
  const counts = colors.map((c) => (way.kind === 'outline' ? lit : Float32Array.from(L, (v, i) => area[i] * (c.chroma < 0.04 ? 1 : Math.min(1, step(v) / Math.max(1e-6, step(c.lightness)))))))
  // Which end of the hue order goes where, judged on the places by colored area as before the shares were of the
  // light: the way whose stretches lie on light clearly nearer their colors' swatches, else the way that keeps each
  // color nearer the part of the look that asks for it.
  const fit = (flip: boolean) => {
    let f = 0
    for (const s of slots)
      for (let i = 0; i < n; i++) {
        const v = flip ? 1 - byArea[i] : byArea[i]
        if (v >= s.lo && v < s.hi) f += area[i] * Math.min(4, lightOff[s.k][i])
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
      m += f * byArea[i]
    }
    if (s > 1e-12) agree += (m / s - 0.5) * (order.indexOf(k) - (K - 1) / 2)
  })
  const [kept, flipped] = [fit(false), fit(true)]
  const flip = !mirror && (Math.abs(flipped - kept) > FIT_CLEAR * Math.max(flipped, kept) ? flipped < kept : agree < 0)
  // Each color's pull, set until it covers its share of the colored area: it takes the cells nearest what it asks for
  // first and reaches further only as far as its share needs.
  const mbShare = colors[mbK]?.share ?? 0
  // Along an outline it starts and finishes leading over LEAD_RANGE; elsewhere from 40%.
  const leads = way.kind === 'outline' ? smooth01((mbShare - LEAD_RANGE[0]) / (LEAD_RANGE[1] - LEAD_RANGE[0])) : mbShare >= 0.4 ? 1 : 0
  const lead = mbK >= 0 ? Math.min(LEAD_MORE, 1 - mbShare) * leads : 0
  const aim = colors.map((c, k) => (k === mbK ? c.share + lead : (c.share * (1 - mbShare - lead)) / Math.max(1e-6, 1 - mbShare)))
  const brightest = Math.max(...emit, 1e-12)
  const source = emit.map((e) => (e * e) / brightest)
  const solve = (places: Float32Array): Float32Array[] => {
    // Along an outline each color's light is carried out from its own stretch (Research's b1), so a cell takes the
    // colors of the lights that reach it, and the dark and faint haze take the color of the light nearest them.
    const carried =
      way.kind === 'outline'
        ? colors.map((_, k) => {
            const own = slots.filter((s) => s.k === k)
            const lit = Float32Array.from(places, (v, i) => {
              let inside = 0
              for (const s of own) inside = Math.max(inside, softStretch(v, s.lo, s.hi))
              return source[i] * inside
            })
            return carry(lit, w, h)
          })
        : null
    // How far each cell is from what each color asks for: past the color's stretch, and off its swatch's lightness;
    // along an outline, how little of the color's light reaches it.
    const cost = colors.map((_, k) => {
      if (carried) {
        const mine = carried[k]
        return Float32Array.from(places, (_v, i) => {
          let all = 0
          for (const c of carried) all += c[i]
          return -Math.log((mine[i] + 1e-9) / (all + 1e-9 * K))
        })
      }
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
      const soft = raw.map((r) => blurGrid(r, w, h, SHARE_BLUR))
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
  return solve(flip ? u.map((v) => 1 - v) : u)
}

/** Half-width of the blend at a band stop (share of the colored area), at most this share of the narrower color beside it. */
const STOP_BLEND = 0.09
const STOP_BLEND_MOST = 0.4
/**
 * Light over which a cell at or near the drag's start goes from the order's dark end to the bands, so a start color's
 * deep shade (brown, olive, maroon) never fills the dim ground by the light.
 */
const START_DIM = [0.33, 0.45] as const
/** Place along the bands over which the start's dim cells stop going to the dark end. */
const START_NEAR = [0.1, 0.35] as const
/** The most of a color's share the dim ground takes; past that the ground goes on to the color before it in the order. */
const GROUND_MOST = 0.6
/** The lightest swatch (Oklab L) the dim ground goes on to: a light color there would show only its deep shade. */
const GROUND_LIGHTEST = 0.6
/** Half-width of the blend between the ground's colors (share of the ground). */
const GROUND_BLEND = 0.12
/** Place along the bands over which a cell starts to count as ahead of the light, for the far ground. */
const FAR_AHEAD = [0.35, 0.6] as const
/** Light over which a cell ahead of the light goes from the far ground (dimmer) to the light colors' bands. */
const FAR_DIM = [0.45, 0.55] as const
/** Passes that set the stops so each color covers its share as the shares reading counts it. */
const STOP_PASSES = 8

/** Whether a pack's brighter end of the hue order comes first: the half of its colors, in hue order, that is lighter. */
export function brightEndFirst(lightness: readonly number[]): boolean {
  const half = Math.floor(lightness.length / 2)
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  return mean(lightness.slice(0, half)) >= mean(lightness.slice(lightness.length - half))
}

/**
 * Sunrise's colors along its place along the bands (`mergedBands`), with no solve per cell. `place`: 0 on the horizon
 * by the light, rising along the drag arrow, negative behind the light. The colors go in the pack's hue order with the
 * pack's brighter end at the drag's start (`brightFirst`, fixed per pack, so no drag or slider turns the order round),
 * each a band across the frame as wide as its share of the colored area, counted as the shares reading counts it, with
 * a soft hand-over at each stop. Dim cells behind the light or just ahead of it are the dim ground: they go to the
 * order's dark end (Meta Blue's navy in Bold), and the bands start above them, so the start colors keep to the light;
 * where it is bright behind the light the bands carry on, so the two far hues don't blend where it shows.
 */
export function bandShares(grid: StageGrid, colors: readonly StageColor[], place: Float32Array, brightFirst: boolean): Float32Array[] {
  const { width: w, height: h } = grid
  const n = w * h
  const K = colors.length
  const L = grid.seen ?? grid.lightness
  const coverage = grid.softCoverage ?? L.map((v) => (v >= VISIBLE ? 1 : 0))
  const area = coverage.reduce((a, b) => a + b, 0) > 1e-6 ? coverage : L.map((v) => v * v * v)
  const step = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - 0.15) / 0.2))
    return t * t * (3 - 2 * t)
  }
  const counts = colors.map((c) => Float32Array.from(L, (v, i) => area[i] * (c.chroma < 0.04 ? 1 : Math.min(1, step(v) / Math.max(1e-6, step(c.lightness))))))
  const ground = Float32Array.from(place, (v, i) => (1 - smooth01((v - START_NEAR[0]) / (START_NEAR[1] - START_NEAR[0]))) * (1 - smooth01((L[i] - START_DIM[0]) / (START_DIM[1] - START_DIM[0]))))
  // Each cell's place along the bands as the share of the colored area outside the ground before it.
  const banded = Float32Array.from(area, (v, i) => v * (1 - ground[i]))
  const byPlace = Array.from({ length: n }, (_, i) => i).sort((a, b) => place[a] - place[b])
  const areaTotal = banded.reduce((a, b) => a + b, 0) || 1
  const u = new Float32Array(n)
  let run = 0
  for (const i of byPlace) {
    u[i] = (run + banded[i] / 2) / areaTotal
    run += banded[i]
  }
  const hues = colors.map((_, k) => k).sort((a, b) => colors[a].packIndex - colors[b].packIndex)
  const order = brightFirst ? hues : hues.reverse()
  const mbK = colors.findIndex((c) => c.hex === META_BLUE_HEX)
  const mbShare = colors[mbK]?.share ?? 0
  const lead = mbK >= 0 ? Math.min(LEAD_MORE, 1 - mbShare) * smooth01((mbShare - LEAD_RANGE[0]) / (LEAD_RANGE[1] - LEAD_RANGE[0])) : 0
  const aim = colors.map((c, k) => (k === mbK ? c.share + lead : (c.share * (1 - mbShare - lead)) / Math.max(1e-6, 1 - mbShare)))
  let widths = order.map((k) => Math.max(0, aim[k]))
  // The ground's colors by its light: the dark end in the dimmest, then back along the order through the dark colors,
  // each up to GROUND_MOST of its share, so a small dark end (Plum, Near-black) isn't swollen by a large ground; what
  // is left stays with the dark end.
  const groundArea = ground.reduce((a, g, i) => a + g * area[i], 0)
  const byLight = Array.from({ length: n }, (_, i) => i).sort((a, b) => L[a] - L[b])
  const v = new Float32Array(n)
  let lit = 0
  for (const i of byLight) {
    v[i] = groundArea > 1e-9 ? (lit + (ground[i] * area[i]) / 2) / groundArea : 0
    lit += ground[i] * area[i]
  }
  const back = [...order].reverse()
  const allArea = area.reduce((a, b) => a + b, 0) || 1
  let left = 1
  const lightest = back.findIndex((k, j) => j > 0 && colors[k].lightness > GROUND_LIGHTEST)
  const groundWidths = back.map((k, j) => {
    if (lightest >= 0 && j >= lightest) return 0
    const take = Math.min(left, (GROUND_MOST * Math.max(0, aim[k]) * allArea) / Math.max(groundArea, 1e-9))
    left -= take
    return take
  })
  groundWidths[0] += left
  const groundOf = colors.map(() => new Float32Array(n))
  for (let i = 0; i < n; i++) {
    let before = 1
    let x = 0
    for (let j = 0; j < K; j++) {
      x += groundWidths[j]
      const b = Math.min(GROUND_BLEND, 0.5 * Math.min(groundWidths[j], groundWidths[j + 1] ?? 1))
      const past = j === K - 1 ? 0 : b > 1e-6 ? smooth01((v[i] - x + b) / (2 * b)) : v[i] >= x ? 1 : 0
      groundOf[back[j]][i] = Math.max(0, before - past)
      before = past
    }
  }
  // The far ground: dim light ahead of the light where the bands put a light color with a hue, which there would show
  // only its deep shade (olive, brown, maroon, dark petrol), goes to the first of the dark colors that end the order
  // (Meta Blue's navy in Bold) and counts toward no share, like a black background, so the light colors keep to
  // brighter light. A light grey (Ice, White) only greys further as it dims, so it keeps its band.
  let tail = K
  while (tail > 0 && colors[order[tail - 1]].lightness <= GROUND_LIGHTEST) tail--
  const toward = tail < K ? order[tail] : -1
  const far = Float32Array.from(place, (v, i) => (toward < 0 ? 0 : smooth01((v - FAR_AHEAD[0]) / (FAR_AHEAD[1] - FAR_AHEAD[0])) * (1 - smooth01((L[i] - FAR_DIM[0]) / (FAR_DIM[1] - FAR_DIM[0])))))
  const moved = new Float32Array(n)
  let shares: Float32Array[] = colors.map(() => new Float32Array(n))
  for (let pass = 0; pass <= STOP_PASSES; pass++) {
    const sum = widths.reduce((a, b) => a + b, 0) || 1
    widths = widths.map((v) => v / sum)
    const stops: number[] = []
    let x = 0
    for (let j = 0; j < K - 1; j++) {
      x += widths[j]
      stops.push(x)
    }
    const blend = stops.map((_, j) => Math.min(STOP_BLEND, STOP_BLEND_MOST * Math.min(widths[j], widths[j + 1])))
    moved.fill(0)
    for (let i = 0; i < n; i++) {
      const g = ground[i]
      let before = 1
      for (let j = 0; j < K; j++) {
        let past = 0
        if (j < K - 1) {
          const b = blend[j]
          past = b > 1e-6 ? smooth01((u[i] - stops[j] + b) / (2 * b)) : u[i] >= stops[j] ? 1 : 0
        }
        const k = order[j]
        const band = Math.max(0, before - past)
        const off = colors[k].lightness > GROUND_LIGHTEST && colors[k].chroma >= 0.04 ? far[i] * band : 0
        shares[k][i] = (1 - g) * (band - off) + g * groundOf[k][i]
        moved[i] += (1 - g) * off
        before = past
      }
    }
    shares = shares.map((sh) => blurGrid(sh, w, h, SHARE_BLUR))
    if (pass === STOP_PASSES) {
      if (toward >= 0) {
        const farShare = blurGrid(moved, w, h, SHARE_BLUR)
        for (let i = 0; i < n; i++) shares[toward][i] += farShare[i]
      }
      break
    }
    let total = 0
    const got = order.map((k) => {
      let v = 0
      for (let i = 0; i < n; i++) v += counts[k][i] * shares[k][i]
      total += v
      return v
    })
    widths = widths.map((wd, j) => wd * Math.min(2, Math.max(0.5, (Math.max(aim[order[j]], 1e-6) / Math.max(got[j] / (total || 1), 1e-6)) ** 0.8)))
  }
  return shares
}
