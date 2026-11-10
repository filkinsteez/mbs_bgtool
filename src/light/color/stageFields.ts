import type { ParamValue, RecipeId } from '../scene'

/** Cells on the frame's short side. The color stage reads the design and solves its weights on this grid. */
export const GRID_SHORT = 36

/** Grid cells across and down for a frame's width / height. */
export function gridSize(aspect: number): [number, number] {
  return aspect >= 1 ? [Math.max(1, Math.round(GRID_SHORT * aspect)), GRID_SHORT] : [GRID_SHORT, Math.max(1, Math.round(GRID_SHORT / aspect))]
}

/** The design's light on the grid: per cell, the cube root of its luminance before the lens (0 is black). Row 0 is the top. */
export interface StageGrid {
  width: number
  height: number
  lightness: Float32Array
}

/** What a field asks for: a warm light, a cool one, a dark color, or whichever the shares give it. */
export type FieldWant = 'any' | 'warm' | 'cool' | 'dark'

/**
 * A look's part, in frame units: x from the left edge and y from the top edge (0..1 inside the frame), sizes in
 * short-side units.
 * - spot: a light, a source, a pool; `stretch` makes it longer along `angle` (degrees, 0 to the right, y down).
 * - line: a column of light or a stretch of an outline, from `from` to `to`, `width` across.
 * - horizon: Sunrise's light on its horizon and the direction from it to the deepest sky. A null `light` means the
 *   brightest part of the design.
 */
export type StagePart =
  | { kind: 'spot'; at: readonly [number, number]; radius: number; stretch?: number; angle?: number; want?: FieldWant }
  | { kind: 'line'; from: readonly [number, number]; to: readonly [number, number]; width: number; want?: FieldWant }
  | { kind: 'horizon'; light: readonly [number, number] | null; sky: readonly [number, number] }

/** One color field: a value from 0 to 1 per grid cell. */
export interface StageField {
  name: string
  want: FieldWant
  values: Float32Array
}

export function isSunrise(recipe: RecipeId): boolean {
  return recipe.startsWith('sunset.')
}

const num = (v: ParamValue | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const vec2 = (v: ParamValue | undefined): [number, number] | null =>
  Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null
const unit = (x: number, y: number): [number, number] => {
  const n = Math.hypot(x, y)
  return n > 1e-9 ? [x / n, y / n] : [0, -1]
}

/** The frame in short-side units: [width / short, height / short]. */
function frameShorts(aspect: number): [number, number] {
  return aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
}

/** A point given from the frame's middle in short-side units (y down), as frame units. */
function fromCenter(p: readonly [number, number], aspect: number): [number, number] {
  const [fw, fh] = frameShorts(aspect)
  return [0.5 + p[0] / fw, 0.5 + p[1] / fh]
}

/**
 * The parts of today's seven looks, read from what each look's compose already writes into its params. Rim and Halo
 * give only their light here; the stage also places fields along the bright structure it reads from the design.
 */
export function lookParts(recipe: RecipeId, params: Readonly<Record<string, ParamValue>>, aspect: number): StagePart[] {
  switch (recipe) {
    case 'sunset.ramp': {
      const anchor = vec2(params.anchor)
      const a = (num(params.angle, 0) * Math.PI) / 180
      return [{ kind: 'horizon', light: anchor, sky: unit(-Math.sin(a), -Math.cos(a)) }]
    }
    case 'sunset.blooms': {
      const glow = vec2(params.glow1At)
      const from = vec2(params.skyLineFrom)
      const to = vec2(params.skyLineTo)
      const zenith = vec2(params.zenithAt)
      const sky = params.skyLine === 1 && from && to ? unit(to[0] - from[0], to[1] - from[1]) : glow && zenith ? unit(zenith[0] - glow[0], zenith[1] - glow[1]) : unit(0, -1)
      return [{ kind: 'horizon', light: glow, sky }]
    }
    case 'sunset.bands': {
      const s = params.stack
      const sky = Array.isArray(s) && s.length >= 4 ? unit(-s[2], -s[3]) : unit(0, -1)
      return [{ kind: 'horizon', light: null, sky }]
    }
    case 'contour.streaks': {
      const c = vec2(params.center)
      return c ? [{ kind: 'spot', at: fromCenter(c, aspect), radius: 0.3 }] : []
    }
    case 'contour.rim':
    case 'contour.halo': {
      const light = vec2(params.light1At)
      return light ? [{ kind: 'spot', at: fromCenter(light, aspect), radius: 0.35 }] : []
    }
    case 'contour.beam': {
      const source = vec2(params.source)
      return source ? [{ kind: 'spot', at: fromCenter(source, aspect), radius: 0.3 }] : []
    }
    default: {
      const unknown: never = recipe
      throw new Error(`No parts for ${String(unknown)}`)
    }
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashText(text: string): number {
  let h = 7
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0
  return h
}

/** Smooth seeded value noise over the frame in short-side units, about one bump per 0.6. Returns -1..1. */
function makeNoise(rng: () => number, fw: number, fh: number): (u: number, v: number) => number {
  const cell = 0.6
  const nx = Math.ceil((fw + 1) / cell) + 3
  const ny = Math.ceil((fh + 1) / cell) + 3
  const g = Array.from({ length: nx * ny }, () => rng() * 2 - 1)
  const at = (i: number, j: number) => g[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]
  return (u, v) => {
    const x = (u + 0.5) / cell
    const y = (v + 0.5) / cell
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const sx = (x - x0) * (x - x0) * (3 - 2 * (x - x0))
    const sy = (y - y0) * (y - y0) * (3 - 2 * (y - y0))
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
    return a + (b - a) * sy
  }
}

/** Separable gaussian blur on the grid, sigma in cells, edges clamped. */
export function blurGrid(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma))
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let ks = 0
      for (let i = -r; i <= r; i++) {
        const xx = x + i
        if (xx < 0 || xx >= w) continue
        s += k[i + r] * src[y * w + xx]
        ks += k[i + r]
      }
      tmp[y * w + x] = s / ks
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let ks = 0
      for (let i = -r; i <= r; i++) {
        const yy = y + i
        if (yy < 0 || yy >= h) continue
        s += k[i + r] * tmp[yy * w + x]
        ks += k[i + r]
      }
      out[y * w + x] = s / ks
    }
  return out
}

function normalizeMax(a: Float32Array): Float32Array {
  let m = 0
  for (const v of a) m = Math.max(m, v)
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] /= m
  return a
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Lightness from which a cell counts as visibly lit. */
export const VISIBLE = 0.15

/**
 * Contour: haze shows the color of the light that reaches it. Where the design is dim, a field takes its value from
 * the bright light around it (an average weighted by lightness to the fourth, over about a third of the short side).
 */
function followLight(field: Float32Array, grid: StageGrid): Float32Array {
  const { width: w, height: h, lightness: L } = grid
  const weight = new Float32Array(w * h)
  const carried = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    weight[i] = L[i] ** 4
    carried[i] = weight[i] * field[i]
  }
  const sigma = 0.3 * Math.min(w, h)
  const num = blurGrid(carried, w, h, sigma)
  const den = blurGrid(weight, w, h, sigma)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const far = den[i] > 1e-12 ? num[i] / den[i] : field[i]
    const t = 1 - smooth(0.2, 0.5, L[i])
    out[i] = (1 - t) * field[i] + t * far
  }
  return out
}

interface Blob {
  cx: number
  cy: number
  r: number
  stretch: number
  angle: number
}

/** A soft field around a point, in short-side units, its outline bent by the noise. */
function blobField(b: Blob, w: number, h: number, fw: number, fh: number, nu: (u: number, v: number) => number, nv: (u: number, v: number) => number): Float32Array {
  const out = new Float32Array(w * h)
  const ra = b.r * Math.sqrt(b.stretch)
  const rb = b.r / Math.sqrt(b.stretch)
  const cs = Math.cos(b.angle)
  const sn = Math.sin(b.angle)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u0 = ((x + 0.5) / w) * fw
      const v0 = ((y + 0.5) / h) * fh
      const du = u0 + 0.1 * nu(u0, v0) - b.cx
      const dv = v0 + 0.1 * nv(u0, v0) - b.cy
      const al = (du * cs + dv * sn) / ra
      const ac = (-du * sn + dv * cs) / rb
      out[y * w + x] = Math.exp(-0.5 * (al * al + ac * ac))
    }
  return out
}

/** A soft band along a line segment. */
function lineField(from: readonly [number, number], to: readonly [number, number], width: number, w: number, h: number, fw: number, fh: number): Float32Array {
  const out = new Float32Array(w * h)
  const ax = from[0] * fw
  const ay = from[1] * fh
  const bx = to[0] * fw
  const by = to[1] * fh
  const lx = bx - ax
  const ly = by - ay
  const len2 = Math.max(1e-9, lx * lx + ly * ly)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) / w) * fw
      const v = ((y + 0.5) / h) * fh
      const t = Math.min(1, Math.max(0, ((u - ax) * lx + (v - ay) * ly) / len2))
      const d = Math.hypot(u - (ax + t * lx), v - (ay + t * ly))
      out[y * w + x] = Math.exp(-0.5 * (d / width) ** 2)
    }
  return out
}

/** The brightest part of the design: the lightness-weighted middle of its brightest twentieth, in frame units. */
function brightestPoint(grid: StageGrid): [number, number] {
  const { width: w, height: h, lightness: L } = grid
  const sorted = Float32Array.from(L).sort()
  const cut = sorted[Math.floor(0.95 * (sorted.length - 1))]
  let sx = 0
  let sy = 0
  let s = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = L[y * w + x]
      if (l < cut) continue
      sx += l * (x + 0.5) / w
      sy += l * (y + 0.5) / h
      s += l
    }
  return s > 0 ? [sx / s, sy / s] : [0.5, 0.5]
}

/**
 * The color fields of one design, from its parts, its light on the grid and the seed. They never depend on the
 * colors or the shares. In order: the look's own (Sunrise: the sky, its layers, the glow along the horizon, the
 * ground; Contour: the light with its haze, then the given parts), then seeded fields, then two fields for dark colors.
 */
export function buildFields(recipe: RecipeId, parts: readonly StagePart[], grid: StageGrid, seed: number, aspect: number): StageField[] {
  const { width: w, height: h, lightness: L } = grid
  const [fw, fh] = frameShorts(aspect)
  const rng = mulberry32(Math.imul(seed, 7919) + hashText(recipe))
  const nu = makeNoise(rng, fw, fh)
  const nv = makeNoise(rng, fw, fh)
  const fields: StageField[] = []
  const haze = normalizeMax(blurGrid(L, w, h, 0.12 * Math.min(w, h)))
  if (isSunrise(recipe)) {
    const horizon = parts.find((part) => part.kind === 'horizon')
    const light = horizon?.kind === 'horizon' && horizon.light ? horizon.light : brightestPoint(grid)
    const sky = horizon?.kind === 'horizon' ? horizon.sky : ([0, -1] as const)
    const turn = (rng() - 0.5) * 0.25
    const dx = sky[0] * Math.cos(turn) - sky[1] * Math.sin(turn)
    const dy = sky[0] * Math.sin(turn) + sky[1] * Math.cos(turn)
    // The glow and the sky around and above it are one lit field, strongest around the glow (the lead color's light,
    // with its own glow and gradient). The others are accents beside it, away from the hottest spot: a low band to one
    // side of the glow, a soft high layer on the other side, a broad field from a far corner, and the ground.
    const side = rng() < 0.5 ? -1 : 1
    const lowAt = 0.05 + rng() * 0.12
    const lowSide = side * (0.55 + rng() * 0.7)
    const highAt = 0.45 + rng() * 0.45
    const highSide = -side * (0.3 + rng() * 0.9)
    const cornerX = rng() < 0.5 ? -0.15 : fw + 0.15
    const cornerY = rng() < 0.5 ? -0.15 : fh + 0.15
    const soft = 0.05
    const height = new Float32Array(w * h)
    const across = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = ((x + 0.5) / w) * fw
        const v = ((y + 0.5) / h) * fh
        const du = u - light[0] * fw
        const dv = v - light[1] * fh
        height[y * w + x] = du * dx + dv * dy + 0.06 * nu(u, v)
        across[y * w + x] = -du * dy + dv * dx + 0.08 * nv(u, v)
      }
    fields.push({ name: 'sky', want: 'cool', values: height.map((t, i) => sigmoid((t + 0.02) / soft) * (0.55 + 0.45 * Math.exp(-0.5 * (t / 0.35) ** 2 - 0.5 * (across[i] / 0.9) ** 2))) })
    fields.push({ name: 'low', want: 'any', values: height.map((t, i) => Math.exp(-0.5 * ((t - lowAt) / 0.09) ** 2 - 0.5 * ((across[i] - lowSide) / 0.45) ** 2)) })
    fields.push({ name: 'high', want: 'any', values: height.map((t, i) => Math.exp(-0.5 * ((t - highAt) / 0.15) ** 2 - 0.5 * ((across[i] - highSide) / 0.55) ** 2)) })
    fields.push({ name: 'corner', want: 'any', values: blobField({ cx: cornerX, cy: cornerY, r: 0.5, stretch: 1.5, angle: rng() * Math.PI }, w, h, fw, fh, nu, nv) })
    fields.push({ name: 'ground', want: 'dark', values: height.map((t) => sigmoid(-(t + 0.03) / soft)) })
  } else {
    const own = normalizeMax(blurGrid(L, w, h, 0.06 * Math.min(w, h)))
    fields.push({ name: 'light', want: 'any', values: followLight(own, grid) })
    // A spot part sits on the light itself: as a field of its own it would take the light's core from the lead color.
    for (const [i, part] of parts.entries()) {
      if (part.kind === 'line') {
        fields.push({ name: `part${i + 1}`, want: part.want ?? 'any', values: followLight(lineField(part.from, part.to, part.width, w, h, fw, fh), grid) })
      }
    }
    // Seeded accent fields on the lit structure away from its hottest spot, so accents tint parts of a beam, a pool or
    // an outline and their haze follows them, while the core stays the lead color's light.
    const [bx, by] = brightestPoint(grid)
    const cdf = new Float64Array(w * h)
    let total = 0
    for (let i = 0; i < w * h; i++) {
      const d = Math.hypot((((i % w) + 0.5) / w - bx) * fw, ((Math.floor(i / w) + 0.5) / h - by) * fh) / Math.min(fw, fh)
      total += L[i] >= VISIBLE ? L[i] * smoothstep(0.12, 0.3, d) : 0
      cdf[i] = total
    }
    // The light's main direction (the long axis of its lit cells): accents stretch along it, so they run along a beam,
    // a fan of shafts or an outline instead of sitting in it as ovals.
    let [mx, my, sw] = [0, 0, 0]
    for (let i = 0; i < w * h; i++) {
      const wt = L[i] >= VISIBLE ? L[i] ** 2 : 0
      mx += wt * (((i % w) + 0.5) / w) * fw
      my += wt * ((Math.floor(i / w) + 0.5) / h) * fh
      sw += wt
    }
    mx /= sw || 1
    my /= sw || 1
    let [cxx, cyy, cxy] = [0, 0, 0]
    for (let i = 0; i < w * h; i++) {
      const wt = L[i] >= VISIBLE ? L[i] ** 2 : 0
      const du = (((i % w) + 0.5) / w) * fw - mx
      const dv = ((Math.floor(i / w) + 0.5) / h) * fh - my
      cxx += wt * du * du
      cyy += wt * dv * dv
      cxy += wt * du * dv
    }
    const axis = 0.5 * Math.atan2(2 * cxy, cxx - cyy)
    for (let k = 0; k < 3; k++) {
      let cx = rng() * fw
      let cy = rng() * fh
      if (total > 0) {
        const t = rng() * total
        let lo = 0
        let hi = w * h - 1
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (cdf[mid] < t) lo = mid + 1
          else hi = mid
        }
        cx = (((lo % w) + 0.5) / w) * fw
        cy = ((Math.floor(lo / w) + 0.5) / h) * fh
      }
      const blob = { cx, cy, r: 0.18 + rng() * 0.2, stretch: 2 + rng() * 1.5, angle: axis + (rng() - 0.5) * 0.6 }
      fields.push({ name: `along${k + 1}`, want: 'any', values: followLight(blobField(blob, w, h, fw, fh, nu, nv), grid) })
    }
  }
  // Dark colors are the room's or the ground's own dark: two broad seeded fields, kept out of a Contour light's haze.
  for (let k = 0; k < 2; k++) {
    const blob = { cx: -0.15 + rng() * (fw + 0.3), cy: -0.15 + rng() * (fh + 0.3), r: 0.45 + rng() * 0.4, stretch: 1 + rng(), angle: rng() * Math.PI }
    const values = blobField(blob, w, h, fw, fh, nu, nv)
    if (!isSunrise(recipe)) for (let i = 0; i < w * h; i++) values[i] *= 1 - haze[i]
    fields.push({ name: `dark${k + 1}`, want: 'dark', values })
  }
  // A floor under every field, ten times higher under the lead field: where all of a frame's fields fade out (Bold's
  // ground, with no dark color to take it), the lead color's light takes it smoothly, instead of the rounding of tiny
  // tails or a grey mix of every color.
  fields.forEach((field, f) => {
    const floor = f === 0 ? 0.02 : 0.002
    for (let i = 0; i < field.values.length; i++) field.values[i] = floor + (1 - floor) * field.values[i]
  })
  return fields
}
