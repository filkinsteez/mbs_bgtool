import { mergedParts as contourMergedParts } from '../recipes/contour/mergedCompose'
import { rushParts } from '../recipes/rush/parts'
import { mergedParts } from '../recipes/sunset/merged'
import type { ParamValue, RecipeId } from '../scene'

/** Cells on the frame's short side. The color stage reads the design and solves its weights on this grid. */
export const GRID_SHORT = 36

/** Grid cells across and down for a frame's width / height. */
export function gridSize(aspect: number): [number, number] {
  return aspect >= 1 ? [Math.max(1, Math.round(GRID_SHORT * aspect)), GRID_SHORT] : [GRID_SHORT, Math.max(1, Math.round(GRID_SHORT / aspect))]
}

/**
 * The design's light on the grid, row 0 at the top. Per cell: the cube root of its luminance before the lens (0 is
 * black), and the share of the cell that is visibly lit (read at 4 x 4 points a cell), so a thin bright line counts by
 * its own area and not by the cell's.
 */
export interface StageGrid {
  width: number
  height: number
  lightness: Float32Array
  coverage: Float32Array
  /** Each cell's brightest point, as a lightness: a thin bright line counts here even where it barely moves the mean. */
  peak: Float32Array
}

/** Points per cell side where the design is read for `coverage`. */
export const COVERAGE_SPLIT = 4

/**
 * What a field asks for: a warm light, a cool one, a dark color, a color that only reads as itself when bright (Yellow,
 * Cyan, Lime, Tan, Ice: for the brightest part of a light), a light color that isn't warm (`pale`: Cyan, Lime, Ice, for
 * a pale sky), the lead color (`lead`: the largest share, Meta Blue at the default), or whichever the shares give it.
 */
export type FieldWant = 'any' | 'warm' | 'cool' | 'dark' | 'bright' | 'pale' | 'lead'

/**
 * A look's part, in frame units: x from the left edge and y from the top edge (0..1 inside the frame), sizes in
 * short-side units.
 * - spot: a light, a source, a pool; `stretch` makes it longer along `angle` (degrees, not radians: 0 to the right,
 *   y down).
 * - line: a column of light or a stretch of an outline, from `from` to `to`, `width` across.
 * - horizon: Sunrise's light on its horizon and the direction from it to the deepest sky. A null `light` means the
 *   brightest part of the design.
 * A spot with `inner` is a ring from `inner` to `radius` (a halo, the pale sky round a high light).
 * Spots and lines with the same `group` are one light (a Rush streak's pieces and its core): it takes one color.
 * When any part asks for a color (a `want` other than `any`) or has a group, the look's parts alone say where colors
 * go (partFields): parts with no want or `lead` are the look's own light, in the lead color; parts that share a want
 * (or a group) are one light in one color; each `dark` part takes its own dark color.
 */
export type StagePart =
  | { kind: 'spot'; at: readonly [number, number]; radius: number; stretch?: number; angle?: number; inner?: number; want?: FieldWant; group?: number }
  | { kind: 'line'; from: readonly [number, number]; to: readonly [number, number]; width: number; want?: FieldWant; group?: number }
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
 * The parts of today's seven looks, read from what each look's compose already writes into its params. Rim, Halo and
 * Streaks give only their light here and Beam none; the stage also places fields along the bright structure it reads
 * from the design.
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
    case 'contour.beam':
      return []
    case 'sunset.merged':
      return mergedParts(params, aspect)
    case 'contour.merged':
      return contourMergedParts(params, aspect)
    case 'rush.split':
      return rushParts(params, aspect)
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

/** A fixed number in 0..1 for a grid cell and a seeded salt (0..1), the same however many cells are lit. */
function cellHash(cell: number, salt: number): number {
  return mulberry32(Math.imul(cell + 1, 0x9e3779b1) ^ Math.floor(salt * 4294967296))()
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
  /** A ring: its inner radius, in the same units as `r`. */
  inner?: number
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
      if (b.inner === undefined) out[y * w + x] = Math.exp(-0.5 * (al * al + ac * ac))
      else {
        const q = Math.hypot(al, ac)
        const mid = 0.5 * (1 + b.inner / b.r)
        const half = Math.max(0.08, 0.5 * (1 - b.inner / b.r))
        out[y * w + x] = Math.exp(-0.5 * ((q - mid) / half) ** 2)
      }
    }
  return out
}

/** A look's spot (or ring) or line as a field on the stage grid. */
function partField(part: Exclude<StagePart, { kind: 'horizon' }>, w: number, h: number, fw: number, fh: number, nu: (u: number, v: number) => number, nv: (u: number, v: number) => number): Float32Array {
  if (part.kind === 'line') return lineField(part.from, part.to, part.width, w, h, fw, fh)
  const blob = { cx: part.at[0] * fw, cy: part.at[1] * fh, r: part.radius, stretch: part.stretch ?? 1, angle: ((part.angle ?? 0) * Math.PI) / 180 }
  return blobField(part.inner === undefined ? blob : { ...blob, inner: part.inner }, w, h, fw, fh, nu, nv)
}

/** Whether the look's parts say where colors go: some part asks for a color or belongs to a group. */
export function followsParts(parts: readonly StagePart[]): boolean {
  return parts.some((part) => part.kind !== 'horizon' && ((part.want !== undefined && part.want !== 'any') || part.group !== undefined))
}

/** The lead color's field where no part reaches: under every part's own light, so the parts win where they are. */
const LEAD_BASE = 0.3

/**
 * The wants a part field can have besides the lead's and dark, in the order colors are given to them: the groups'
 * first, then bright, so it takes a light color no group asked for, then pale.
 */
const PART_WANTS: readonly FieldWant[] = ['cool', 'warm', 'bright', 'pale']

const maxInto = (into: Float32Array, values: Float32Array) => {
  for (let i = 0; i < into.length; i++) into[i] = Math.max(into[i], values[i])
}

/**
 * The fields of a look whose parts say where colors go (the merged looks): the look's own light (parts with no want,
 * or `lead`) with everything no other part claims, for the lead color; one per group and one for all the parts that
 * share a want, so each is one light in one color; and, when some part is dark, two dark fields that take the dark
 * spots in turn, so two dark colors each get their own (otherwise buildFields adds its two seeded ones). No seeded
 * fields across the light. The list has the same length whatever parts a frame has (a want with no part has an empty
 * field), so no color moves to another field while a line is dragged.
 */
function partFields(parts: readonly StagePart[], grid: StageGrid, aspect: number, nu: (u: number, v: number) => number, nv: (u: number, v: number) => number): StageField[] {
  const { width: w, height: h } = grid
  const [fw, fh] = frameShorts(aspect)
  const lead = new Float32Array(w * h)
  const groups = new Map<number, { want: FieldWant; values: Float32Array }>()
  const wants = new Map<FieldWant, Float32Array>(PART_WANTS.map((want) => [want, new Float32Array(w * h)]))
  const darks = [new Float32Array(w * h), new Float32Array(w * h)]
  let darkSpots = 0
  for (const part of parts) {
    if (part.kind === 'horizon') continue
    const values = partField(part, w, h, fw, fh, nu, nv)
    const want = part.want ?? 'any'
    if (want === 'lead' || (want === 'any' && part.group === undefined)) maxInto(lead, values)
    else if (part.group !== undefined) {
      const held = groups.get(part.group)
      if (held) maxInto(held.values, values)
      else groups.set(part.group, { want, values })
    } else if (want === 'dark') maxInto(darks[darkSpots++ % darks.length], values)
    else {
      const held = wants.get(want)
      if (held) maxInto(held, values)
    }
  }
  // The lead's light reaches everywhere no part claims, except into the look's own dim room.
  for (let i = 0; i < w * h; i++) lead[i] = Math.max(lead[i], LEAD_BASE * (1 - Math.max(darks[0][i], darks[1][i])))
  const fields: StageField[] = [{ name: 'lead', want: 'lead', values: lead }]
  for (const [group, { want, values }] of [...groups.entries()].sort((a, b) => a[0] - b[0])) fields.push({ name: `group${group}`, want, values })
  for (const [want, values] of wants) fields.push({ name: want, want, values })
  if (darkSpots) darks.forEach((values, i) => fields.push({ name: `dark${i + 1}`, want: 'dark', values }))
  return fields
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
 * colors or the shares. When the look's parts say where colors go, those alone (partFields), with seeded dark fields
 * only if no part is dark. Otherwise the look's own (Sunrise: the sky, its layers, the glow along the horizon, the
 * ground; Contour: four seeded fields that take turns along the light, each with its haze, then the parts), then two
 * fields for dark colors.
 */
export function buildFields(recipe: RecipeId, parts: readonly StagePart[], grid: StageGrid, seed: number, aspect: number): StageField[] {
  const { width: w, height: h, lightness: L } = grid
  const [fw, fh] = frameShorts(aspect)
  const rng = mulberry32(Math.imul(seed, 7919) + hashText(recipe))
  const nu = makeNoise(rng, fw, fh)
  const nv = makeNoise(rng, fw, fh)
  const fields: StageField[] = []
  const haze = normalizeMax(blurGrid(L, w, h, 0.12 * Math.min(w, h)))
  const byParts = followsParts(parts)
  if (byParts) fields.push(...partFields(parts, grid, aspect, nu, nv))
  else if (isSunrise(recipe)) {
    const horizon = parts.find((part) => part.kind === 'horizon')
    const light = horizon?.kind === 'horizon' && horizon.light ? horizon.light : brightestPoint(grid)
    const sky = horizon?.kind === 'horizon' ? horizon.sky : ([0, -1] as const)
    const turn = (rng() - 0.5) * 0.25
    const dx = sky[0] * Math.cos(turn) - sky[1] * Math.sin(turn)
    const dy = sky[0] * Math.sin(turn) + sky[1] * Math.cos(turn)
    // Layers by height above the horizon, as in a sky at sunrise: the glow on the horizon (widest at the light), a low
    // warm layer, a high cool layer, and the sky above (the lead color's light, deep at the top and bright where it
    // meets the layers); the ground below. Each boundary drifts on its own noise, so no two run parallel.
    const drift = [0, 1, 2, 3].map(() => makeNoise(rng, fw, fh))
    const n = w * h
    const height = new Float32Array(n)
    const across = new Float32Array(n)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = ((x + 0.5) / w) * fw
        const v = ((y + 0.5) / h) * fh
        const du = u - light[0] * fw
        const dv = v - light[1] * fh
        height[y * w + x] = du * dx + dv * dy + 0.04 * nu(u, v)
        across[y * w + x] = -du * dy + dv * dx
      }
    // The layers' tops sit at seeded shares of the lit sky's height above the horizon, so a light in a corner gets
    // layers across the frame and not squeezed into the corner.
    const litSky = Array.from(height.keys()).filter((i) => height[i] > 0 && grid.coverage[i] > 0).sort((i, j) => height[i] - height[j])
    const skyArea = litSky.reduce((a, i) => a + grid.coverage[i], 0)
    const quantile = (q: number) => {
      let a = 0
      for (const i of litSky) {
        a += grid.coverage[i]
        if (a >= q * skyArea) return height[i]
      }
      return litSky.length ? height[litSky[litSky.length - 1]] : 0.5
    }
    const shares = [0.12 + 0.08 * rng(), 0.28 + 0.08 * rng(), 0.45 + 0.1 * rng()]
    const tops = skyArea > 0 ? shares.map((q) => Math.max(0.03, quantile(q))) : [0.08, 0.2, 0.35]
    for (let k = 1; k < 3; k++) tops[k] = Math.max(tops[k], tops[k - 1] + 0.03)
    const soft = 0.09
    const ground = new Float32Array(n)
    const glow = new Float32Array(n)
    const low = new Float32Array(n)
    const high = new Float32Array(n)
    const top = new Float32Array(n)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = ((x + 0.5) / w) * fw
        const v = ((y + 0.5) / h) * fh
        const i = y * w + x
        const t = height[i]
        const edge = [0.02 * drift[0](u, v), ...tops.map((b, k) => b + 0.35 * (b - (k ? tops[k - 1] : 0)) * drift[k + 1](u, v))]
        const above = edge.map((b) => sigmoid((t - b) / soft))
        ground[i] = 1 - above[0]
        glow[i] = above[0] * (1 - above[1]) * (0.35 + 0.65 * Math.exp(-0.5 * (across[i] / 0.7) ** 2))
        low[i] = above[1] * (1 - above[2])
        high[i] = above[2] * (1 - above[3])
        top[i] = above[3]
      }
    fields.push({ name: 'sky', want: 'cool', values: top })
    fields.push({ name: 'glow', want: 'warm', values: glow })
    fields.push({ name: 'low', want: 'warm', values: low })
    fields.push({ name: 'high', want: 'cool', values: high })
    fields.push({ name: 'ground', want: 'dark', values: ground })
  } else {
    // How much of the lit area a field covers.
    const litShare = (values: Float32Array) => {
      let on = 0
      let all = 0
      for (let i = 0; i < w * h; i++) {
        on += values[i] * grid.coverage[i]
        all += grid.coverage[i]
      }
      return all > 0 ? on / all : 0
    }
    // Four broad fields along the bright structure: the first on the brightest part (lightness cubed over the brightest
    // tenth), for a color that only reads as itself when bright; each next one on the brighter lit cells farthest from
    // those already placed, so colors take turns along a beam or an outline instead of in rings around one spot, and
    // never sit in the dim haze alone.
    const litL = Array.from(L.keys()).filter((i) => grid.coverage[i] > 0).map((i) => L[i]).sort((a, b) => a - b)
    const brightest = litL.length ? litL[Math.floor(0.9 * (litL.length - 1))] : 0
    const brighter = litL.length ? litL[Math.floor(0.6 * (litL.length - 1))] : 0
    // Every seeded number is drawn here in a fixed order, and each center is a weighted middle rather than one picked
    // cell, so a small change in the design moves the fields a little instead of handing colors to other places.
    const draws = [0, 1, 2, 3].map(() => ({ x: rng(), y: rng(), salt: rng(), r: 0.3 + rng() * 0.25, stretch: 1 + rng(), angle: rng() * Math.PI }))
    const centers: [number, number][] = []
    const cellAt = (i: number): [number, number] => [(((i % w) + 0.5) / w) * fw, ((Math.floor(i / w) + 0.5) / h) * fh]
    for (const [k, draw] of draws.entries()) {
      let sx = 0
      let sy = 0
      let sw = 0
      for (let i = 0; i < w * h; i++) {
        if (grid.coverage[i] <= 0) continue
        const [x, y] = cellAt(i)
        let weight: number
        if (k === 0) weight = smooth(brightest - 0.04, brightest + 0.02, L[i]) * L[i] ** 3
        else {
          const gap = Math.min(...centers.map(([cx, cy]) => Math.hypot(x - cx, y - cy)))
          weight = smooth(brighter - 0.04, brighter + 0.04, L[i]) * (gap * L[i] * (0.85 + 0.3 * cellHash(i, draw.salt))) ** 12
        }
        sx += weight * x
        sy += weight * y
        sw += weight
      }
      const at: [number, number] = sw > 1e-30 ? [sx / sw, sy / sw] : [draw.x * fw, draw.y * fh]
      centers.push(at)
      const blob = { cx: at[0], cy: at[1], r: draw.r, stretch: draw.stretch, angle: draw.angle }
      fields.push({ name: `along${k + 1}`, want: k === 0 ? 'bright' : 'any', values: followLight(blobField(blob, w, h, fw, fh, nu, nv), grid) })
    }
    // The look's other parts follow, each fading out as it leaves the lit area (a light just outside the frame lights
    // nothing here), so the list of fields never changes length and no color jumps to another field.
    for (const [i, part] of parts.entries()) {
      if (part.kind === 'horizon') continue
      const values = partField(part, w, h, fw, fh, nu, nv)
      const fade = smooth(0.02, 0.06, litShare(values))
      fields.push({ name: `part${i + 1}`, want: part.want ?? 'any', values: followLight(values, grid).map((v) => v * fade) })
    }
  }
  // Dark colors are the room's or the ground's own dark: two broad seeded fields, kept out of a Contour light's haze,
  // unless the look's parts place its dark spots.
  const placedDarks = byParts && fields.some((field) => field.want === 'dark')
  for (let k = 0; k < 2 && !placedDarks; k++) {
    const blob = { cx: -0.15 + rng() * (fw + 0.3), cy: -0.15 + rng() * (fh + 0.3), r: 0.45 + rng() * 0.4, stretch: 1 + rng(), angle: rng() * Math.PI }
    const values = blobField(blob, w, h, fw, fh, nu, nv)
    if (!isSunrise(recipe)) for (let i = 0; i < w * h; i++) values[i] *= 1 - haze[i]
    fields.push({ name: `dark${k + 1}`, want: 'dark', values })
  }
  // A dark color never sits against bright light, a thin line included: dark fields fade out within two cells of any
  // cell whose brightest point is past mid lightness. A look's own dark spots are its dim room as drawn, so they stay.
  if (placedDarks) return fields
  const near = nearPeak(grid, 2)
  for (const field of fields) if (field.want === 'dark') for (let i = 0; i < w * h; i++) field.values[i] *= 1 - smooth(0.45, 0.7, near[i])
  return fields
}

/** Each cell's brightest `peak` within `reach` cells. */
function nearPeak(grid: StageGrid, reach: number): Float32Array {
  const { width: w, height: h, peak } = grid
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let top = 0
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && xx < w && yy >= 0 && yy < h) top = Math.max(top, peak[yy * w + xx])
        }
      out[y * w + x] = top
    }
  return out
}
