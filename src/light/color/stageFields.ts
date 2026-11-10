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
 * A spot with `inner` is a ring from `inner` to `radius` (a halo, the pale sky round a high light). A `bright` spot
 * inside a ring's bright middle is that ring's hottest light and takes the ring's color.
 * Spots and lines with the same `group` are one light (a Rush streak's pieces and its core): it takes one color.
 * `strength` (0 to 1, default 1) is how much a part counts: a part that comes, goes or jumps while a line is dragged
 * should fade its strength, and its color fades in and out with it instead of switching.
 * When any part asks for a color (a `want` other than `any`) or has a group, the look's parts alone say where colors
 * go (partFields): parts with no want or `lead`, grouped or not, are the look's own light, in the lead color; the
 * parts that ask the same color (a group asks what its first part asks) are one light in one color, shown where that
 * light is; the first `dark` part is the first dark color's (in pack order), the second the second's.
 */
export type StagePart =
  | { kind: 'spot'; at: readonly [number, number]; radius: number; stretch?: number; angle?: number; inner?: number; want?: FieldWant; group?: number; strength?: number }
  | { kind: 'line'; from: readonly [number, number]; to: readonly [number, number]; width: number; want?: FieldWant; group?: number; strength?: number }
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
      return contourMergedParts(params)
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

type Noise = (u: number, v: number) => number

/** The wants that get their own warp in a look colored by its parts, in the order their noise is drawn. */
const WARPED: readonly FieldWant[] = ['lead', ...PART_WANTS, 'dark']

/**
 * The fields of a look whose parts say where colors go (the merged looks), always the same seven, so no color moves to
 * another field while a line is dragged: the lead's light (parts with no want or `lead`, and everywhere no part claims
 * except the look's own dim room); one field per color asked (cool, warm, bright, pale), from every part that asks it
 * (a group asks what its first part asks); and two dark fields, the first dark spot in the first and the second in the
 * second (the dark colors in pack order). An asked color's field fades out where the design is dim, and the solve keeps the color to its
 * part's own light, so a small light's color sits on that light, never over a dim face. Each part counts by its strength
 * and fades as it shrinks to nothing. Each color has its own small warp, so neighbouring color edges are not parallel.
 * `presence` is how much each dark field's own spots are there (0 to 1): buildFields' seeded dark fields give way to them,
 * so a look with one dark spot keeps a seeded place for its second dark color.
 */
function partFields(parts: readonly StagePart[], grid: StageGrid, aspect: number, warps: ReadonlyMap<FieldWant, readonly [Noise, Noise]>): { fields: StageField[]; presence: number[] } {
  const { width: w, height: h, lightness: L } = grid
  const [fw, fh] = frameShorts(aspect)
  const warpOf = (want: FieldWant) => warps.get(want) ?? warps.get('lead')!
  const lead = new Float32Array(w * h)
  const wants = new Map<FieldWant, Float32Array>(PART_WANTS.map((want) => [want, new Float32Array(w * h)]))
  const groupWant = new Map<number, FieldWant>()
  const darkSpots: { values: Float32Array; count: number }[] = []
  // Where the asked parts reach, before their colors fade with the design's light.
  const asked = new Float32Array(w * h)
  const rings = parts.flatMap((part) => (part.kind === 'spot' && part.inner !== undefined && part.want && !['any', 'lead', 'dark', 'bright'].includes(part.want) ? [part] : []))
  for (const part of parts) {
    if (part.kind === 'horizon') continue
    let want = part.want ?? 'any'
    if (part.group !== undefined) {
      if (!groupWant.has(part.group)) groupWant.set(part.group, want)
      want = groupWant.get(part.group) ?? want
    }
    const [nu, nv] = warpOf(want === 'any' ? 'lead' : want)
    const values = partField(part, w, h, fw, fh, nu, nv)
    const area = values.reduce((a, v) => a + v, 0) / (w * h)
    const count = Math.min(1, Math.max(0, part.strength ?? 1)) * smooth(0.001, 0.01, area)
    for (let i = 0; i < w * h; i++) values[i] *= count
    if (want === 'lead' || want === 'any') maxInto(lead, values)
    else if (want === 'dark') darkSpots.push({ values, count })
    else {
      // An asked color sits where its part's light is, and fades out with the design's light, never over a dim face.
      maxInto(asked, values)
      for (let i = 0; i < w * h; i++) values[i] *= smooth(0.3, 0.55, L[i])
      // A hot core inside a ring (a halo round the light) is that halo's light at its hottest: it takes the halo's
      // color, which goes toward white there, instead of a dot of another color, handing over smoothly as it leaves.
      const shares = want === 'bright' && part.kind === 'spot' ? ringShares(part.at, rings, fw, fh) : []
      let rest = 1
      for (const [ringWant, share] of shares) {
        const held = wants.get(ringWant)
        if (held) maxInto(held, values.map((v) => v * share))
        rest -= share
      }
      const held = wants.get(want)
      if (held) maxInto(held, rest < 1 ? values.map((v) => v * rest) : values)
    }
  }
  // The lead's own parts (Meta Blue's face) stay its own: an asked color gives way on them.
  for (const values of wants.values()) for (let i = 0; i < w * h; i++) values[i] *= 1 - 0.6 * lead[i]
  const darks = [new Float32Array(w * h), new Float32Array(w * h)]
  const presence = [0, 0]
  darkSpots.forEach((spot, s) => {
    maxInto(darks[s % 2], spot.values)
    presence[s % 2] = Math.max(presence[s % 2], spot.count)
  })
  // The lead's light reaches everywhere no part claims, except into the look's own dim room.
  // Where an asked part meets the dim room the lead's light gives way, so the colors on either side meet there
  // instead of a strip of the lead between them.
  for (let i = 0; i < w * h; i++) {
    const dark = Math.max(darks[0][i], darks[1][i])
    lead[i] = Math.max(lead[i], LEAD_BASE * (1 - dark) * (1 - smooth(0.1, 0.4, Math.min(asked[i], dark))))
  }
  const fields: StageField[] = [{ name: 'lead', want: 'lead', values: lead }]
  for (const [want, values] of wants) fields.push({ name: want, want, values })
  darks.forEach((values, i) => fields.push({ name: `dark${i + 1}`, want: 'dark', values }))
  return { fields, presence }
}

/**
 * How much of a point (frame units) each ring round it takes, in the look's order of rings: all of it well inside a
 * ring's bright middle, none of it past that middle, smoothly between; what one ring takes the next can't.
 */
function ringShares(at: readonly [number, number], rings: readonly Extract<StagePart, { kind: 'spot' }>[], fw: number, fh: number): [FieldWant, number][] {
  const out: [FieldWant, number][] = []
  let rest = 1
  for (const ring of rings) {
    const stretch = ring.stretch ?? 1
    const a = ((ring.angle ?? 0) * Math.PI) / 180
    const du = (at[0] - ring.at[0]) * fw
    const dv = (at[1] - ring.at[1]) * fh
    const q = Math.hypot((du * Math.cos(a) + dv * Math.sin(a)) / (ring.radius * Math.sqrt(stretch)), (-du * Math.sin(a) + dv * Math.cos(a)) / (ring.radius / Math.sqrt(stretch)))
    const mid = 0.5 * (1 + (ring.inner ?? 0) / ring.radius)
    const share = rest * (1 - smooth(0.5 * mid, mid, q))
    if (share > 0 && ring.want) out.push([ring.want, share])
    rest -= share
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
  let presence = [0, 0]
  if (byParts) {
    const warpRng = mulberry32(Math.imul(seed, 104729) + hashText(recipe) + 1)
    const warps = new Map(WARPED.map((want) => [want, [makeNoise(warpRng, fw, fh), makeNoise(warpRng, fw, fh)] as const]))
    const own = partFields(parts, grid, aspect, warps)
    fields.push(...own.fields)
    presence = own.presence
  } else if (isSunrise(recipe)) {
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
  // Dark colors are the room's or the ground's own dark: two broad seeded fields, kept out of a Contour light's haze.
  const seeded: Float32Array[] = []
  for (let k = 0; k < 2; k++) {
    const blob = { cx: -0.15 + rng() * (fw + 0.3), cy: -0.15 + rng() * (fh + 0.3), r: 0.45 + rng() * 0.4, stretch: 1 + rng(), angle: rng() * Math.PI }
    const values = blobField(blob, w, h, fw, fh, nu, nv)
    if (!isSunrise(recipe)) for (let i = 0; i < w * h; i++) values[i] *= 1 - haze[i]
    seeded.push(values)
  }
  // A dark color never sits against bright light, a thin line included: seeded dark fields fade out within two cells of
  // any cell whose brightest point is past mid lightness. A look's own dark spots are its dim room as drawn, so they stay.
  const near = nearPeak(grid, 2)
  const keepOffLight = (values: Float32Array) => {
    for (let i = 0; i < w * h; i++) values[i] *= 1 - smooth(0.45, 0.7, near[i])
  }
  if (byParts) {
    // The seeded dark fields give way as the look's own dark spots come in.
    const own = fields.filter((field) => field.want === 'dark')
    seeded.forEach((values, k) => {
      keepOffLight(values)
      for (let i = 0; i < w * h; i++) own[k].values[i] = Math.max(own[k].values[i], values[i] * (1 - presence[k]))
    })
    return fields
  }
  seeded.forEach((values, k) => fields.push({ name: `dark${k + 1}`, want: 'dark', values }))
  for (const field of fields) if (field.want === 'dark') keepOffLight(field.values)
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
