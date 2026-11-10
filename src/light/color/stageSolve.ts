import { defaultMix, mixColors, type ColorMix } from './mix'
import { linearToOklab } from './oklab'
import type { ColorPack } from './packs'
import { hexToLinear } from './srgb'
import { mulberry32, VISIBLE, type StageField, type StageGrid } from './stageFields'

/** How a color behaves as its light dims (the GLSL chunk reads the same numbers). */
export const KIND_PLAIN = 0
/** Only reads as itself when bright; below that it turns into its darker pack neighbor (Yellow to Orange-red). */
export const KIND_TO_NEIGHBOR = 1
/** Only reads as itself when bright and has no darker neighbor (Tan in Elemental): it turns neutral instead. */
export const KIND_TO_NEUTRAL = 2
/** A dark color: only at or below its own lightness. */
export const KIND_DARK = 3

/** Blend sharpness: each field's weight to this power, so each color leads in its own place with soft edges. */
export const STAGE_SHARPNESS = 6

const SOLVE_STEPS = 100

/** Lightness from which light starts to turn white: brighter cells count no more than this in the solve. */
const SEEN_CAP = 0.75

export interface StageColor {
  hex: string
  /** The color in linear light, scaled so its brightest channel is 1. */
  unit: [number, number, number]
  lightness: number
  chroma: number
  hue: number
  group: 'warm' | 'cool' | 'dark'
  kind: number
  /** Bright-only colors: the lightness where they start to turn (16 below their own). Dark colors: their own lightness. */
  edge: number
  /** Lightness over which a bright-only color turns: above its edge and below it. */
  turn: [number, number]
  /** What a bright-only color turns into, brightest channel 1. */
  neighbor: [number, number, number]
  /**
   * A warm color with a lighter warm neighbor (Orange-red with Yellow) turns into it as its light grows, as a fire's
   * core goes yellow and then white: that neighbor, and the lightness where the turn starts (2 for none).
   */
  upper: [number, number, number]
  upperFrom: number
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
export function stageColors(pack: ColorPack, mix: ColorMix): StageColor[] {
  const defaults = defaultMix(pack).shares
  const on = mixColors(pack, mix)
  const base = on.map(({ color, share }) => {
    const linear = hexToLinear(color.hex)
    const [L, a, b] = linearToOklab(linear)
    const chroma = Math.hypot(a, b)
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
    const dark = L < 0.45
    const warm = !dark && chroma > 0.04 && hue >= 20 && hue <= 140
    const brightOnly = !dark && ((warm && L >= 0.6 && hue >= 60) || chroma < 0.02)
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
    let neighbor: (typeof base)[number] | undefined
    if (c.brightOnly) {
      const darker = base.filter((o) => o !== c && !o.brightOnly && o.lightness < c.lightness)
      neighbor =
        c.chroma < 0.02
          ? darker.filter((o) => o.group !== 'dark' && o.chroma < 0.06).sort((x, y) => y.lightness - x.lightness)[0]
          : darker.filter((o) => o.chroma >= 0.04 && hueGap(o.hue, c.hue) <= 60).sort((x, y) => hueGap(x.hue, c.hue) - hueGap(y.hue, c.hue))[0]
    }
    const upper =
      c.group === 'warm' && !c.brightOnly
        ? base.filter((o) => o !== c && o.group === 'warm' && o.lightness > c.lightness + 0.1 && hueGap(o.hue, c.hue) <= 60)[0]
        : undefined
    const kind = c.group === 'dark' ? KIND_DARK : !c.brightOnly ? KIND_PLAIN : neighbor ? KIND_TO_NEIGHBOR : KIND_TO_NEUTRAL
    const turn: [number, number] = kind === KIND_TO_NEIGHBOR ? (c.chroma < 0.02 ? [0.05, 0.25] : [0.08, 0.12]) : kind === KIND_TO_NEUTRAL ? [0.05, 0.1] : [0, 0]
    return {
      hex: c.hex,
      unit: c.unit,
      lightness: c.lightness,
      chroma: c.chroma,
      hue: c.hue,
      group: c.group,
      kind,
      edge: kind === KIND_DARK ? c.lightness : c.lightness - 0.16,
      turn,
      neighbor: neighbor ? neighbor.unit : kind === KIND_TO_NEUTRAL ? [1, 1, 1] : c.unit,
      upper: upper ? upper.unit : c.unit,
      upperFrom: upper ? c.lightness + 0.04 : 2,
      defaultShare: c.defaultShare,
      share: c.share,
    }
  })
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** How much a color may show at a lightness: a dark color only at or below its own; the others anywhere. */
export function colorMask(c: StageColor, lightness: number): number {
  return c.kind === KIND_DARK ? 1 - smooth(c.edge - 0.12, c.edge + 0.06, lightness) : 1
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
  fields.forEach((field, f) => {
    if (field.want === 'any') return
    const wanted = (c: StageColor) => (field.want === 'bright' ? c.kind === KIND_TO_NEIGHBOR || c.kind === KIND_TO_NEUTRAL : c.group === field.want)
    let k = ranked.find((c) => out[c] < 0 && wanted(colors[c]))
    // A pack without a warm color lights its warm places with its brightest color left (Atmospheric's Ice).
    if (k === undefined && field.want === 'warm') k = ranked.filter((c) => out[c] < 0 && colors[c].group !== 'dark').sort((a, b) => colors[b].lightness - colors[a].lightness)[0]
    if (k === undefined) return
    out[k] = f
    used.add(f)
  })
  for (const k of ranked) {
    if (out[k] >= 0) continue
    const dark = colors[k].group === 'dark'
    let f = fields.findIndex((field, i) => !used.has(i) && (dark ? field.want === 'dark' : field.want !== 'dark'))
    if (f < 0) f = fields.findIndex((_, i) => !used.has(i))
    if (f < 0) f = 0
    out[k] = f
    used.add(f)
  }
  return out
}

export interface StageSolution {
  /** Per color, its field's weight (the largest is 1). */
  weights: number[]
  /** Per color, the share of the visibly lit cells its field leads, after the solve. */
  light: number[]
}

/**
 * Sets the fields' weights so each color leads its asked share of the light: the visibly lit cells, each weighed by
 * its lightness up to SEEN_CAP, so a faint glow counts less than the light itself, as by eye. A dark color asked for
 * more than the dim cells it may take gets all of them; the rest goes to the others in their ratios. Smooth in the
 * shares: a fixed start and a fixed number of damped steps, so close shares give close weights.
 */
export function solveWeights(grid: StageGrid, fields: readonly StageField[], colors: readonly StageColor[], assignment: readonly number[], sharpness = STAGE_SHARPNESS): StageSolution {
  const K = colors.length
  const L = grid.lightness
  const visible: number[] = []
  for (let i = 0; i < L.length; i++) if (grid.coverage[i] > 0) visible.push(i)
  const cover = Float32Array.from(visible, (i) => grid.coverage[i] * Math.min(L[i], SEEN_CAP))
  const n = Math.max(1e-6, cover.reduce((a, b) => a + b, 0))
  const F = assignment.map((f) => fields[f].values)
  const masks = colors.map((c) => Float32Array.from(visible, (i) => colorMask(c, Math.max(L[i], VISIBLE))))
  const most = masks.map((m) => m.reduce((a, b, j) => a + b * cover[j], 0) / n)
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
  const p = new Float64Array(K)
  const shares = (ws: readonly number[]) => {
    const light = new Array<number>(K).fill(0)
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
        light[best] += cover[j]
        return
      }
      for (let k = 0; k < K; k++) light[k] += (cover[j] * p[k]) / s
    })
    return light.map((v) => v / n)
  }
  // Steps shrink as the solve goes, so sharp fields settle instead of swinging past their shares.
  for (let step = 0; step < SOLVE_STEPS; step++) {
    const light = shares(weights)
    const rate = Math.max(0.15, 1 - step / SOLVE_STEPS) / sharpness
    weights = weights.map((w, k) => w * Math.min(2, Math.max(0.5, target[k] / Math.max(light[k], 1e-5))) ** rate)
    const top = Math.max(...weights)
    weights = weights.map((w) => w / top)
  }
  return { weights, light: shares(weights) }
}

/** Pairs of colors far apart in hue (60 degrees or more, both with real chroma): their meeting line is a pale bridge. */
export function farPairs(colors: readonly StageColor[]): number {
  let bits = 0
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++)
      if (colors[i].chroma >= 0.04 && colors[j].chroma >= 0.04 && hueGap(colors[i].hue, colors[j].hue) >= 60) bits |= 1 << (i * 5 + j)
  return bits
}
