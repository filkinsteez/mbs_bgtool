import type { DialConfig } from 'dialkit'
import { DEVICE_FRAMES, EXPORT_FORMATS, getPack, isDeviceFormat, isPackId, PACKS, type ColorPack, type DeviceFrame, type ExportFormat, type MoodId } from '@/light'
import { defaultMix, mixFromShares, type ColorMix } from '@/light/color/mix'
import { filterDials, readFilter, STRENGTH_DIAL_KEYS, STRENGTH_LABELS, type FilterChoice } from './filterControl'
import { DEFAULT_STATE, isExportFormat, MOOD_LOOKS, readSeed, SEED_MAX, SEED_MIN, type ToolState } from './state'

export const PANEL_ID = 'tool'
export const PANEL_NAME = 'Background'
/** Panel key of the seed; the panel shows only Shuffle for it. */
export const SEED_DIAL_KEY = 'seed'
/** Panel key of the pack. */
export const PACK_DIAL_KEY = 'colors'
/** Panel key of the color mix. It is never drawn as DialKit's own control: the tool's slot takes its place. */
export const MIX_DIAL_KEY = 'mix'

/**
 * Labels the panel shows in place of DialKit's, which come from the keys: the filter's slider reads "Strength" with
 * Grain and "Density" with Pixel (`STRENGTH_LABELS`). Its key stays `density` and its URL name `strength=`.
 */
export function panelLabels(filter: FilterChoice): Readonly<Record<string, string>> {
  return filter === 'none' ? {} : { [STRENGTH_DIAL_KEYS[filter]]: STRENGTH_LABELS[filter] }
}

/** The moods the panel offers, by the names the user sees; the code ids stay (`sunset` is Sunrise). */
export const MOOD_OPTIONS = [
  { value: 'sunset', label: 'Sunrise' },
  { value: 'contour', label: 'Contour' },
  { value: 'rush', label: 'Rush' },
] satisfies { value: MoodId; label: string }[]

export const PACK_OPTIONS = PACKS.map((pack) => ({ value: pack.id, label: pack.name }))

/** A format's name in the panel and the history: its ratio (`16:9`), or the device's name in Figma (`iPhone 16`). */
export function formatName(format: ExportFormat): string {
  return isDeviceFormat(format) ? DEVICE_FRAMES[format].name : format
}

/** A format's option in the Format list: its name, and for a device Figma's frame size ("iPhone 16 · 393 × 852"). */
function formatLabel(format: ExportFormat): string {
  if (!isDeviceFormat(format)) return format
  const { points } = DEVICE_FRAMES[format]
  return `${formatName(format)} · ${points[0]} × ${points[1]}`
}

export const FORMAT_OPTIONS = EXPORT_FORMATS.map((format) => ({ value: format, label: formatLabel(format) }))

/** The Format list in order: the ratios under "Aspect ratio", then the devices under Figma's Phone, Tablet and Desktop. */
export const FORMAT_GROUPS: readonly { title: DeviceFrame['group'] | 'Aspect ratio'; options: typeof FORMAT_OPTIONS }[] = [
  { title: 'Aspect ratio', options: FORMAT_OPTIONS.filter((option) => !isDeviceFormat(option.value)) },
  ...(['Phone', 'Tablet', 'Desktop'] as const).map((title) => ({
    title,
    options: FORMAT_OPTIONS.filter((option) => isDeviceFormat(option.value) && DEVICE_FRAMES[option.value].group === title),
  })),
]

/**
 * The mix as the panel keeps it: every share in full, not the URL's whole percents, so moving one color many times
 * never rounds the others' ratios.
 */
export const mixPanelValue = (mix: ColorMix): string => mix.shares.join(',')

function readMix(pack: ColorPack, value: unknown): ColorMix {
  const mix = typeof value === 'string' ? mixFromShares(pack, value.split(',').map(Number)) : null
  return mix ?? defaultMix(pack)
}

/**
 * The panel config, in panel order: the pack and its mix, the mood and the seed (Shuffle), the filter, the format
 * and Export. Defaults come from the state the page loaded with (the URL), so DialKit's first values already match the
 * link. The Density slider under Filter follows the filter chosen in the panel, none while no filter is; DialKit keeps
 * the other values and resets controls whose old value no longer fits.
 */
export function buildDialConfig(initial: ToolState, exportLabel: string, filter: FilterChoice): DialConfig {
  return {
    [PACK_DIAL_KEY]: { type: 'select', options: PACK_OPTIONS, default: initial.pack },
    [MIX_DIAL_KEY]: { type: 'text', default: mixPanelValue(initial.mix) },
    mood: { type: 'select', options: MOOD_OPTIONS, default: initial.mood },
    [SEED_DIAL_KEY]: [initial.seed, SEED_MIN, SEED_MAX, 1],
    ...filterDials(initial, filter),
    format: { type: 'select', options: FORMAT_OPTIONS, default: initial.format },
    export: { type: 'action', label: exportLabel },
  }
}

/**
 * Tool state from the panel's live values; anything missing or out of place falls back to a valid value. The look is
 * the mood's one look (`MOOD_LOOKS`). The mix is the panel's, which the color percentages set.
 */
export function readToolState(values: Readonly<Record<string, unknown>>, mood: MoodId): ToolState {
  const packValue = values[PACK_DIAL_KEY]
  const pack = typeof packValue === 'string' && isPackId(packValue) ? packValue : DEFAULT_STATE.pack
  const format = values.format
  const seed = readSeed(values[SEED_DIAL_KEY], DEFAULT_STATE.seed)
  return {
    mood,
    look: MOOD_LOOKS[mood],
    pack,
    seed,
    format: isExportFormat(format) ? format : DEFAULT_STATE.format,
    mix: readMix(getPack(pack), values[MIX_DIAL_KEY]),
    ...readFilter(values),
  }
}
