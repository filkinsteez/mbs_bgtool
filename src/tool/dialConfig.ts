import type { DialConfig } from 'dialkit'
import { EXPORT_ASPECTS, isPackId, PACKS, recipesForMood, type MoodId } from '@/light'
import { DEFAULT_CONTROLS, MOOD_DIAL_KEY } from './controls'
import { filterDials, readFilter, type FilterChoice } from './filterControl'
import { clampUnit, DEFAULT_STATE, fixLook, isExportAspect, readSeed, SEED_MAX, SEED_MIN, type ToolState } from './state'

export const PANEL_ID = 'tool'
export const PANEL_NAME = 'Background'
/** Panel key of the seed; the panel shows only Shuffle for it. */
export const SEED_DIAL_KEY = 'seed'
/** Panel key of the pack. */
export const PACK_DIAL_KEY = 'colors'

export const MOOD_OPTIONS = [
  { value: 'sunset', label: 'Sunset' },
  { value: 'contour', label: 'Contour' },
] satisfies { value: MoodId; label: string }[]

export const PACK_OPTIONS = PACKS.map((pack) => ({ value: pack.id, label: pack.name }))

export const FORMAT_OPTIONS = EXPORT_ASPECTS.map((aspect) => ({ value: aspect, label: aspect }))

export const lookOptions = (mood: MoodId) => recipesForMood(mood).map((recipe) => ({ value: recipe.id, label: recipe.label }))

/**
 * The panel config for the current mood. Defaults come from the state the page
 * loaded with (the URL), so DialKit's first values already match the link.
 * The look options and the mood control's key change with the mood, and the
 * Density slider under Filter with the filter chosen in the panel,
 * none while no filter is; DialKit keeps the other values and resets controls
 * whose old value no longer fits.
 */
export function buildDialConfig(mood: MoodId, initial: ToolState, exportLabel: string, filter: FilterChoice): DialConfig {
  const looks = recipesForMood(mood)
  const sameMood = mood === initial.mood
  return {
    mood: { type: 'select', options: MOOD_OPTIONS, default: initial.mood },
    look: { type: 'select', options: lookOptions(mood), default: sameMood ? initial.look : looks[0].id },
    [PACK_DIAL_KEY]: { type: 'select', options: PACK_OPTIONS, default: initial.pack },
    intensity: [initial.intensity, 0, 1, 0.01],
    softness: [initial.softness, 0, 1, 0.01],
    [MOOD_DIAL_KEY[mood]]: [sameMood ? initial.moodControl : DEFAULT_CONTROLS.mood, 0, 1, 0.01],
    [SEED_DIAL_KEY]: [initial.seed, SEED_MIN, SEED_MAX, 1],
    ...filterDials(initial, filter),
    format: { type: 'select', options: FORMAT_OPTIONS, default: initial.format },
    export: { type: 'action', label: exportLabel },
  }
}

/** Tool state from the panel's live values; anything missing or out of place falls back to a valid value. */
export function readToolState(values: Readonly<Record<string, unknown>>, mood: MoodId): ToolState {
  const pack = values[PACK_DIAL_KEY]
  const format = values.format
  return {
    mood,
    look: fixLook(mood, values.look),
    pack: typeof pack === 'string' && isPackId(pack) ? pack : DEFAULT_STATE.pack,
    intensity: clampUnit(values.intensity, DEFAULT_STATE.intensity),
    softness: clampUnit(values.softness, DEFAULT_STATE.softness),
    moodControl: clampUnit(values[MOOD_DIAL_KEY[mood]], DEFAULT_STATE.moodControl),
    seed: readSeed(values[SEED_DIAL_KEY], DEFAULT_STATE.seed),
    format: isExportAspect(format) ? format : DEFAULT_STATE.format,
    ...readFilter(values),
  }
}
