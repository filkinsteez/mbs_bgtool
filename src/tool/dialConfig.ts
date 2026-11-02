import type { DialConfig, SelectConfig } from 'dialkit'
import { EXPORT_ASPECTS, isPackId, PACKS, recipesForMood, type MoodId } from '@/light'
import { DEFAULT_CONTROLS, MOOD_CONTROL } from './controls'
import type { PanelAccess, SelectAccess, SliderAccess } from './panelAccess'
import { clampSeed, clampUnit, DEFAULT_STATE, fixLook, isExportAspect, SEED_MAX, SEED_MIN, type ToolState } from './state'

export const PANEL_ID = 'tool'
export const PANEL_NAME = 'Background'

const MOOD_OPTIONS = [
  { value: 'sunset', label: 'Sunset' },
  { value: 'contour', label: 'Contour' },
] satisfies { value: MoodId; label: string }[]

const PACK_OPTIONS = PACKS.map((pack) => ({ value: pack.id, label: pack.name }))

/** DialKit labels controls from their keys; this mirrors its rule so code can find a control by label. */
export function dialLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

/**
 * The panel config for the current mood. Defaults come from the state the page
 * loaded with (the URL), so DialKit's first values already match the link.
 * The look options and the mood control's key change with the mood; DialKit
 * keeps the other values and resets controls whose old value no longer fits.
 */
export function buildDialConfig(mood: MoodId, initial: ToolState, exportLabel: string): DialConfig {
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
    intensity: [initial.intensity, 0, 1, 0.01],
    softness: [initial.softness, 0, 1, 0.01],
    [MOOD_CONTROL[mood]]: [sameMood ? initial.moodControl : DEFAULT_CONTROLS.mood, 0, 1, 0.01],
    seed: [initial.seed, SEED_MIN, SEED_MAX, 1],
    shuffle: { type: 'action' },
    format: { type: 'select', options: [...EXPORT_ASPECTS], default: initial.format },
    export: { type: 'action', label: exportLabel },
  }
}

const titleCase = (text: string) => text.replace(/\b\w/g, (c) => c.toUpperCase())

function swatchBackground(hexes: readonly string[]): string {
  const share = 100 / hexes.length
  const stops = hexes.map((hex, i) => `${hex} ${(i * share).toFixed(2)}% ${((i + 1) * share).toFixed(2)}%`)
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

const PACK_SWATCHES: Readonly<Record<string, string>> = Object.fromEntries(
  PACKS.map((pack) => [pack.name, swatchBackground(pack.colors.map((color) => color.hex))]),
)

type SliderConfig = [number, number, number, number?]

function isSlider(control: DialConfig[string]): control is SliderConfig {
  return Array.isArray(control) && control.length >= 3 && control.every((n) => typeof n === 'number' || n === undefined)
}

function isSelect(control: DialConfig[string]): control is SelectConfig {
  return typeof control === 'object' && !Array.isArray(control) && control.type === 'select' && 'options' in control
}

/** The sliders and selects in a panel config, for the keyboard layer, plus the busy action labels. */
export function panelAccessFor(config: DialConfig, busy: readonly string[]): PanelAccess {
  const sliders: SliderAccess[] = []
  const selects: SelectAccess[] = []
  for (const [key, control] of Object.entries(config)) {
    const label = dialLabel(key)
    if (isSlider(control)) {
      const [, min, max, step] = control
      sliders.push({ path: key, label, min, max, step: step ?? 0.01 })
    } else if (isSelect(control)) {
      const options = control.options.map((option) => (typeof option === 'string' ? { value: option, label: titleCase(option) } : option))
      selects.push({ path: key, label, options })
    }
  }
  return { sliders, selects, busy, swatches: PACK_SWATCHES }
}

/** Tool state from the panel's live values; anything missing or out of place falls back to a valid value. */
export function readToolState(values: Readonly<Record<string, unknown>>, mood: MoodId): ToolState {
  const pack = values.colors
  const format = values.format
  return {
    mood,
    look: fixLook(mood, values.look),
    pack: typeof pack === 'string' && isPackId(pack) ? pack : DEFAULT_STATE.pack,
    intensity: clampUnit(values.intensity, DEFAULT_STATE.intensity),
    softness: clampUnit(values.softness, DEFAULT_STATE.softness),
    moodControl: clampUnit(values[MOOD_CONTROL[mood]], DEFAULT_STATE.moodControl),
    seed: clampSeed(values.seed, DEFAULT_STATE.seed),
    format: isExportAspect(format) ? format : DEFAULT_STATE.format,
  }
}
