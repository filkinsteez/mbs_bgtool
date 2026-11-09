import { EXPORT_ASPECTS, getRecipe, isPackId, isRecipeId, type ExportAspect, type MoodId, type PackId, type RecipeId } from '@/light'
import { clampDrag, clampPoint, DEFAULT_CONTROLS, type LightDrag, type LightPoint } from './controls'
import { DEFAULT_FILTER, filterQuery, parseFilterQuery, type FilterChoice } from './filterControl'
import { lookForSeed } from './seedLook'

/** What the panel and the URL set. Softness and the mood control are fixed per mood (`FIXED_CONTROLS`). */
export interface ToolState {
  mood: MoodId
  look: RecipeId
  pack: PackId
  intensity: number
  seed: number
  format: ExportAspect
  /** The line the user dragged on the image, in frame units (`from=x,y&to=x,y` in the URL). Missing until they drag. */
  drag?: LightDrag
  /** The surface filter (`filter=grain` in the URL), none by default, and its strength 0..1 (`strength=0.5`). */
  filter: FilterChoice
  strength: number
  /** Whether the sample headline shows over the preview (`headline=1` in the URL); off by default, never exported. */
  headline: boolean
}

export const MOOD_IDS: readonly MoodId[] = ['sunset', 'contour']
export const SEED_MIN = 1
export const SEED_MAX = 100

export const DEFAULT_STATE: ToolState = {
  mood: 'sunset',
  look: 'sunset.bands',
  pack: 'bold',
  intensity: DEFAULT_CONTROLS.intensity,
  seed: 1,
  format: '16:9',
  ...DEFAULT_FILTER,
  headline: false,
}

export function isMoodId(value: unknown): value is MoodId {
  return typeof value === 'string' && (MOOD_IDS as readonly string[]).includes(value)
}

export function isExportAspect(value: unknown): value is ExportAspect {
  return typeof value === 'string' && (EXPORT_ASPECTS as readonly string[]).includes(value)
}

/** The look if it belongs to the mood, else the look the seed picks for the mood. */
export function fixLook(mood: MoodId, look: unknown, seed: number): RecipeId {
  if (typeof look === 'string' && isRecipeId(look) && getRecipe(look).mood === mood) return look
  return lookForSeed(mood, seed)
}

/** The mood, seed and look a page opened with. */
export type LinkLook = Pick<ToolState, 'mood' | 'seed' | 'look'>

/**
 * The look the tool shows: the link's own look while the mood and seed are the link's, so a link keeps opening the
 * same picture when the seed's looks change; else the look the seed picks for the mood.
 */
export function shownLook(mood: MoodId, seed: number, link?: LinkLook): RecipeId {
  return link && link.mood === mood && link.seed === seed ? link.look : lookForSeed(mood, seed)
}

export function clampUnit(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
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
const unitToQuery = (value: number) => String(Math.round(value * 100) / 100)

/**
 * Reads the tool state from a URL query; missing or invalid values take the defaults. A missing look, or one from
 * another mood, is the look the seed picks. Old links' `softness`, `horizon` and `light` are ignored, as the panel no
 * longer sets them.
 */
export function parseQuery(query: QueryInput): ToolState {
  const moodParam = readParam(query, 'mood')
  const mood = isMoodId(moodParam) ? moodParam : DEFAULT_STATE.mood
  const lookParam = readParam(query, 'look')
  const pack = readParam(query, 'pack')
  const seed = readSeed(readParam(query, 'seed'), DEFAULT_STATE.seed)
  const format = readParam(query, 'format')?.replace('x', ':')
  const drag = parseDrag(readParam(query, 'from'), readParam(query, 'to'))
  return {
    mood,
    look: fixLook(mood, lookParam && !lookParam.includes('.') ? `${mood}.${lookParam}` : lookParam, seed),
    pack: pack && isPackId(pack) ? pack : DEFAULT_STATE.pack,
    intensity: clampUnit(readParam(query, 'intensity'), DEFAULT_STATE.intensity),
    seed,
    format: isExportAspect(format) ? format : DEFAULT_STATE.format,
    ...(drag ? { drag } : {}),
    ...parseFilterQuery(query),
    headline: readParam(query, 'headline') === '1',
  }
}

/**
 * The URL query (without "?") that reproduces the state. The line's commas are left as they are, so the link stays
 * readable. The sample headline goes after the format and the filter last, each only when on.
 */
export function toQuery(state: ToolState): string {
  const head = new URLSearchParams([
    ['mood', state.mood],
    ['look', shortLook(state.look)],
    ['pack', state.pack],
    ['intensity', unitToQuery(state.intensity)],
  ]).toString()
  const drag = state.drag ? clampDrag(state.drag) : undefined
  const line = drag ? `from=${drag.from.join(',')}&to=${drag.to.join(',')}` : null
  const tail = new URLSearchParams([
    ['seed', String(state.seed)],
    ['format', formatToQuery(state.format)],
    ...(state.headline ? [['headline', '1']] : []),
  ]).toString()
  return [head, line, tail, filterQuery(state)].filter(Boolean).join('&')
}
