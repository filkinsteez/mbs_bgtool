import type { DialConfig } from 'dialkit'
import { EXPORT_ASPECTS, isPackId, PACKS, type MoodId } from '@/light'
import { filterDials, readFilter, STRENGTH_DIAL_KEYS, type FilterChoice } from './filterControl'
import { clampUnit, DEFAULT_STATE, isExportAspect, readSeed, SEED_MAX, SEED_MIN, shownLook, type LinkLook, type ToolState } from './state'

export const PANEL_ID = 'tool'
export const PANEL_NAME = 'Background'
/** Panel key of the seed; the panel shows only Shuffle for it. */
export const SEED_DIAL_KEY = 'seed'
/** Panel key of the pack. */
export const PACK_DIAL_KEY = 'colors'

/**
 * Labels the panel shows in place of DialKit's, which come from the keys: the light's Intensity and the filter's slider
 * both read "Strength" (owner, 2026-11-06). Keys and URL names stay `intensity` and `density`, `strength=`.
 */
export const PANEL_LABELS: Readonly<Record<string, string>> = Object.fromEntries([
  ['intensity', 'Strength'],
  ...Object.values(STRENGTH_DIAL_KEYS).map((key) => [key, 'Strength']),
])

/** The moods the panel offers, by the names the user sees; the code ids stay (`sunset` is Sunrise). */
export const MOOD_OPTIONS = [
  { value: 'sunset', label: 'Sunrise' },
  { value: 'contour', label: 'Contour' },
] satisfies { value: MoodId; label: string }[]

export const PACK_OPTIONS = PACKS.map((pack) => ({ value: pack.id, label: pack.name }))

export const FORMAT_OPTIONS = EXPORT_ASPECTS.map((aspect) => ({ value: aspect, label: aspect }))

/** Panel key of the sample headline's on/off control; DialKit shows it as "Headline". */
export const HEADLINE_DIAL_KEY = 'headline'

/**
 * The panel config, in panel order: the pack and Intensity, the mood and the seed (Shuffle), the filter, the format,
 * the sample headline and Export. Defaults come from the state the page loaded with (the URL), so DialKit's first
 * values already match the link. The Density slider under Filter follows the filter chosen in the panel, none while
 * no filter is; DialKit keeps the other values and resets controls whose old value no longer fits.
 */
export function buildDialConfig(initial: ToolState, exportLabel: string, filter: FilterChoice): DialConfig {
  return {
    [PACK_DIAL_KEY]: { type: 'select', options: PACK_OPTIONS, default: initial.pack },
    intensity: [initial.intensity, 0, 1, 0.01],
    mood: { type: 'select', options: MOOD_OPTIONS, default: initial.mood },
    [SEED_DIAL_KEY]: [initial.seed, SEED_MIN, SEED_MAX, 1],
    ...filterDials(initial, filter),
    format: { type: 'select', options: FORMAT_OPTIONS, default: initial.format },
    [HEADLINE_DIAL_KEY]: initial.headline,
    export: { type: 'action', label: exportLabel },
  }
}

/**
 * Tool state from the panel's live values; anything missing or out of place falls back to a valid value. The look is
 * the link's own look at the link's mood and seed, else the look the seed picks (`shownLook`).
 */
export function readToolState(values: Readonly<Record<string, unknown>>, mood: MoodId, link?: LinkLook): ToolState {
  const pack = values[PACK_DIAL_KEY]
  const format = values.format
  const seed = readSeed(values[SEED_DIAL_KEY], DEFAULT_STATE.seed)
  return {
    mood,
    look: shownLook(mood, seed, link),
    pack: typeof pack === 'string' && isPackId(pack) ? pack : DEFAULT_STATE.pack,
    intensity: clampUnit(values.intensity, DEFAULT_STATE.intensity),
    seed,
    format: isExportAspect(format) ? format : DEFAULT_STATE.format,
    ...readFilter(values),
    headline: values[HEADLINE_DIAL_KEY] === true,
  }
}
