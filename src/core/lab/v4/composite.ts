import type { SymbolFieldOptions, V2Env } from '../v2/system'
import type { Field } from '../field'
import { chan } from '@/core/organic/random'
import { renderPattern } from '../v2/pattern'
import { renderMandala } from '../v2/mandala'
import { renderStitch } from '../v2/stitch'
import { renderDither } from '../v2/dither'

// 'Composite' — the four V3 systems negotiate ONE frame. A seeded guillotine
// partition (2-3 zones at complexity 0, 4-5 at 0.5, up to 7 at 1) deals each
// zone one of pattern/mandala/stitch/dither. Each DISTINCT assigned system
// renders once, full-frame, into a reused offscreen layer with the SHARED
// env — same seed, palette, plan, mark field and motion inputs — then the
// layers meet through static zone masks whose every boundary is a designed
// handoff band: a chunky Bayer-ordered dither crossfade (~2-4% of the min
// dimension, width breathing along the seam) where the two systems' pixels
// interleave. Never a hard unstyled edge, never an alpha blur.
//
// The mark reads ACROSS the composition: mandala, stitch and dither see the
// SAME seeded placement of the canonical geometry (their per-system offset/
// tilt/scale deals are overridden through a symbolField wrapper — the crop
// machinery itself, never the geometry), so one mark carries through the
// zone changes in three languages — ringed, beaded, toned. Pattern zones
// weave the mark's arc DNA as cloth (its tile-crop machinery keeps its
// native freedom; tiles never reveal placement), and the deal biases
// pattern toward zones the mark misses so the figure systems own the form.
//
// Motion: the sub-systems already close the loop exactly and every term of
// theirs scales with motionAmount; zone geometry, assignments and masks are
// static per (seed, size, complexity) and the composite adds NO term of its
// own — the loop seam and the phase-0 thumbnail identity are inherited.
//
// 3D material mode flows through untouched: env.luminance (and the depth/
// normal fields, passed through by spread) reach every sub-system, so the
// captured model reads through all zones in their own material branches.
//
// Randomness: 'v4.composite.*' channels only.

const C = 'v4.composite.'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// the negotiating systems, in the fixed order the deal indexes into
const SYSTEMS = [renderPattern, renderMandala, renderStitch, renderDither] as const
const PATTERN = 0
const STITCH = 2

// 8x8 ordered Bayer matrix for the seam crossfade
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]

type Zone = { x: number; y: number; w: number; h: number; id: number }

// ---------------------------------------------------------------------------
// Partition: seeded guillotine, integer cuts (zones tile the frame exactly)
// ---------------------------------------------------------------------------

function partition(seed: number, w: number, h: number, complexity: number): Zone[] {
  const zones: Zone[] = [{ x: 0, y: 0, w, h, id: 1 }]
  let nextId = 2
  const target = Math.max(
    2,
    Math.min(7, Math.round(1.8 + complexity * 3.9 + chan(seed, 0, C + 'zones') * 1.2)),
  )
  // zones stay big — each hosts a whole system and must read as one
  const minSide = Math.min(w, h) * 0.24
  while (zones.length < target) {
    let best = -1
    let bestArea = 0
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i]
      if (Math.max(z.w, z.h) < minSide * 2) continue
      const area = z.w * z.h
      if (area > bestArea) {
        bestArea = area
        best = i
      }
    }
    if (best < 0) break
    const z = zones[best]
    // split the longer axis; near-square leaves sometimes flip so the cuts
    // don't degenerate into even slicing
    let alongW = z.w >= z.h
    if (
      Math.max(z.w, z.h) / Math.max(1, Math.min(z.w, z.h)) < 1.45 &&
      chan(seed, z.id, C + 'axis') < 0.35
    ) {
      alongW = !alongW
    }
    if ((alongW ? z.w : z.h) < minSide * 2) alongW = !alongW
    const len = alongW ? z.w : z.h
    const pos = 0.34 + chan(seed, z.id, C + 'cut') * 0.32
    const cut = Math.max(
      Math.ceil(minSide),
      Math.min(Math.floor(len - minSide), Math.round(len * pos)),
    )
    let a: Zone
    let b: Zone
    if (alongW) {
      a = { x: z.x, y: z.y, w: cut, h: z.h, id: nextId++ }
      b = { x: z.x + cut, y: z.y, w: z.w - cut, h: z.h, id: nextId++ }
    } else {
      a = { x: z.x, y: z.y, w: z.w, h: cut, id: nextId++ }
      b = { x: z.x, y: z.y + cut, w: z.w, h: z.h - cut, id: nextId++ }
    }
    zones.splice(best, 1, a, b)
  }
  return zones
}

// rectangles sharing a seam segment (guillotine cuts are integer, keep an
// epsilon anyway) — the graph the system deal must properly color
function adjacency(zones: Zone[]): number[][] {
  const eps = 0.5
  const adj: number[][] = zones.map(() => [])
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]
      const b = zones[j]
      const xTouch = Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps
      const yTouch = Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps
      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > eps
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > eps
      if ((xTouch && yOverlap) || (yTouch && xOverlap)) {
        adj[i].push(j)
        adj[j].push(i)
      }
    }
  }
  return adj
}

// ---------------------------------------------------------------------------
// System deal: weight-dealt via chan, seam-sharing neighbors always differ
// ---------------------------------------------------------------------------

// Backtracking over seeded preference orders. The zone adjacency graph is
// planar, so with four systems a proper coloring always exists (the greedy
// tail is a belt-and-braces fallback that keeps neighbor-difference where
// the pool allows).
function assignSystems(seed: number, zones: Zone[], coverage: number[]): number[] {
  const flavor = [0, 1, 2, 3].map((s) => 0.55 + 0.9 * chan(seed, s + 1, C + 'sysWeight'))
  const adj = adjacency(zones)
  const order = zones
    .map((_, i) => i)
    .sort((a, b) => zones[b].w * zones[b].h - zones[a].w * zones[a].h || zones[a].id - zones[b].id)
  const prefs: number[][] = zones.map((z, i) => {
    const cov = coverage[i]
    const score = [0, 1, 2, 3].map((s) => {
      let w = flavor[s] * (0.7 + 0.6 * chan(seed, z.id * 8 + s, C + 'deal'))
      // pattern is the ground cloth — steer it off the mark's zones so the
      // figure systems (stitch first) carry the form
      if (s === PATTERN) w *= 1.55 - 1.3 * Math.min(1, cov * 2.5)
      if (s === STITCH) w *= 0.7 + 1.1 * Math.min(1, cov * 2.2)
      return w
    })
    return [0, 1, 2, 3].sort((a, b) => score[b] - score[a])
  })
  const assign = new Array<number>(zones.length).fill(-1)
  const solve = (k: number): boolean => {
    if (k === order.length) return true
    const i = order[k]
    for (const s of prefs[i]) {
      let ok = true
      for (const j of adj[i]) {
        if (assign[j] === s) {
          ok = false
          break
        }
      }
      if (!ok) continue
      assign[i] = s
      if (solve(k + 1)) return true
      assign[i] = -1
    }
    return false
  }
  if (!solve(0)) {
    for (let k = 0; k < order.length; k++) {
      const i = order[k]
      if (assign[i] >= 0) continue
      const used = new Set<number>()
      for (const j of adj[i]) if (assign[j] >= 0) used.add(assign[j])
      assign[i] = prefs[i].find((s) => !used.has(s)) ?? prefs[i][0]
    }
  }
  return assign
}

// ---------------------------------------------------------------------------
// Shared mark placement + composite-level field memo
// ---------------------------------------------------------------------------

type SharedPlacement = { scale: number; offsetX: number; offsetY: number }

// One seeded placement of the canonical geometry for the whole frame —
// slightly large, gently off-center, canonical orientation — so the figure
// systems agree on where the mark is and its form carries across zones.
function sharedPlacement(seed: number): SharedPlacement {
  const dir = chan(seed, 9, C + 'markDir') * Math.PI * 2
  const dist = 0.06 + 0.22 * chan(seed, 9, C + 'markDist')
  return {
    scale: 1.04 + 0.3 * chan(seed, 9, C + 'markScale'),
    offsetX: Math.cos(dir) * dist,
    offsetY: Math.sin(dir) * dist,
  }
}

// The composite drives all four systems in one frame, which asks the shared
// symbolField for more variants than system.ts's small cache holds — without
// a memo here every frame would rebuild fields from scratch. Field closures
// are pure, so holding them past the underlying cache's churn is safe. A few
// buckets, keyed by seed+size, so alternating surfaces (2D preview, 3D
// overlay, export) don't evict each other.
const fieldMemos = new Map<string, Map<string, Field>>()

function memoField(env: V2Env, options: SymbolFieldOptions): Field {
  const mk = `${env.seed}|${env.outW}x${env.outH}`
  let bucket = fieldMemos.get(mk)
  if (!bucket) {
    if (fieldMemos.size >= 3) {
      const oldest = fieldMemos.keys().next().value
      if (oldest !== undefined) fieldMemos.delete(oldest)
    }
    bucket = new Map()
    fieldMemos.set(mk, bucket)
  }
  const k = `${options.scale ?? '.'}|${options.offsetX ?? '.'}|${options.offsetY ?? '.'}|${
    options.rotation ?? '.'
  }|${options.softness ?? '.'}`
  let field = bucket.get(k)
  if (!field) {
    if (bucket.size > 40) bucket.clear()
    field = env.symbolField(options)
    bucket.set(k, field)
  }
  return field
}

// The env a sub-system renders with: shared everything, plus the wrapped
// symbolField. Figure systems get the one shared placement (their softness
// choices pass through — mandala's ramp stack stays a ramp); pattern keeps
// its native crop deal. depth/normal fields pass through untouched.
function envFor(env: V2Env, sys: number, shared: SharedPlacement): V2Env {
  if (sys === PATTERN) {
    return { ...env, symbolField: (options: SymbolFieldOptions = {}) => memoField(env, options) }
  }
  return {
    ...env,
    symbolField: (options: SymbolFieldOptions = {}) =>
      memoField(env, {
        ...options,
        scale: shared.scale,
        offsetX: shared.offsetX,
        offsetY: shared.offsetY,
        rotation: 0,
      }),
  }
}

// ---------------------------------------------------------------------------
// Geometry cache: zones, deal, and the per-system masks with dithered seams
// ---------------------------------------------------------------------------

type Geometry = {
  key: string
  systems: number[] // distinct dealt system ids, ascending
  masks: HTMLCanvasElement[] // parallel to systems; binary alpha
  // per system: its zones' rects padded past the widest seam half-band, so
  // the layer render can be clipped to the pixels its mask can keep. Every
  // kept pixel sits >=2px inside the clip edge, so clipping changes nothing
  // the mask lets through — it only skips rasterizing the rest.
  clipRects: number[][] // parallel to systems; flattened x,y,w,h runs
}

// a few geometries, keyed by seed+size+complexity, so alternating surfaces
// (2D preview, 3D overlay, export) don't rebuild each other's masks
const geometries = new Map<string, Geometry>()

// offscreen layer per system id, reused across frames (at most 4 alive)
const layerCanvases: (HTMLCanvasElement | null)[] = [null, null, null, null]

function buildGeometry(env: V2Env, key: string): Geometry {
  const { outW, outH, seed } = env
  const minDim = Math.min(outW, outH)
  const complexity = clamp01(env.complexity)
  const shared = sharedPlacement(seed)

  const zones = partition(seed, outW, outH, complexity)

  // how much of each zone the shared mark occupies (sharp field), for the deal
  const coverField = memoField(env, {
    scale: shared.scale,
    offsetX: shared.offsetX,
    offsetY: shared.offsetY,
    rotation: 0,
    softness: 0.3,
  })
  const S = 10
  const coverage = zones.map((z) => {
    let on = 0
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        if (coverField(z.x + ((i + 0.5) / S) * z.w, z.y + ((j + 0.5) / S) * z.h) >= 0.5) on++
      }
    }
    return on / (S * S)
  })
  const assign = assignSystems(seed, zones, coverage)

  // exact zone index per pixel (guillotine tiles the frame)
  const zoneMap = new Uint8Array(outW * outH)
  zones.forEach((z, i) => {
    for (let y = z.y; y < z.y + z.h; y++) {
      zoneMap.fill(i, y * outW + z.x, y * outW + z.x + z.w)
    }
  })

  const systems = [...new Set(assign)].sort((a, b) => a - b)
  const maskIndex = new Int8Array(4).fill(-1)
  systems.forEach((s, k) => {
    maskIndex[s] = k
  })

  // seam handoff band: ~2.2-3.8% of the min dimension, breathing 0.7x-1.4x
  // along the seam so the crossfade edge is organic, not ruled
  const bandPx = Math.max(6, Math.round(minDim * (0.022 + 0.016 * chan(seed, 3, C + 'band'))))
  const q = Math.max(2, Math.round(bandPx / 8)) // chunky Bayer cell size
  const lambda = Math.max(24, minDim * 0.12)
  const ease = (t: number) => t * t * (3 - 2 * t)
  const seamNoise = (pair: number, t: number): number => {
    const i = Math.floor(t)
    const f = ease(t - i)
    const a = chan(seed, pair * 4096 + (i & 2047), C + 'seamW')
    const b = chan(seed, pair * 4096 + ((i + 1) & 2047), C + 'seamW')
    return a + (b - a) * f
  }
  const halfMax = bandPx * 0.72 // widest half-band (0.7x-1.4x width factor)

  const masks = systems.map(() => {
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    return canvas
  })
  const maskCtxs = masks.map((m) => m.getContext('2d'))
  const imgs = maskCtxs.map((mctx) => mctx?.createImageData(outW, outH) ?? null)

  for (let y = 0; y < outH; y++) {
    const row = y * outW
    const bayerRow = BAYER8[((y / q) | 0) & 7]
    for (let x = 0; x < outW; x++) {
      const zi = zoneMap[row + x]
      const z = zones[zi]
      // nearest internal edge (canvas borders are not seams)
      let d = Infinity
      let vertical = false
      let nz = -1
      if (z.x > 0) {
        const dd = x - z.x + 0.5
        if (dd < d) {
          d = dd
          vertical = true
          nz = zoneMap[row + z.x - 1]
        }
      }
      if (z.x + z.w < outW) {
        const dd = z.x + z.w - x - 0.5
        if (dd < d) {
          d = dd
          vertical = true
          nz = zoneMap[row + z.x + z.w]
        }
      }
      if (z.y > 0) {
        const dd = y - z.y + 0.5
        if (dd < d) {
          d = dd
          vertical = false
          nz = zoneMap[(z.y - 1) * outW + x]
        }
      }
      if (z.y + z.h < outH) {
        const dd = z.y + z.h - y - 0.5
        if (dd < d) {
          d = dd
          vertical = false
          nz = zoneMap[(z.y + z.h) * outW + x]
        }
      }
      let winner = assign[zi]
      if (nz >= 0 && d < halfMax && assign[nz] !== winner) {
        // both sides key the width noise by the unordered zone pair, so the
        // band breathes symmetrically across the seam
        const pair = zi < nz ? zi * 8 + nz : nz * 8 + zi
        const bandHere = bandPx * (0.7 + 0.7 * seamNoise(pair, (vertical ? y : x) / lambda))
        const g = 0.5 - d / bandHere // fraction toward the neighbor
        if (g > 0 && g > (bayerRow[((x / q) | 0) & 7] + 0.5) / 64) {
          winner = assign[nz]
        }
      }
      const img = imgs[maskIndex[winner]]
      if (img) img.data[(row + x) * 4 + 3] = 255
    }
  }
  maskCtxs.forEach((mctx, k) => {
    const img = imgs[k]
    if (mctx && img) mctx.putImageData(img, 0, 0)
  })

  const pad = Math.ceil(halfMax) + 2
  const clipRects = systems.map((s) => {
    const rects: number[] = []
    zones.forEach((z, i) => {
      if (assign[i] !== s) return
      rects.push(z.x - pad, z.y - pad, z.w + pad * 2, z.h + pad * 2)
    })
    return rects
  })

  return { key, systems, masks, clipRects }
}

function ensureGeometry(env: V2Env): Geometry {
  const key = `${env.seed}|${env.outW}x${env.outH}|${clamp01(env.complexity).toFixed(4)}`
  const hit = geometries.get(key)
  if (hit) return hit
  if (geometries.size >= 3) {
    const oldest = geometries.keys().next().value
    if (oldest !== undefined) geometries.delete(oldest)
  }
  const geo = buildGeometry(env, key)
  geometries.set(key, geo)
  return geo
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderComposite(ctx: CanvasRenderingContext2D, env: V2Env): void {
  const { outW, outH } = env
  if (outW <= 0 || outH <= 0) return
  const geo = ensureGeometry(env)
  const shared = sharedPlacement(env.seed)

  // defensive ground under the layers (the masks tile the frame exactly)
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, outW, outH)

  for (let k = 0; k < geo.systems.length; k++) {
    const sys = geo.systems[k]
    let layer = layerCanvases[sys]
    if (!layer) {
      layer = document.createElement('canvas')
      layerCanvases[sys] = layer
    }
    if (layer.width !== outW || layer.height !== outH) {
      layer.width = outW
      layer.height = outH
    }
    const lctx = layer.getContext('2d')
    if (!lctx) continue
    // full-frame system render (each fills its own opaque ground) clipped to
    // the zones this system owns (padded past the seam band — rasterizing
    // the rest would be discarded by the mask anyway), then the static mask
    // keeps this system's zones + its half of every handoff band
    lctx.globalCompositeOperation = 'source-over'
    lctx.clearRect(0, 0, outW, outH)
    lctx.save()
    lctx.beginPath()
    const rects = geo.clipRects[k]
    for (let r = 0; r < rects.length; r += 4) {
      lctx.rect(rects[r], rects[r + 1], rects[r + 2], rects[r + 3])
    }
    lctx.clip()
    SYSTEMS[sys](lctx, envFor(env, sys, shared))
    lctx.restore()
    lctx.globalCompositeOperation = 'destination-in'
    lctx.drawImage(geo.masks[k], 0, 0)
    lctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(layer, 0, 0)
  }
}
