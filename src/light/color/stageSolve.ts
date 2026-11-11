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
  /** A light color whose dim version is a clean color (Cyan), so it neither fades nor turns (in a look colored by its parts). */
  clean?: boolean
  /** Whether the color takes its field before the dim fade (StageField.reach), keeping its share down to black. */
  keepsDark?: boolean
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

/**
 * The colors that are on, with how each behaves, in pack order. In a look colored by its parts the color that dims like
 * fire (Yellow) takes its field from before the dim fade, so the color it dims into (Orange-red) keeps its share down
 * to black, as Cyan does.
 */
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
    // In a look colored by its parts a light cool color whose dim version is a clean color (Cyan: teal) needs no fade
    // and no turn: it keeps its share down to black at the light that is there, using its field before the dim fade
    // (StageField.reach), as Yellow does, whose dim light is Orange-red.
    const clean = byParts && c.brightOnly && c.group === 'cool' && c.chroma >= 0.04
    const kind = c.group === 'dark' ? KIND_DARK : fire ? KIND_TO_NEIGHBOR : c.brightOnly && !clean ? KIND_BRIGHT : KIND_PLAIN
    // In a look colored by its parts Lime, whose dim version is olive, turns into the dark color of a near hue (Forest)
    // where its light falls into that color's own place, over a wide, soft blend; elsewhere it fades as before, so
    // Meta Blue keeps the dim corners (dimEnd, pairedMasks).
    const dim = byParts && kind === KIND_BRIGHT ? dimEnd(c, base) : undefined
    return {
      hex: c.hex,
      unit: c.unit,
      lightness: c.lightness,
      chroma: c.chroma,
      hue: c.hue,
      group: c.group,
      kind,
      edge: kind === KIND_DARK ? c.lightness + (byParts ? DARK_REACH : 0) : kind === KIND_BRIGHT ? c.lightness - 0.1 : c.lightness - (byParts ? 0.12 : 0.16),
      turn: kind === KIND_TO_NEIGHBOR ? (byParts ? [0.06, 0.14] : [0.08, 0.12]) : dim ? DIM_TURN : [0, 0],
      fade: kind === KIND_DARK ? [0, 0.1] : kind === KIND_BRIGHT ? [0, 0.2] : [0, 0],
      neighborIndex: fire ? base.indexOf(fire) : dim ? base.indexOf(dim) : -1,
      clean,
      keepsDark: clean || (byParts && Boolean(fire)),
      defaultShare: c.defaultShare,
      share: c.share,
    }
  })
}

/**
 * Lightness above and below a light color's edge over which it turns into its dim end where that color is present:
 * wide, so the light keeps its color well down its falloff and the change is a soft blend of near hues.
 */
export const DIM_TURN: [number, number] = [0.06, 0.3]

/**
 * The dark pack color a light color dims into where its light falls into that color's place: the one nearest in hue
 * within 60 degrees (Lime's Forest). Tan has none (Forest and Plum are both about 100 degrees away), nor has a
 * near-neutral color (Ice).
 */
function dimEnd<T extends { chroma: number; hue: number; group: string }>(c: T, colors: readonly T[]): T | undefined {
  if (c.chroma < 0.02) return undefined
  return colors
    .filter((o) => o !== c && o.group === 'dark' && hueGap(o.hue, c.hue) <= 60)
    .sort((x, y) => hueGap(x.hue, c.hue) - hueGap(y.hue, c.hue))[0]
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * How much of a color reads as itself at a lightness, as the shader turns it: a color that dims into its neighbor only
 * above its turn; a light color with a dim end only above its turn where that dim end is present (`near`, 0 to 1).
 */
function itself(c: StageColor, lightness: number, near = 0): number {
  if (c.kind === KIND_TO_NEIGHBOR) return smooth(c.edge - c.turn[1], c.edge + c.turn[0], lightness)
  if (c.kind === KIND_BRIGHT && c.neighborIndex >= 0) return 1 - near * (1 - smooth(c.edge - c.turn[1], c.edge + c.turn[0], lightness))
  return 1
}

/** How much a color counts as present in a cell from its field there (pairedMasks, dim ends). */
const presence = (field: number) => smooth(PAIR_PRESENT[0], PAIR_PRESENT[1], field)

/** How much a color may show at a lightness: a dark color only at or below its own; the others anywhere. */
export function colorMask(c: StageColor, lightness: number): number {
  if (c.kind === KIND_DARK) return 1 - smooth(c.edge - c.fade[1], c.edge + c.fade[0], lightness)
  if (c.kind === KIND_BRIGHT) return smooth(c.edge - c.fade[1], c.edge + c.fade[0], lightness)
  return 1
}

/** Field values over which a color counts as present in a cell, for pairedMasks. */
export const PAIR_PRESENT = [0.02, 0.15] as const

/** Half the lightness over which a light color hands over to a dark color where both are present. */
export const PAIR_WIDTH = 0.03

/**
 * The widest lightness gap between a light color's fade and a dark color's that pairedMasks always closes. A wider
 * gap is other colors' light (Meta Blue's, Steel's), so a dark color never climbs into it, unless the light crosses
 * it within PAIR_THIN.
 */
export const PAIR_GAP = 0.08

/**
 * Grid cells: where the light crosses a wider gap within less than these (from the first to the second), the gap is
 * a strip too thin for a color of its own between the two, and they hand over directly.
 */
export const PAIR_THIN = [2, 3] as const

/**
 * The colors' lightness masks in a look colored by its parts. Where a light color that fades out below its own
 * lightness (Tan, Lime, Ice, Cyan) and a dark color that fades out above its own are both present (`present`: each
 * color's field here), and their fades nearly meet (PAIR_GAP) or the light crosses the gap between them in a thin
 * strip (`slope`: how much the light changes per grid cell here; PAIR_THIN), their masks meet at the lightness between
 * the fades: the light color shows above it, the dark color below, so they hand over directly and narrowly along the
 * light, with no strip of a third color between them.
 */
export function pairedMasks(colors: readonly StageColor[], present: readonly number[], lightness: number, slope = 0): number[] {
  const out = colors.map((c) => colorMask(c, lightness))
  colors.forEach((a, j) => {
    if (a.kind !== KIND_BRIGHT) return
    // A light color with a dim end keeps its light down its falloff where the dim end is present (it turns into it).
    if (a.neighborIndex >= 0) out[j] = Math.max(out[j], presence(present[a.neighborIndex]))
    colors.forEach((b, k) => {
      if (b.kind !== KIND_DARK) return
      const low = a.edge - a.fade[1]
      const high = b.edge + b.fade[0]
      const pair = low - high <= PAIR_GAP ? 1 : 1 - smooth(PAIR_THIN[0], PAIR_THIN[1], (low - high) / Math.max(slope, 1e-4))
      if (pair <= 0) return
      const pa = pair * smooth(PAIR_PRESENT[0], PAIR_PRESENT[1], present[j])
      const pb = pair * smooth(PAIR_PRESENT[0], PAIR_PRESENT[1], present[k])
      const at = 0.5 * (low + high)
      const above = smooth(at - PAIR_WIDTH, at + PAIR_WIDTH, lightness)
      out[j] = Math.max(out[j], pb * above)
      out[k] = Math.max(out[k], pa * (1 - above))
    })
  })
  return out
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
          return c.kind === KIND_TO_NEIGHBOR || c.kind === KIND_BRIGHT || c.clean === true
        case 'pale':
          return (c.kind === KIND_BRIGHT || c.clean === true) && !(c.group === 'warm' && c.hue < 100)
        case 'warm':
        case 'cool':
        case 'dark':
          return c.group === field.want
        case 'warm2':
          return c.group === 'warm'
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
 * and not a dim neighbor's brown, and, given the light, only where it is dark under a warm light's falloff. A dark
 * color takes a dark field as it lies on its lines (StageField.onLine).
 */
export function colorFields(fields: readonly StageField[], assignment: readonly number[], colors: readonly StageColor[], lightness?: Float32Array): Float32Array[] {
  const own = (field: StageField, k: number) => (colors[k].keepsDark && field.reach) || (colors[k].kind === KIND_DARK && field.onLine) || field.values
  const out = assignment.map((f, k) => (f >= 0 ? own(fields[f], k) : new Float32Array(fields[0]?.values.length ?? 0)))
  const taken = new Set(assignment)
  const spare = fields.filter((field, i) => field.want === 'dark' && !taken.has(i))
  const darks = colors.flatMap((c, k) => (c.kind === KIND_DARK && assignment[k] >= 0 ? [k] : []))
  const lead = colors.findIndex((c) => c.hex === META_BLUE_HEX)
  const takers = darks.length ? darks : lead >= 0 ? [lead] : []
  if (!spare.length || !takers.length) return out
  // Given the light, under a warm light's falloff Meta Blue takes a dark place only where the light is dark there, so
  // the warm light fades into the dark in its own color before the navy starts, instead of handing over to Meta Blue
  // halfway down its falloff (SHARED 3:52).
  const warm = new Float32Array(out[0]?.length ?? 0)
  if (!darks.length && lightness)
    colors.forEach((c, k) => {
      if (c.keepsDark && c.group === 'warm' && assignment[k] >= 0) for (let i = 0; i < warm.length; i++) warm[i] = Math.max(warm[i], out[k][i])
    })
  const copied = new Set<number>()
  spare.forEach((field, s) => {
    const k = takers[s % takers.length]
    if (!copied.has(k)) out[k] = Float32Array.from(out[k])
    copied.add(k)
    const values = own(field, k)
    for (let i = 0; i < out[k].length; i++) {
      const v = lightness ? values[i] * (1 - smooth(BORROWED_DARK[0], BORROWED_DARK[1], lightness[i]) * Math.min(1, 2 * warm[i])) : values[i]
      out[k][i] = Math.max(out[k][i], v)
    }
  })
  return out
}

/**
 * The light (cube root) over which a dark place Meta Blue takes in a pack with no dark color gives way to a warm
 * light's falloff (fully where the warm color's field is at half or more).
 */
const BORROWED_DARK = [0.22, 0.36] as const

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
  const coverage = byParts ? (grid.softCoverage ?? grid.coverage) : grid.coverage
  for (let i = 0; i < L.length; i++) if (coverage[i] > 0) visible.push(i)
  const cover = Float32Array.from(visible, (i) => coverage[i] * Math.min(L[i], SEEN_CAP))
  const n = Math.max(1e-6, cover.reduce((a, b) => a + b, 0))
  const F = assignment.map((f) => fields[f].values)
  // In a look colored by its parts the colors' lightness masks key on the light as the picture shows it.
  const S = byParts ? (grid.seen ?? L) : L
  const masks = colors.map(() => new Float32Array(visible.length))
  visible.forEach((i, j) => {
    const l = Math.max(S[i], VISIBLE)
    const m = byParts ? pairedMasks(colors, F.map((f) => f[i]), l, grid.slope?.[i] ?? 0) : colors.map((c) => colorMask(c, l))
    m.forEach((v, k) => (masks[k][j] = v))
  })
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
      const self = itself(c, l, c.neighborIndex >= 0 ? presence(F[c.neighborIndex][i]) : 0)
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
  /** Whether the color may lead no more than `most` of the light. */
  const isLimited = (k: number) => capped[k] || colors[k].kind === KIND_DARK || colors[k].kind === KIND_BRIGHT
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
    // In a look colored by its parts no color is planned more light than it may take, so a color that reads as itself
    // in little of its light doesn't take the other colors' part of the floor only to hand it on to Meta Blue.
    const limit = (k: number, v: number) => (byParts && isLimited(k) ? Math.min(v, most[k] * 0.97) : v)
    const floor = rest.map((k) => (target[k] >= 0.1 ? limit(k, need(k, SHOW_FLOOR)) : 0))
    const floorSum = floor.reduce((a, b) => a + b, 0)
    const extra = rest.map((k, r) => Math.max(0, limit(k, need(k, target[k])) - floor[r]))
    const extraSum = extra.reduce((a, b) => a + b, 0)
    rest.forEach((k, r) => {
      if (floorSum >= pool) out[k] = (pool * floor[r]) / Math.max(floorSum, 1e-9)
      else out[k] = floor[r] + (pool - floorSum) * (extraSum > 1e-9 ? extra[r] / extraSum : target[k] / Math.max(1e-9, 1 - (lead >= 0 ? target[lead] : 0)))
    })
    for (let k = 0; k < K; k++) {
      if (!isLimited(k) || out[k] <= most[k] * 0.97) continue
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
 * comes in over the whole falloff, up to DARK_SOFT_REACH cells, and so does a color that keeps its share down to
 * black (Cyan's glow falling to black). The shader draws these shares as they are,
 * sharpening only where far hues meet at mid lightness.
 */
export function softFields(grid: StageGrid, values: readonly Float32Array[], colors: readonly StageColor[], weights: readonly number[], sharpness = STAGE_SHARPNESS): Float32Array[] {
  const { width: w, height: h } = grid
  const L = grid.seen ?? grid.lightness
  const n = w * h
  const shares = colors.map(() => new Float32Array(n))
  for (let i = 0; i < n; i++) {
    const l = Math.max(L[i], VISIBLE)
    const masks = pairedMasks(colors, values.map((v) => v[i]), l, grid.slope?.[i] ?? 0)
    const x = colors.map((_, k) => Math.max(0, weights[k] * values[k][i] * masks[k]))
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
    const sigma = sigmas[colors[k].kind === KIND_DARK || colors[k].keepsDark ? 1 : 0]
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

/** A pack color's dim path for the engine's glow: the color, then the darker colors it turns into as its light dims. */
export interface StageDimPath {
  /** The pack color in linear light. */
  color: readonly number[]
  /**
   * Each darker color in linear light, with the level of the glow's light (its light against its source's, 0 to 1)
   * below which it has taken over, highest first.
   */
  steps: readonly { color: readonly number[]; below: number }[]
}

/**
 * Each color's dim path for the engine's glow, from the turns the stage draws, so a glow fades through the same colors
 * as the light it comes from: Yellow into Orange-red (its fire turn), Lime into Forest (its dim end), and a near-neutral
 * light color into the pack's lightest near-neutral darker color (Ice into Steel), which the stage itself leaves to
 * Meta Blue's light. A step has taken over at the level where its turn ends, the turn's lightness against the color's
 * own (as luminance). Colors that keep their hue down to black (Meta Blue, Cyan, Orange-red, Tan, the dark colors)
 * have no steps.
 */
export function stageDimPaths(colors: readonly StageColor[]): StageDimPath[] {
  const level = (c: StageColor, lightness: number) => Math.min(1, Math.max(0, lightness / c.lightness)) ** 3
  return colors.map((c) => {
    const color = hexToLinear(c.hex)
    if (c.neighborIndex >= 0 && (c.kind === KIND_TO_NEIGHBOR || c.kind === KIND_BRIGHT))
      return { color, steps: [{ color: hexToLinear(colors[c.neighborIndex].hex), below: level(c, c.edge - c.turn[1]) }] }
    if (c.kind === KIND_BRIGHT && c.chroma < 0.02) {
      const darker = colors.filter((o) => o !== c && o.chroma < DIM_NEUTRAL && o.lightness < c.lightness).sort((a, b) => b.lightness - a.lightness)[0]
      if (darker) return { color, steps: [{ color: hexToLinear(darker.hex), below: level(c, c.edge - c.fade[1]) }] }
    }
    return { color, steps: [] }
  })
}

/** Chroma under which a darker pack color counts as near-neutral, for a near-neutral light color's dim path (Steel). */
const DIM_NEUTRAL = 0.06

/** Pairs of colors far apart in hue (60 degrees or more, both with real chroma): their meeting line is a pale bridge. */
export function farPairs(colors: readonly StageColor[]): number {
  let bits = 0
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++)
      if (colors[i].chroma >= 0.04 && colors[j].chroma >= 0.04 && hueGap(colors[i].hue, colors[j].hue) >= 60) bits |= 1 << (i * 5 + j)
  return bits
}
