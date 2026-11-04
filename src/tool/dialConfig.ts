import type { DialConfig } from 'dialkit'
import { EXPORT_ASPECTS, isPackId, PACKS, recipesForMood, type MoodId } from '@/light'
import { DEFAULT_CONTROLS, MOOD_DIAL_KEY } from './controls'
import { filterDials, readFilter, type FilterChoice } from './filterControl'
import { clampUnit, DEFAULT_STATE, fixLook, isExportAspect, type ToolState } from './state'

export const PANEL_ID = 'tool'
export const PANEL_NAME = 'Background'

const MOOD_OPTIONS = [
  { value: 'sunset', label: 'Sunset' },
  { value: 'contour', label: 'Contour' },
] satisfies { value: MoodId; label: string }[]

const PACK_OPTIONS = PACKS.map((pack) => ({ value: pack.id, label: pack.name }))

/**
 * The panel config for the current mood. Defaults come from the state the page
 * loaded with (the URL), so DialKit's first values already match the link.
 * The seed is not in the panel: the tool shows it as a typed field next to
 * Back and Shuffle, after the mood control.
 * The look options and the mood control's key change with the mood, and the
 * slider under Filter (Amount or Density) with the filter chosen in the panel,
 * none while no filter is; DialKit keeps the other values and resets controls
 * whose old value no longer fits.
 */
export function buildDialConfig(mood: MoodId, initial: ToolState, exportLabel: string, filter: FilterChoice): DialConfig {
  const looks = recipesForMood(mood)
  const sameMood = mood === initial.mood
  return {
    mood: { type: 'select', options: MOOD_OPTIONS, default: initial.mood },
    look: {
      type: 'select',
      options: looks.map((recipe) => ({ value: recipe.id, label: recipe.label })),
      default: sameMood ? initial.look : looks[0].id,
    },
    colors: { type: 'select', options: PACK_OPTIONS, default: initial.pack },
    ...filterDials(initial, filter),
    intensity: [initial.intensity, 0, 1, 0.01],
    softness: [initial.softness, 0, 1, 0.01],
    [MOOD_DIAL_KEY[mood]]: [sameMood ? initial.moodControl : DEFAULT_CONTROLS.mood, 0, 1, 0.01],
    format: { type: 'select', options: [...EXPORT_ASPECTS], default: initial.format },
    export: { type: 'action', label: exportLabel },
  }
}

/** Tool state from the panel's live values and the seed; anything missing or out of place falls back to a valid value. */
export function readToolState(values: Readonly<Record<string, unknown>>, mood: MoodId, seed: number): ToolState {
  const pack = values.colors
  const format = values.format
  return {
    mood,
    look: fixLook(mood, values.look),
    pack: typeof pack === 'string' && isPackId(pack) ? pack : DEFAULT_STATE.pack,
    intensity: clampUnit(values.intensity, DEFAULT_STATE.intensity),
    softness: clampUnit(values.softness, DEFAULT_STATE.softness),
    moodControl: clampUnit(values[MOOD_DIAL_KEY[mood]], DEFAULT_STATE.moodControl),
    seed,
    format: isExportAspect(format) ? format : DEFAULT_STATE.format,
    ...readFilter(values),
  }
}
