import { EXPORT_ASPECTS, getPack, isPackId, type ExportAspect, type MoodId, type PackId, type RecipeId } from '@/light'
import { defaultMix, formatMix, mixPercents, parseMix, type ColorMix } from '@/light/color/mix'
import { clampDrag, clampPoint, type LightDrag, type LightPoint } from './controls'
import { DEFAULT_FILTER, filterQuery, parseFilterQuery, type FilterChoice } from './filterControl'

/** What the panel and the URL set. Intensity, softness and the mood control are fixed per mood (`FIXED_CONTROLS`). */
export interface ToolState {
  mood: MoodId
  /** The mood's one look (`MOOD_LOOKS`), which the link names (`look=merged`). */
  look: RecipeId
  pack: PackId
  seed: number
  format: ExportAspect
  /**
   * Each pack color's share of the picture, which the color stage gives the design (`mix=20,10,10,60` in the URL, in
   * pack order; none for the pack's default mix).
   */
  mix: ColorMix
  /** The line the user dragged on the image, in frame units (`from=x,y&to=x,y` in the URL). Missing until they drag. */
  drag?: LightDrag
  /** The surface filter (`filter=grain` in the URL), none by default, and its strength 0..1 (`strength=0.5`). */
  filter: FilterChoice
  strength: number
}

export const MOOD_IDS: readonly MoodId[] = ['sunset', 'contour', 'rush']
export const SEED_MIN = 1
export const SEED_MAX = 100

/**
 * The one look each mood draws, at every seed (owner, 2026-11-10 8:33 AM: the merged Sunrise and Contour looks are
 * the default). The old looks keep their ids and still render by id in the lab and the checks; a link or a history row
 * that names one opens on its mood's look.
 */
export const MOOD_LOOKS: Readonly<Record<MoodId, RecipeId>> = {
  sunset: 'sunset.merged',
  contour: 'contour.merged',
  rush: 'rush.split',
}

export const DEFAULT_STATE: ToolState = {
  mood: 'sunset',
  look: MOOD_LOOKS.sunset,
  pack: 'bold',
  seed: 1,
  format: '16:9',
  mix: defaultMix(getPack('bold')),
  ...DEFAULT_FILTER,
}

export function isMoodId(value: unknown): value is MoodId {
  return typeof value === 'string' && (MOOD_IDS as readonly string[]).includes(value)
}

export function isExportAspect(value: unknown): value is ExportAspect {
  return typeof value === 'string' && (EXPORT_ASPECTS as readonly string[]).includes(value)
}

/** The look the picture draws: the mood's one look. */
export function sceneLook(state: Pick<ToolState, 'mood'>): RecipeId {
  return MOOD_LOOKS[state.mood]
}

/**
 * The seed a panel or URL value gives, SEED_MIN to SEED_MAX. Seeds used to go up to 9999; one above SEED_MAX wraps
 * around (101 is 1, 7976 is 76), so old links still differ from each other. Below SEED_MIN is SEED_MIN; anything
 * that isn't a number is the fallback.
 */
export function readSeed(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  if (!Number.isFinite(n)) return fallback
  const seed = Math.round(n)
  if (seed > SEED_MAX) return ((seed - SEED_MIN) % (SEED_MAX - SEED_MIN + 1)) + SEED_MIN
  return Math.max(SEED_MIN, seed)
}

/** Shuffle's pick: any seed but `current`, each as likely. `random` gives a number from 0 up to but not including 1. */
export function randomSeed(current: number, random: () => number = Math.random): number {
  const pick = SEED_MIN + Math.floor(random() * (SEED_MAX - SEED_MIN))
  return pick >= current ? pick + 1 : pick
}

/** A point from the URL, "x,y" in frame units; anything else is no point. */
export function parsePoint(value: string | undefined): LightPoint | undefined {
  const parts = value?.split(',') ?? []
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return undefined
  const [x, y] = parts.map(Number)
  return Number.isFinite(x) && Number.isFinite(y) ? clampPoint([x, y]) : undefined
}

/** A dragged line from the URL's `from` and `to`; missing, unreadable or too short is no line. */
export function parseDrag(from: string | undefined, to: string | undefined): LightDrag | undefined {
  const start = parsePoint(from)
  const end = parsePoint(to)
  return start && end ? clampDrag({ from: start, to: end }) : undefined
}

/**
 * The mix's whole percents in pack order when it isn't the pack's default; else null, and the URL and the export's
 * file name leave the mix out.
 */
export function customMix(state: Pick<ToolState, 'pack' | 'mix'>): number[] | null {
  return formatMix(getPack(state.pack), state.mix) !== null ? mixPercents(state.mix) : null
}

/** A page's search params as Next.js passes them to the page. */
export type SearchParams = Readonly<Record<string, string | string[] | undefined>>

type QueryInput = URLSearchParams | SearchParams

function readParam(query: QueryInput, key: string): string | undefined {
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined
  const value = query[key]
  return Array.isArray(value) ? value[0] : value
}

const shortLook = (look: RecipeId) => look.slice(look.indexOf('.') + 1)
const formatToQuery = (format: ExportAspect) => format.replace(':', 'x')

/**
 * Reads the tool state from a URL query; missing or invalid values take the defaults. The look is always the mood's
 * own (`MOOD_LOOKS`): an old link's look (`look=bands`, `look=rim` and the others) and its `sunrise=merged` or
 * `contour=merged` open on the mood's merged look, and an old link with `rush=split` opens in Rush, whatever its mood.
 * Old links' `intensity`, `softness`, `horizon` and `light` are ignored, as the panel no longer sets them, and so is
 * their `colormix=`: the color stage is always on (owner, 2026-11-11). A link without `mix=`, or with one that doesn't
 * fit the pack, has the pack's default mix.
 */
export function parseQuery(query: QueryInput): ToolState {
  const moodParam = readParam(query, 'mood')
  const mood = readParam(query, 'rush') === 'split' ? 'rush' : isMoodId(moodParam) ? moodParam : DEFAULT_STATE.mood
  const packParam = readParam(query, 'pack')
  const pack = packParam && isPackId(packParam) ? packParam : DEFAULT_STATE.pack
  const seed = readSeed(readParam(query, 'seed'), DEFAULT_STATE.seed)
  const format = readParam(query, 'format')?.replace('x', ':')
  const drag = parseDrag(readParam(query, 'from'), readParam(query, 'to'))
  return {
    mood,
    look: MOOD_LOOKS[mood],
    pack,
    seed,
    format: isExportAspect(format) ? format : DEFAULT_STATE.format,
    mix: parseMix(getPack(pack), readParam(query, 'mix')),
    ...(drag ? { drag } : {}),
    ...parseFilterQuery(query),
  }
}

/**
 * The URL query (without "?") that reproduces the state. The mix's and the line's commas are left as they are, so the
 * link stays readable. The filter goes last, and only when one is on.
 */
export function toQuery(state: ToolState): string {
  const head = new URLSearchParams([
    ['mood', state.mood],
    ['look', shortLook(state.look)],
    ['pack', state.pack],
  ]).toString()
  const mix = customMix(state)
  const drag = state.drag ? clampDrag(state.drag) : undefined
  const line = drag ? `from=${drag.from.join(',')}&to=${drag.to.join(',')}` : null
  const tail = new URLSearchParams([
    ['seed', String(state.seed)],
    ['format', formatToQuery(state.format)],
  ]).toString()
  return [head, mix ? `mix=${mix.join(',')}` : null, line, tail, filterQuery(state)].filter(Boolean).join('&')
}
