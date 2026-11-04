import {
  EXPORT_ASPECTS,
  getRecipe,
  isPackId,
  isRecipeId,
  recipesForMood,
  type ExportAspect,
  type MoodId,
  type PackId,
  type RecipeId,
} from '@/light'
import { clampPoint, DEFAULT_CONTROLS, MOOD_CONTROL, type LightPoint } from './controls'
import { DEFAULT_FILTER, filterQuery, parseFilterQuery, type FilterChoice } from './filterControl'

export interface ToolState {
  mood: MoodId
  look: RecipeId
  pack: PackId
  intensity: number
  softness: number
  /** Horizon for Sunset, Light position for Contour (`light` in the URL). */
  moodControl: number
  seed: number
  format: ExportAspect
  /** Where the user dragged the light, in frame units (`point=x,y` in the URL). Missing until they drag. */
  point?: LightPoint
  /** The surface filter (`filter=grain` in the URL), none by default, and its strength 0..1 (`strength=0.5`). */
  filter: FilterChoice
  strength: number
}

export const MOOD_IDS: readonly MoodId[] = ['sunset', 'contour']
export const SEED_MIN = 1
export const SEED_MAX = 9999

export const DEFAULT_STATE: ToolState = {
  mood: 'sunset',
  look: 'sunset.ramp',
  pack: 'bold',
  intensity: DEFAULT_CONTROLS.intensity,
  softness: DEFAULT_CONTROLS.softness,
  moodControl: DEFAULT_CONTROLS.mood,
  seed: 1,
  format: '16:9',
  ...DEFAULT_FILTER,
}

export function isMoodId(value: unknown): value is MoodId {
  return typeof value === 'string' && (MOOD_IDS as readonly string[]).includes(value)
}

export function isExportAspect(value: unknown): value is ExportAspect {
  return typeof value === 'string' && (EXPORT_ASPECTS as readonly string[]).includes(value)
}

/** The look if it belongs to the mood, else the mood's first recipe. */
export function fixLook(mood: MoodId, look: unknown): RecipeId {
  if (typeof look === 'string' && isRecipeId(look) && getRecipe(look).mood === mood) return look
  return recipesForMood(mood)[0].id
}

export function clampUnit(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
}

export function clampSeed(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(SEED_MAX, Math.max(SEED_MIN, Math.round(n)))
}

/** A point from the URL, "x,y" in frame units; anything else is no point. */
export function parsePoint(value: string | undefined): LightPoint | undefined {
  const parts = value?.split(',') ?? []
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return undefined
  const [x, y] = parts.map(Number)
  return Number.isFinite(x) && Number.isFinite(y) ? clampPoint([x, y]) : undefined
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

/** Reads the tool state from a URL query; missing or invalid values take the defaults. */
export function parseQuery(query: QueryInput): ToolState {
  const moodParam = readParam(query, 'mood')
  const mood = isMoodId(moodParam) ? moodParam : DEFAULT_STATE.mood
  const lookParam = readParam(query, 'look')
  const pack = readParam(query, 'pack')
  const format = readParam(query, 'format')?.replace('x', ':')
  const point = parsePoint(readParam(query, 'point'))
  return {
    mood,
    look: fixLook(mood, lookParam && !lookParam.includes('.') ? `${mood}.${lookParam}` : lookParam),
    pack: pack && isPackId(pack) ? pack : DEFAULT_STATE.pack,
    intensity: clampUnit(readParam(query, 'intensity'), DEFAULT_STATE.intensity),
    softness: clampUnit(readParam(query, 'softness'), DEFAULT_STATE.softness),
    moodControl: clampUnit(readParam(query, MOOD_CONTROL[mood]), DEFAULT_STATE.moodControl),
    seed: clampSeed(readParam(query, 'seed'), DEFAULT_STATE.seed),
    format: isExportAspect(format) ? format : DEFAULT_STATE.format,
    ...(point ? { point } : {}),
    ...parseFilterQuery(query),
  }
}

/**
 * The URL query (without "?") that reproduces the state. The point's comma is left as it is, so the link stays
 * readable. The filter goes last, and only when one is on.
 */
export function toQuery(state: ToolState): string {
  const head = new URLSearchParams([
    ['mood', state.mood],
    ['look', shortLook(state.look)],
    ['pack', state.pack],
    ['intensity', unitToQuery(state.intensity)],
    ['softness', unitToQuery(state.softness)],
    [MOOD_CONTROL[state.mood], unitToQuery(state.moodControl)],
  ]).toString()
  const point = state.point ? `point=${clampPoint(state.point).join(',')}` : null
  const tail = new URLSearchParams([
    ['seed', String(state.seed)],
    ['format', formatToQuery(state.format)],
  ]).toString()
  return [head, point, tail, filterQuery(state)].filter(Boolean).join('&')
}
