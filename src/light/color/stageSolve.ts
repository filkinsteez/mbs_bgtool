import { defaultMix, META_BLUE_HEX, mixColors, type ColorMix } from './mix'
import { linearToOklab } from './oklab'
import type { ColorPack } from './packs'
import { hexToLinear } from './srgb'
import { blurGrid, mulberry32, VISIBLE, type StageField, type StageGrid } from './stageFields'

/** How a color behaves as its light dims (the GLSL chunk reads the same numbers). */
export const KIND_PLAIN = 0
/** Only reads as itself when bright; below that it turns into its darker pack neighbor (Yellow to Orange-red). */
export const KIND_TO_NEIGHBOR = 1
/** Only reads as itself where the design is about as light (Cyan, Lime, Ice, Tan): a light of its own on bright parts. */
export const KIND_BRIGHT = 2
/** A dark color: only at or below its own lightness. */
export const KIND_DARK = 3

/** Blend sharpness: each field's weight to this power, so each color leads in its own place with soft edges. */
export const STAGE_SHARPNESS = 6

const SOLVE_STEPS = 100

/** Lightness from which light starts to turn white: brighter cells count no more than this in the solve. */
const SEEN_CAP = 0.75

/** The share of the light every color the mix asks at 10% or more should read as, at the least, so it shows. */
const SHOW_FLOOR = 0.06

/**
 * How far above its own lightness a dark color may light a look's own dim room (in a look colored by its parts): a
 * little brighter in its own hue, not grey.
 */
const DARK_REACH = 0.06

/** Whether the fields come from the look's parts (partFields starts them with the lead's light). */
export const coloredByParts = (fields: readonly StageField[]): boolean => fields[0]?.want === 'lead'

export interface StageColor {
  hex: string
  /** The color in linear light, scaled so its brightest channel is 1. */
  unit: [number, number, number]
  lightness: number
  chroma: number
  hue: number
  group: 'warm' | 'cool' | 'dark'
  kind: number
  /**
   * The lightness that bounds where the color goes: Yellow starts turning into Orange-red 0.16 under its own; a light
   * color (Cyan, Lime, Ice, Tan) shows from 0.1 under its own; a dark color up to its own.
   */
  edge: number
  /** Lightness over which Yellow turns into Orange-red: above its edge and below it. */
  turn: [number, number]
  /** Lightness over which a light or dark color fades out at its edge: above the edge and below it. */
  fade: [number, number]
  /** Where the color Yellow dims into (Orange-red) is in the list of colors that are on, else -1. */
  neighborIndex: number
  /** Its share in the pack's default mix, for handing out fields. */
  defaultShare: number
  /** The asked share, of the colors that are on. */
  share: number
}

const toUnit = (c: readonly number[]): [number, number, number] => {
  const top = Math.max(1e-6, c[0], c[1], c[2])
  return [c[0] / top, c[1] / top, c[2] / top]
}
export const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

/** The colors that are on, with how each behaves, in pack order. */
export function stageColors(pack: ColorPack, mix: ColorMix, byParts = false): StageColor[] {
  const defaults = defaultMix(pack).shares
  const on = mixColors(pack, mix)
  const base = on.map(({ color, share }) => {
    const linear = hexToLinear(color.hex)
    const [L, a, b] = linearToOklab(linear)
    const chroma = Math.hypot(a, b)
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
    const dark = L < 0.45
    const warm = !dark && chroma > 0.04 && hue >= 20 && hue <= 140
    // Light colors only read as themselves where the design is about as light: Yellow, Lime, Tan, Ice, and Cyan.
    const brightOnly = !dark && ((warm && L >= 0.6 && hue >= 60) || chroma < 0.02 || (!warm && L >= 0.7))
    return {
      hex: color.hex,
      unit: toUnit(linear),
      lightness: L,
      chroma,
      hue,
      group: (dark ? 'dark' : warm ? 'warm' : 'cool') as StageColor['group'],
      brightOnly,
      defaultShare: defaults[pack.colors.indexOf(color)],
      share,
    }
  })
  return base.map((c) => {
    // Yellow dims like fire through a darker warm color within 60 degrees (Orange-red); every other color keeps its
    // own hue from dim to bright, the way the engine draws a light of it.
    const fire =
      c.brightOnly && c.group === 'warm'
        ? base.filter((o) => o !== c && !o.brightOnly && o.group === 'warm' && o.lightness < c.lightness && hueGap(o.hue, c.hue) <= 60).sort((x, y) => hueGap(x.hue, c.hue) - hueGap(y.hue, c.hue))[0]
        : undefined
    const kind = c.group === 'dark' ? KIND_DARK : fire ? KIND_TO_NEIGHBOR : c.brightOnly ? KIND_BRIGHT : KIND_PLAIN
    // In a look colored by its parts, light colors fade over more of the light, so they cross into the dark colors
    // below them as the light falls off, with no gap where a third color shows as a thin line; Yellow hands over to
    // Orange-red a little higher, so Orange-red has more than a rim.
    return {
      hex: c.hex,
      unit: c.unit,
      lightness: c.lightness,
      chroma: c.chroma,
      hue: c.hue,
      group: c.group,
      kind,
      edge: kind === KIND_DARK ? c.lightness + (byParts ? DARK_REACH : 0) : kind === KIND_BRIGHT ? c.lightness - 0.1 : c.lightness - (byParts ? 0.12 : 0.16),
      turn: kind === KIND_TO_NEIGHBOR ? (byParts ? [0.06, 0.14] : [0.08, 0.12]) : [0, 0],
      fade: kind === KIND_DARK ? [0, 0.1] : kind === KIND_BRIGHT ? [0, 0.2] : [0, 0],
      neighborIndex: fire ? base.indexOf(fire) : -1,
      defaultShare: c.defaultShare,
      share: c.share,
    }
  })
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** How much of a color reads as itself at a lightness: a bright-only color only above its turn, as the shader turns it. */
function itself(c: StageColor, lightness: number): number {
  return c.kind === KIND_TO_NEIGHBOR ? smooth(c.edge - c.turn[1], c.edge + c.turn[0], lightness) : 1
}

/** How much a color may show at a lightness: a dark color only at or below its own; the others anywhere. */
export function colorMask(c: StageColor, lightness: number): number {
  if (c.kind === KIND_DARK) return 1 - smooth(c.edge - c.fade[1], c.edge + c.fade[0], lightness)
  if (c.kind === KIND_BRIGHT) return smooth(c.edge - c.fade[1], c.edge + c.fade[0], lightness)
  return 1
}

/**
 * Hands each color a field: the largest default share to the first fields (the look's own come first), ties in a
 * seeded order. A field that asks for warm, cool or dark gets the highest-ranked color of that group when one is on.
 * The user's shares only change the weights later, so a slider never moves a color to another field.
 */
export function assignFields(colors: readonly StageColor[], fields: readonly StageField[], seed: number): number[] {
  const rng = mulberry32(Math.imul(seed, 31) + 7)
  const tie = colors.map(() => rng())
  const ranked = colors.map((_, k) => k).sort((a, b) => colors[b].defaultShare - colors[a].defaultShare || tie[a] - tie[b])
  const out = new Array<number>(colors.length).fill(-1)
  const used = new Set<number>()
  // In a look colored by its parts a color only goes to a place of its group.
  const byParts = coloredByParts(fields)
  fields.forEach((field, f) => {
    if (field.want === 'any') return
    const wanted = (c: StageColor) => {
      switch (field.want) {
        case 'lead':
          return c === colors[ranked[0]]
        case 'bright':
          return c.kind === KIND_TO_NEIGHBOR || c.kind === KIND_BRIGHT
        case 'pale':
          return c.kind === KIND_BRIGHT && !(c.group === 'warm' && c.hue < 100)
        case 'warm':
        case 'cool':
        case 'dark':
          return c.group === field.want
        case 'any':
          return true
        default: {
          const unknown: never = field.want
          throw new Error(`No color for ${String(unknown)}`)
        }
      }
    }
    const free = ranked.filter((c) => out[c] < 0 && wanted(colors[c]))
    // In a look colored by its parts a warm light takes the color that dims like fire, which turns into the color it
    // dims into where the light is lower (Yellow at the core, Orange-red at the edges); with none, the deepest warm
    // color, leaving the lightest for the bright parts (Tan in the warm glow, Lime on the dome).
    let k = free[0]
    if (byParts && field.want === 'warm') k = free.find((c) => colors[c].kind === KIND_TO_NEIGHBOR) ?? [...free].sort((a, b) => colors[a].lightness - colors[b].lightness)[0]
    // A look's dark spots come in the pack's order of its dark colors.
    if (byParts && field.want === 'dark') k = [...free].sort((a, b) => a - b)[0]
    // A pack without a warm color lights its warm places with its brightest color left (Atmospheric's Ice).
    if (k === undefined && field.want === 'warm') k = ranked.filter((c) => out[c] < 0 && colors[c].group !== 'dark').sort((a, b) => colors[b].lightness - colors[a].lightness)[0]
    if (k === undefined) return
    out[k] = f
    used.add(f)
  })
  for (const k of ranked) {
    if (out[k] >= 0) continue
    const { group } = colors[k]
    const dark = group === 'dark'
    let f = fields.findIndex((field, i) => !used.has(i) && (dark ? field.want === 'dark' : byParts ? field.want === group : field.want !== 'dark'))
    // A dark color with no dark place of its own shares one with another dark color. Two colors on one field split it
    // by their weights alone, so in a look colored by its parts no other color shares (Orange-red shows where Yellow
    // dims).
    if (f < 0 && dark) f = fields.findIndex((field) => field.want === 'dark')
    if (f < 0 && !byParts) f = fields.findIndex((_, i) => !used.has(i))
    // No place left for this color in this look: it doesn't show.
    if (f < 0) continue
    out[k] = f
    used.add(f)
  }
  return out
}

/**
 * Each color's field on the stage grid. The dark fields no color takes (more dark spots than dark colors) go to the
 * dark colors in turn; in a pack with no dark color Meta Blue takes them, so the dark there is Meta Blue's own navy
 * and not a dim neighbor's brown.
 */
export function colorFields(fields: readonly StageField[], assignment: readonly number[], colors: readonly StageColor[]): Float32Array[] {
  const out = assignment.map((f) => (f >= 0 ? fields[f].values : new Float32Array(fields[0]?.values.length ?? 0)))
  const taken = new Set(assignment)
  const spare = fields.filter((field, i) => field.want === 'dark' && !taken.has(i))
  const darks = colors.flatMap((c, k) => (c.kind === KIND_DARK && assignment[k] >= 0 ? [k] : []))
  const lead = colors.findIndex((c) => c.hex === META_BLUE_HEX)
  const takers = darks.length ? darks : lead >= 0 ? [lead] : []
  if (!spare.length || !takers.length) return out
  const copied = new Set<number>()
  spare.forEach((field, s) => {
    const k = takers[s % takers.length]
    if (!copied.has(k)) out[k] = Float32Array.from(out[k])
    copied.add(k)
    for (let i = 0; i < out[k].length; i++) out[k][i] = Math.max(out[k][i], field.values[i])
  })
  return out
}

export interface StageSolution {
  /** Per color, its field's weight (the largest is 1). */
  weights: number[]
  /** Per color, the share of the light its field leads (visibly lit cells weighed by lightness), after the solve. */
  light: number[]
  /** Per color, the share of the light that reads as it, after the solve. */
  reads: number[]
}

/**
 * Sets the fields' weights so each color reads as its asked share of the light: the visibly lit cells, each weighed
 * by its lightness up to SEEN_CAP, so a faint glow counts less than the light itself, as by eye. A cell counts toward
 * the color it reads as (Yellow dimmed into Orange-red as Orange-red, light past full strength as no color); Meta Blue
 * is served first, then every color gets enough to show (see `plan` below). Smooth in the shares: a fixed start and a
 * fixed number of damped steps, so close shares give close weights. In a look colored by its parts (`byParts`) every
 * color but the one holding the lead's light gets no more of the light than its own part's (where its field is past
 * about a twentieth), so a small light's color stays on that light; the rest goes to Meta Blue.
 */
export function solveWeights(grid: StageGrid, fields: readonly StageField[], colors: readonly StageColor[], assignment: readonly number[], sharpness = STAGE_SHARPNESS, byParts = false): StageSolution {
  const K = colors.length
  const L = grid.lightness
  const visible: number[] = []
  for (let i = 0; i < L.length; i++) if (grid.coverage[i] > 0) visible.push(i)
  const cover = Float32Array.from(visible, (i) => grid.coverage[i] * Math.min(L[i], SEEN_CAP))
  const n = Math.max(1e-6, cover.reduce((a, b) => a + b, 0))
  const F = assignment.map((f) => fields[f].values)
  // In a look colored by its parts the colors' lightness masks key on the light as the picture shows it.
  const S = byParts ? (grid.seen ?? L) : L
  const masks = colors.map((c) => Float32Array.from(visible, (i) => colorMask(c, Math.max(S[i], VISIBLE))))
  const capped = colors.map((_, k) => byParts && fields[assignment[k]].want !== 'lead')
  const most = masks.map((m, k) => m.reduce((a, b, j) => a + b * cover[j] * (capped[k] ? smooth(0.01, 0.06, F[k][visible[j]]) : 1), 0) / n)
  const asked = colors.map((c) => c.share)
  const askedTotal = asked.reduce((a, b) => a + b, 0) || 1
  const target = asked.map((s) => s / askedTotal)
  const fixed = new Array<boolean>(K).fill(false)
  for (let round = 0; round < K; round++) {
    let excess = 0
    for (let k = 0; k < K; k++)
      if (!fixed[k] && target[k] > most[k] * 0.97) {
        excess += target[k] - most[k] * 0.97
        target[k] = most[k] * 0.97
        fixed[k] = true
      }
    if (excess <= 0) break
    const free = asked.reduce((a, s, k) => a + (fixed[k] ? 0 : s), 0)
    if (free <= 0) break
    for (let k = 0; k < K; k++) if (!fixed[k]) target[k] += (excess * asked[k]) / free
  }
  let weights = colors.map((_, k) => {
    let area = 0
    visible.forEach((i, j) => (area += F[k][i] * masks[k][j] * cover[j]))
    return target[k] / Math.max(area / n, 1e-3)
  })
  const top0 = Math.max(...weights)
  weights = weights.map((w) => w / top0)
  // What each color's light reads as in each cell, the way color-shares.mjs judges a pixel: itself, the neighbor it
  // dims into, the lighter color it brightens into, or nothing (white, past about three times full strength).
  const reads = colors.map((c) => {
    const own = new Float32Array(visible.length)
    const down = new Float32Array(visible.length)
    visible.forEach((i, j) => {
      const l = Math.max(S[i], VISIBLE)
      const seen = 1 - smooth(0.95, 1.1, l)
      const self = itself(c, l)
      own[j] = seen * self
      down[j] = c.neighborIndex >= 0 ? seen * (1 - self) * colorMask(colors[c.neighborIndex], l) : 0
    })
    return { own, down }
  })
  const p = new Float64Array(K)
  /** Per color: the share of the light it leads, what of that reads as itself, and what reads as it from others' turns. */
  const measure = (ws: readonly number[]) => {
    const area = new Array<number>(K).fill(0)
    const own = new Array<number>(K).fill(0)
    const incoming = new Array<number>(K).fill(0)
    const add = (k: number, j: number, amount: number) => {
      area[k] += amount
      own[k] += amount * reads[k].own[j]
      if (colors[k].neighborIndex >= 0) incoming[colors[k].neighborIndex] += amount * reads[k].down[j]
    }
    visible.forEach((i, j) => {
      let s = 0
      for (let k = 0; k < K; k++) {
        p[k] = Math.max(0, ws[k] * F[k][i] * masks[k][j]) ** sharpness
        s += p[k]
      }
      if (s <= 1e-30) {
        // As in the shader: where every weighted field is gone, the strongest field's color takes the pixel.
        let best = 0
        for (let k = 1; k < K; k++) if (F[k][i] * masks[k][j] > F[best][i] * masks[best][j]) best = k
        add(best, j, cover[j])
        return
      }
      for (let k = 0; k < K; k++) add(k, j, (cover[j] * p[k]) / s)
    })
    return { area: area.map((v) => v / n), own: own.map((v) => v / n), incoming: incoming.map((v) => v / n) }
  }
  const lead = colors.findIndex((c) => c.hex === META_BLUE_HEX)
  /**
   * The light each color should lead in this step. Meta Blue first: enough to read its asked share, at most a quarter
   * of the light more than asked so the others keep room. Then every color asked 10% or more gets enough to read SHOW_FLOOR,
   * and what is left goes by the asked shares; both scaled by how much of each color's light reads as itself. A dark
   * color gets no more than the dim cells it may take, and in a look colored by its parts no color gets more than its
   * part's light; the rest goes to Meta Blue.
   */
  const plan = (m: ReturnType<typeof measure>): number[] => {
    const readsAsItself = m.area.map((a, k) => (a > 1e-4 ? Math.min(1, Math.max(0.1, m.own[k] / a)) : 1))
    const need = (k: number, share: number) => Math.max(0, share - m.incoming[k]) / readsAsItself[k]
    const out = new Array<number>(K).fill(0)
    let pool = 1
    if (lead >= 0) {
      out[lead] = Math.min(target[lead] + 0.25, need(lead, target[lead]), 1)
      pool -= out[lead]
    }
    const rest = colors.map((_, k) => k).filter((k) => k !== lead)
    const floor = rest.map((k) => (target[k] >= 0.1 ? need(k, SHOW_FLOOR) : 0))
    const floorSum = floor.reduce((a, b) => a + b, 0)
    const extra = rest.map((k, r) => Math.max(0, need(k, target[k]) - floor[r]))
    const extraSum = extra.reduce((a, b) => a + b, 0)
    rest.forEach((k, r) => {
      if (floorSum >= pool) out[k] = (pool * floor[r]) / Math.max(floorSum, 1e-9)
      else out[k] = floor[r] + (pool - floorSum) * (extraSum > 1e-9 ? extra[r] / extraSum : target[k] / Math.max(1e-9, 1 - (lead >= 0 ? target[lead] : 0)))
    })
    for (let k = 0; k < K; k++) {
      if ((!capped[k] && colors[k].kind !== KIND_DARK && colors[k].kind !== KIND_BRIGHT) || out[k] <= most[k] * 0.97) continue
      const excess = out[k] - most[k] * 0.97
      out[k] -= excess
      if (lead >= 0) out[lead] += excess
    }
    return out
  }
  // Steps shrink as the solve goes, so sharp fields settle instead of swinging past their shares.
  for (let step = 0; step < SOLVE_STEPS; step++) {
    const m = measure(weights)
    const goal = plan(m)
    const rate = Math.max(0.15, 1 - step / SOLVE_STEPS) / sharpness
    weights = weights.map((w, k) => w * Math.min(2, Math.max(0.5, goal[k] / Math.max(m.area[k], 1e-5))) ** rate)
    const top = Math.max(...weights)
    weights = weights.map((w) => w / top)
  }
  const final = measure(weights)
  return { weights, light: final.area, reads: final.own.map((v, k) => v + final.incoming[k]) }
}

/** How much the design's light changes over the distance a color takes to change into the next (soft blend). */
const LIGHT_STEP = 0.08

/** The shortest and longest distance, in grid cells, over which a color changes into the next (soft blend). */
const SOFT_RANGE = [1, 2] as const

/** The longest distance, in grid cells, over which a dark color comes in as the light falls off into the dim. */
const DARK_SOFT_REACH = 2

/** Blur widths, in grid cells, that the soft blend interpolates between. */
const SOFT_LEVELS = [0.5, 1, 2, 4]

/**
 * The soft blend, for a look colored by its parts: each color's share of each grid cell as the firm blend draws it,
 * then spread over the distance the light as the picture shows it (after the lens) changes by LIGHT_STEP there: far
 * where the light is nearly even, a short way at a rim or a fast falloff. So a color changes into the next as
 * gradually as the light does, never as a firm outline round a part on even light. In the dim a lit color's blend
 * with navy reads as neither, so there it changes over at most a cell; a dark color is the dim end of a light and
 * comes in over the whole falloff, up to DARK_SOFT_REACH cells. The shader draws these shares as they are,
 * sharpening only where far hues meet at mid lightness.
 */
export function softFields(grid: StageGrid, values: readonly Float32Array[], colors: readonly StageColor[], weights: readonly number[], sharpness = STAGE_SHARPNESS): Float32Array[] {
  const { width: w, height: h } = grid
  const L = grid.seen ?? grid.lightness
  const n = w * h
  const shares = colors.map(() => new Float32Array(n))
  for (let i = 0; i < n; i++) {
    const l = Math.max(L[i], VISIBLE)
    const x = colors.map((c, k) => Math.max(0, weights[k] * values[k][i] * colorMask(c, l)))
    // Taken relative to the strongest, so a cell where every field is faint still blends smoothly.
    const top = Math.max(...x)
    if (top <= 1e-12) {
      shares[0][i] = 1
      continue
    }
    const q = x.map((v) => (v / top) ** (2 * sharpness))
    const s = q.reduce((a, b) => a + b, 0)
    q.forEach((v, k) => (shares[k][i] = v / s))
  }
  const light = blurGrid(L, w, h, 1)
  const reach = new Float32Array(n)
  const darkReach = new Float32Array(n)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx = (light[y * w + Math.min(w - 1, x + 1)] - light[y * w + Math.max(0, x - 1)]) / 2
      const gy = (light[Math.min(h - 1, y + 1) * w + x] - light[Math.max(0, y - 1) * w + x]) / 2
      const far = LIGHT_STEP / Math.max(Math.hypot(gx, gy), 1e-4) / 2
      const most = SOFT_RANGE[0] + (SOFT_RANGE[1] - SOFT_RANGE[0]) * smooth(0.4, 0.6, light[y * w + x])
      reach[y * w + x] = Math.min(Math.max(1, most), Math.max(SOFT_RANGE[0], far))
      darkReach[y * w + x] = Math.min(DARK_SOFT_REACH, Math.max(SOFT_RANGE[0], far))
    }
  const sigmas = [blurGrid(reach, w, h, 2), blurGrid(darkReach, w, h, 2)]
  return shares.map((share, k) => {
    const sigma = sigmas[colors[k].kind === KIND_DARK ? 1 : 0]
    const blurred = SOFT_LEVELS.map((s) => blurGrid(share, w, h, s))
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const s = Math.min(SOFT_LEVELS[SOFT_LEVELS.length - 1], Math.max(SOFT_LEVELS[0], sigma[i]))
      let l = 0
      while (l < SOFT_LEVELS.length - 2 && SOFT_LEVELS[l + 1] < s) l++
      const t = Math.log(s / SOFT_LEVELS[l]) / Math.log(SOFT_LEVELS[l + 1] / SOFT_LEVELS[l])
      out[i] = blurred[l][i] * (1 - t) + blurred[l + 1][i] * t
    }
    return out
  })
}

/** Pairs of colors far apart in hue (60 degrees or more, both with real chroma): their meeting line is a pale bridge. */
export function farPairs(colors: readonly StageColor[]): number {
  let bits = 0
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++)
      if (colors[i].chroma >= 0.04 && colors[j].chroma >= 0.04 && hueGap(colors[i].hue, colors[j].hue) >= 60) bits |= 1 << (i * 5 + j)
  return bits
}
