import { motionHarmonic, type V2Env } from './system'
import { chan } from '@/core/organic/random'
import { normalizedLuminance } from './pattern'

// 'Dither' — a patchwork of dithering styles over one continuous tone field.
// The canvas is guillotine-partitioned into 5-9 rectangular zones with hard
// seams; each zone renders the SAME underlying tone image T(x,y) through its
// own dither technique (ordered bayer, diagonal halftone lines, dot grid,
// horizontal lines, noisy diffusion) at its own cell scale. Each zone is
// strictly two-color internally — the shared ground plus ONE ink dealt to
// that zone from the enabled plan swatches (weight-proportional, adjacent
// zones avoid repeats) — so the 1-bit character survives per zone while the
// collage carries the whole user mix. A single-ink mix collapses to the
// classic ground + highest-contrast-swatch render.

const C = 'v2.dither.'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// 8x8 ordered Bayer matrix
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

// large-scale smooth chan-lattice value noise (cosine-eased bilinear).
// `shift` moves the sample coordinates for the motion breathing.
function makeDrift(seed: number, cellPx: number, shift: number) {
  const inv = 1 / Math.max(16, cellPx)
  const lattice = (i: number, j: number): number => {
    const id = (Math.imul(i + 512, 0x9e3779b1) ^ Math.imul(j + 512, 0x85ebca77)) >>> 0
    return chan(seed, id, C + 'drift')
  }
  const ease = (t: number) => t * t * (3 - 2 * t)
  return (x: number, y: number): number => {
    const u = x * inv + shift
    const v = y * inv + shift
    const i = Math.floor(u)
    const j = Math.floor(v)
    const fu = ease(u - i)
    const fv = ease(v - j)
    const a = lattice(i, j)
    const b = lattice(i + 1, j)
    const c = lattice(i, j + 1)
    const d = lattice(i + 1, j + 1)
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv
  }
}

type Zone = { x: number; y: number; w: number; h: number; id: number }

// ---- per-zone ink dealing ---------------------------------------------------

type PoolInk = { hex: string; weight: number }

// oklab of a hex color (same transform the color plan uses), so ground
// proximity is judged perceptually rather than by raw RGB.
function hexToOklab(hex: string): [number, number, number] {
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  const value = match ? Number.parseInt(match[1], 16) : 0
  const lin = (c: number) => {
    const u = c / 255
    return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4
  }
  const r = lin((value >> 16) & 255)
  const g = lin((value >> 8) & 255)
  const b = lin(value & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

// the enabled plan swatches that can act as ink: everything far enough from
// the ground to survive as 1-bit texture. Falls back to the single
// highest-contrast swatch (the classic render) when the plan is missing or
// the filter empties the pool.
function buildInkPool(env: V2Env): PoolInk[] {
  const plan = env.plan
  if (!plan || plan.depthOrder.length === 0) return [{ hex: env.ink, weight: 1 }]
  const [gl, ga, gb] = hexToOklab(env.ground)
  const pool: PoolInk[] = []
  for (const sw of plan.swatches) {
    const sa = Math.cos(sw.hue) * sw.chroma
    const sb = Math.sin(sw.hue) * sw.chroma
    const dist = Math.hypot(sw.lightness - gl, sa - ga, sb - gb)
    if (dist >= 0.09) pool.push({ hex: sw.hex, weight: Math.max(1e-4, sw.weight) })
  }
  if (pool.length === 0) {
    const idx = plan.depthOrder[plan.depthOrder.length - 1]
    return [{ hex: plan.swatches[idx]?.hex ?? env.ink, weight: 1 }]
  }
  return pool
}

// deal one ink per zone: weight-proportional via chan, then a greedy repair
// that steers away from inks already dealt to seam-sharing neighbours where
// the pool allows it. Deterministic in (seed, zone ids).
function assignZoneInks(seed: number, zones: Zone[], pool: PoolInk[]): string[] {
  const inks = new Array<string>(zones.length)
  if (pool.length === 1) {
    inks.fill(pool[0].hex)
    return inks
  }
  const total = pool.reduce((sum, p) => sum + p.weight, 0) || 1
  // adjacency = rectangles sharing a seam segment (guillotine cuts are
  // integer-rounded, but keep a small epsilon anyway)
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
  for (let i = 0; i < zones.length; i++) {
    // weight-proportional base pick
    const sample = chan(seed, zones[i].id, C + 'ink') * total
    let acc = 0
    let pick = pool.length - 1
    for (let k = 0; k < pool.length; k++) {
      acc += pool[k].weight
      if (sample < acc) {
        pick = k
        break
      }
    }
    // steer off inks already dealt to adjacent zones, when avoidable
    const used = new Set<string>()
    for (const j of adj[i]) if (inks[j] !== undefined) used.add(inks[j])
    let choice = pick
    for (let step = 0; step < pool.length; step++) {
      const k = (pick + step) % pool.length
      if (!used.has(pool[k].hex)) {
        choice = k
        break
      }
    }
    inks[i] = pool[choice].hex
  }
  return inks
}

// recursive guillotine partition: split the largest splittable leaf along its
// longer axis at a seeded 0.3-0.7 position until we hold 5-9 zones.
function partition(seed: number, w: number, h: number, complexity: number): Zone[] {
  const zones: Zone[] = [{ x: 0, y: 0, w, h, id: 1 }]
  let nextId = 2
  const target = Math.min(
    9,
    5 + Math.floor(chan(seed, 0, C + 'zones') * 2.6 + complexity * 2.2),
  )
  const minSide = Math.max(40, Math.min(w, h) * 0.11)
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
    const pos = 0.3 + chan(seed, z.id, C + 'pos') * 0.4
    let a: Zone
    let b: Zone
    if (z.w >= z.h) {
      const cut = Math.round(z.w * pos)
      a = { x: z.x, y: z.y, w: cut, h: z.h, id: nextId++ }
      b = { x: z.x + cut, y: z.y, w: z.w - cut, h: z.h, id: nextId++ }
    } else {
      const cut = Math.round(z.h * pos)
      a = { x: z.x, y: z.y, w: z.w, h: cut, id: nextId++ }
      b = { x: z.x, y: z.y + cut, w: z.w, h: z.h - cut, id: nextId++ }
    }
    zones.splice(best, 1, a, b)
  }
  return zones
}

type Tone = (x: number, y: number) => number

function renderBayer(ctx: CanvasRenderingContext2D, z: Zone, s: number, tone: Tone): void {
  const cols = Math.ceil(z.w / s)
  const rows = Math.ceil(z.h / s)
  ctx.beginPath()
  for (let iy = 0; iy < rows; iy++) {
    const y = z.y + iy * s
    const row = BAYER8[iy & 7]
    for (let ix = 0; ix < cols; ix++) {
      const x = z.x + ix * s
      // cap effective coverage ~88%: the top matrix cells never fill, so the
      // pattern stays visibly textured even where tone saturates
      const t = Math.min(0.875, tone(x + s * 0.5, y + s * 0.5))
      if (t > (row[ix & 7] + 0.5) / 64) ctx.rect(x, y, s + 0.35, s + 0.35)
    }
  }
  ctx.fill()
}

function renderDiag(
  ctx: CanvasRenderingContext2D,
  z: Zone,
  s: number,
  tone: Tone,
  sign: 1 | -1,
  gapFloor: number,
): void {
  const angle = (sign * Math.PI) / 4
  const cx = z.x + z.w * 0.5
  const cy = z.y + z.h * 0.5
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const R = Math.hypot(z.w, z.h) * 0.5 + 2 * s
  // never let the line swallow its pitch — thickness <= pitch - gap, where the
  // gap stays >= max(~2 preview px, 30% of pitch), so the halftone texture
  // survives even where tone saturates
  const thMax = Math.max(0.5 * s, 2 * s - Math.max(gapFloor, 0.6 * s))
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.beginPath()
  for (let v = -R; v <= R; v += 2 * s) {
    for (let u = -R; u <= R; u += s) {
      const px = cx + u * cosA - v * sinA
      const py = cy + u * sinA + v * cosA
      if (px < z.x - s || px > z.x + z.w + s || py < z.y - s || py > z.y + z.h + s) continue
      const t = tone(px, py)
      if (t < 0.06) continue
      const th = Math.min(thMax, t * 2.2 * s)
      ctx.rect(u - s * 0.5, v - th * 0.5, s + 0.35, th)
    }
  }
  ctx.fill()
  ctx.restore()
}

function renderDotGrid(
  ctx: CanvasRenderingContext2D,
  z: Zone,
  s: number,
  tone: Tone,
  gapFloor: number,
): void {
  const pitch = s * 2
  const cols = Math.ceil(z.w / pitch)
  const rows = Math.ceil(z.h / pitch)
  // dots never fully merge: keep a ground gap >= max(~2 preview px, 30% of
  // pitch) between neighbours so the grid reads as dots at every tone
  const rMax = Math.max(0.3 * s, Math.min(s - gapFloor * 0.5, 0.7 * s))
  ctx.beginPath()
  for (let iy = 0; iy <= rows; iy++) {
    const y = z.y + iy * pitch + pitch * 0.5
    for (let ix = 0; ix <= cols; ix++) {
      const x = z.x + ix * pitch + pitch * 0.5
      const t = tone(x, y)
      if (t < 0.015) continue
      const r = Math.min(rMax, Math.sqrt(t) * 1.15 * s)
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
  }
  ctx.fill()
}

function renderHLines(
  ctx: CanvasRenderingContext2D,
  z: Zone,
  s: number,
  tone: Tone,
  gapFloor: number,
): void {
  const cols = Math.ceil(z.w / s)
  const rows = Math.ceil(z.h / (2 * s))
  // same ground-gap guarantee as the diagonal style: thickness <= pitch - gap
  const thMax = Math.max(0.5 * s, 2 * s - Math.max(gapFloor, 0.6 * s))
  ctx.beginPath()
  for (let iy = 0; iy <= rows; iy++) {
    const y = z.y + iy * 2 * s + s
    for (let ix = 0; ix < cols; ix++) {
      const x = z.x + ix * s
      const t = tone(x + s * 0.5, y)
      if (t < 0.05) continue
      const th = Math.min(thMax, t * 1.9 * s)
      ctx.rect(x, y - th * 0.5, s + 0.35, th)
    }
  }
  ctx.fill()
}

function renderNoise(
  ctx: CanvasRenderingContext2D,
  z: Zone,
  s: number,
  tone: Tone,
  seed: number,
): void {
  const cols = Math.ceil(z.w / s)
  const rows = Math.ceil(z.h / s)
  ctx.beginPath()
  for (let iy = 0; iy < rows; iy++) {
    const y = z.y + iy * s
    for (let ix = 0; ix < cols; ix++) {
      const x = z.x + ix * s
      // one seeded keeper cell per 3x3 block never fills, so ink clumps stay
      // bounded and the diffusion zone keeps ground speckle at saturation
      const bx = (ix / 3) | 0
      const by = (iy / 3) | 0
      const bid =
        (Math.imul(bx + 11, 0x85ebca77) ^ Math.imul(by + 17, 0x9e3779b1) ^ Math.imul(z.id, 0x27d4eb2f)) >>>
        0
      if (ix - bx * 3 + (iy - by * 3) * 3 === Math.floor(chan(seed, bid, C + 'keep') * 9) % 9)
        continue
      // cap fill probability so a saturated tone still leaves random speckle
      const t = Math.min(0.92, tone(x + s * 0.5, y + s * 0.5))
      const id =
        (Math.imul(ix + 7, 0xc2b2ae35) ^ Math.imul(iy + 13, 0x27d4eb2f) ^ Math.imul(z.id, 0x165667b1)) >>>
        0
      if (t > chan(seed, id, C + 'noise')) ctx.rect(x, y, s + 0.35, s + 0.35)
    }
  }
  ctx.fill()
}

const STYLES = ['bayer', 'diag45', 'diag135', 'dotgrid', 'hlines', 'noise'] as const
type Style = (typeof STYLES)[number]

export function renderDither(ctx: CanvasRenderingContext2D, env: V2Env): void {
  const { outW: W, outH: H, seed, complexity } = env
  const minDim = Math.min(W, H)

  // ---- colors: shared ground + one ink dealt per zone -----------------------
  ctx.save()
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, W, H)
  const inkPool = buildInkPool(env)

  // ---- underlying tone field T(x,y) ----------------------------------------
  // Motion, two amount-scaled terms riding the shared tone field so every
  // dither style animates in the same rhythm:
  //   (a) drift slide — the smooth drift lattice's sample point swings by
  //       roughly one lattice cell, on two quadrature harmonics (both zero
  //       at phase 0/1) so the slide never stalls mid-loop;
  //   (b) tone pump — a low-frequency traveling wave (seeded direction,
  //       ~1.5-2.5 wavelengths across the frame, h cycles per loop) that
  //       swells and thins the dither densities. The sin(θ+φ) − sin(φ)
  //       form is exactly zero at phase 0/1 — the loop seam and the
  //       phase-0 thumbnail stay byte-identical to the static render —
  //       while pumping at full rate right through the seam.
  const amt = env.motionAmount
  const h = motionHarmonic(env)
  const theta = 2 * Math.PI * env.motionPhase * h
  const shift = 1.3 * (Math.sin(theta) + 0.5 * (Math.cos(theta) - 1)) * amt
  const pumpAmp = amt * 0.22
  const pumpDir = chan(seed, 2, C + 'pumpDir') * Math.PI * 2
  const pumpMag = (2 * Math.PI * (1.5 + chan(seed, 2, C + 'pumpFreq'))) / minDim
  const pumpKx = Math.cos(pumpDir) * pumpMag
  const pumpKy = Math.sin(pumpDir) * pumpMag
  const pump = (x: number, y: number): number => {
    const spatial = x * pumpKx + y * pumpKy
    return pumpAmp * (Math.sin(theta + spatial) - Math.sin(spatial))
  }
  let tone: Tone
  if (env.luminance) {
    // 3D material mode: the captured frame's tone, with the same pump so
    // captured dithers animate too. tone = 1 - lum alone sends the bright
    // model to ~0 ink — a flat paper stencil that discards all interior
    // shading — so the figure gets its own evidence: a border-referenced
    // normalized level L (0 ground side, 1 model side) times a
    // subject-shading term s (the model's own tonal range, normalized so
    // its darkest turns hit 1), floored into the tone. Shaded turns then
    // carry a light dither inside the silhouette — the tube's roundness
    // and the crossing's self-shadow model — while lit crowns stay
    // near-clean and the ground keeps its full dither patchwork.
    const lum = env.luminance
    const level = normalizedLuminance(env)
    // subject tonal range: robust 5th..95th percentile of the captured
    // luminance where the normalized level reads "figure", so s spans the
    // model's own shading whatever the exposure
    const cols = 64
    const rows = Math.max(2, Math.round((cols * H) / Math.max(1, W)))
    const subject: number[] = []
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = ((i + 0.5) / cols) * W
        const y = ((j + 0.5) / rows) * H
        if (level(x, y) > 0.6) subject.push(lum(x, y))
      }
    }
    subject.sort((a, b) => a - b)
    const sLo = subject.length > 0 ? subject[Math.floor(subject.length * 0.05)] : 0
    const sHi =
      subject.length > 0
        ? subject[Math.min(subject.length - 1, Math.floor(subject.length * 0.95))]
        : 1
    const sSpan = sHi - sLo
    const shade =
      sSpan > 0.02 ? (x: number, y: number) => clamp01((sHi - lum(x, y)) / sSpan) : () => 0
    tone = (x, y) =>
      clamp01(
        Math.max(1 - lum(x, y), level(x, y) * (0.15 + 0.45 * shade(x, y))) + pump(x, y),
      )
  } else {
    const scale = 1.5 + chan(seed, 1, C + 'symScale') * 0.8
    const dir = chan(seed, 1, C + 'symDir') * Math.PI * 2
    const dist = 0.4 + chan(seed, 1, C + 'symDist') * 0.35
    const rotation = (chan(seed, 1, C + 'symRot') * 2 - 1) * 0.55
    const sym = env.symbolField({
      scale,
      offsetX: Math.cos(dir) * dist,
      offsetY: Math.sin(dir) * dist,
      rotation,
      softness: 0.85,
    })
    const drift = makeDrift(seed, minDim * 0.5, shift)
    // cap below 1 so no dither style ever saturates into a literal solid
    // fill of the mark — texture must survive everywhere
    tone = (x, y) =>
      Math.min(
        0.82,
        clamp01(0.18 + sym(x, y) * 0.62 + drift(x, y) * 0.35 + pump(x, y) - 0.175),
      )
  }

  // ---- patchwork zones ------------------------------------------------------
  const zones = partition(seed, W, H, complexity)

  // one ink per zone from the enabled mix; single-ink pools fill every zone
  // with the classic highest-contrast ink
  const zoneInks = assignZoneInks(seed, zones, inkPool)

  // style deck: a seeded shuffle cycled across zones so styles never all match
  const deck: Style[] = STYLES.map((style, k) => ({ style, key: chan(seed, k, C + 'deck') }))
    .sort((a, b) => a.key - b.key || a.style.localeCompare(b.style))
    .map((d) => d.style)

  // cell scale base: coarse at complexity 0, fine at 1
  const base = minDim / (210 + complexity * 190)

  // ground-gap floor: ~2px at preview scale (the canvas previews near 1:1 at
  // ~675px min dimension; larger outputs shrink, so the floor scales up)
  const gapFloor = Math.max(2, minDim / 340)

  // one seeded zone anchors the collage as a distinctly coarse dot grid, the
  // rest spread across a wide cell-scale range so zones contrast in grain.
  // Pick the anchor from the larger half of the zones so it reads.
  const byArea = zones
    .map((_, i) => i)
    .sort((a, b) => zones[b].w * zones[b].h - zones[a].w * zones[a].h)
  const bigHalf = byArea.slice(0, Math.ceil(byArea.length / 2))
  const anchor = bigHalf[Math.floor(chan(seed, 3, C + 'anchor') * bigHalf.length) % bigHalf.length]

  for (let i = 0; i < zones.length; i++) {
    const z = zones[i]
    if (z.w < 1 || z.h < 1) continue
    const coarse = i === anchor
    const style: Style = coarse ? 'dotgrid' : deck[i % deck.length]
    const s = coarse
      ? Math.max(3, base) * 2.2
      : Math.max(3, base * (0.6 + chan(seed, z.id, C + 'cell') * 1.2))
    ctx.save()
    ctx.beginPath()
    ctx.rect(z.x, z.y, z.w, z.h)
    ctx.clip()
    ctx.fillStyle = zoneInks[i]
    if (style === 'bayer') renderBayer(ctx, z, s, tone)
    else if (style === 'diag45') renderDiag(ctx, z, s, tone, 1, gapFloor)
    else if (style === 'diag135') renderDiag(ctx, z, s, tone, -1, gapFloor)
    else if (style === 'dotgrid') renderDotGrid(ctx, z, s, tone, gapFloor)
    else if (style === 'hlines') renderHLines(ctx, z, s, tone, gapFloor)
    else renderNoise(ctx, z, s, tone, seed)
    ctx.restore()
  }
  ctx.restore()
}
