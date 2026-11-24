import type { DialConfig } from 'dialkit'
import type { OutputSettings, Scene } from '@/light'
import { FILTER_KEYS, type FilterKey } from '@/light/engine/filters'

/** The panel's Filter choice: no filter, or one filter at a time. */
export type FilterChoice = 'none' | FilterKey

export interface FilterState {
  filter: FilterChoice
  /** 0..1, in steps of 0.01. */
  strength: number
  /**
   * Pixel's Asymmetrical toggle: blocks in three sizes (true, the default) or every block one cell, an even grid
   * (false). It is true with any other filter.
   */
  asymmetrical: boolean
}

/** Panel key; DialKit shows it as "Filter". */
export const FILTER_DIAL_KEY = 'filter'
/**
 * Panel key of Pixel's toggle under Density; DialKit shows it as "Asymmetrical" with Off and On (owner, 2026-11-17
 * 11:43 AM). It is `asymmetrical=off` in the URL when off and missing when on.
 */
export const ASYMMETRICAL_DIAL_KEY = 'asymmetrical'
/**
 * The key of the slider under Filter for each filter. The tool panel shows it by `STRENGTH_LABELS`. Its value is the
 * filter's strength, `strength` in the URL.
 */
export const STRENGTH_DIAL_KEYS: Readonly<Record<FilterKey, string>> = { grain: 'density', pixel: 'density' }

/**
 * The slider's label for each filter (owner, 2026-11-06 and 2026-11-11): Strength for Grain; Density for Pixel, whose
 * low end gives the biggest cells and high end the smallest.
 */
export const STRENGTH_LABELS: Readonly<Record<FilterKey, string>> = { grain: 'Strength', pixel: 'Density' }

/** Filters the tool offers, in panel order. A filter joins once it runs in the tool. */
export const TOOL_FILTERS: readonly FilterKey[] = ['grain', 'pixel']

/** Off by default (the brief); a filter turned on starts at 0.5, and Pixel with its blocks in three sizes. */
export const DEFAULT_FILTER: FilterState = { filter: 'none', strength: 0.5, asymmetrical: true }

/**
 * The least value Pixel gets in the scene: the filter chain leaves out a filter at 0, but Pixel's Density 0 is its
 * biggest cells, not off. Grain's Strength 0 is no grain.
 */
const DENSITY_FLOOR = 0.001
const FLOORED: readonly FilterKey[] = ['pixel']

const LABELS: Readonly<Record<FilterChoice, string>> = { none: 'None', grain: 'Grain', pixel: 'Pixel' }

const CHOICES: readonly FilterChoice[] = ['none', ...TOOL_FILTERS]

/** The Filter choice's options, in panel order. */
export const FILTER_OPTIONS: readonly { value: FilterChoice; label: string }[] = CHOICES.map((value) => ({ value, label: LABELS[value] }))

/** The filter a panel or URL value picks; anything missing or unknown is none. */
export function readChoice(value: unknown): FilterChoice {
  return typeof value === 'string' && (CHOICES as readonly string[]).includes(value) ? (value as FilterChoice) : 'none'
}

function readStrength(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_FILTER.strength
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
}

/** Whether a panel or URL value turns a filter on. */
export function isFilterOn(value: unknown): boolean {
  return readChoice(value) !== 'none'
}

/**
 * The Filter choice, and under it the chosen filter's Density slider only while one is chosen, so the panel never
 * shows a slider that does nothing. With Pixel, its Asymmetrical toggle goes under the slider.
 */
export function filterDials(initial: FilterState, chosen: FilterChoice): DialConfig {
  return {
    [FILTER_DIAL_KEY]: { type: 'select', options: [...FILTER_OPTIONS], default: readChoice(initial.filter) },
    ...(chosen === 'none' ? {} : { [STRENGTH_DIAL_KEYS[chosen]]: [readStrength(initial.strength), 0, 1, 0.01] as [number, number, number, number] }),
    ...(chosen === 'pixel' ? { [ASYMMETRICAL_DIAL_KEY]: initial.asymmetrical !== false } : {}),
  }
}

/**
 * The filter from the panel's live values; anything missing or unknown is no filter at the default strength, and
 * Asymmetrical is on unless Pixel's toggle is off.
 */
export function readFilter(values: Readonly<Record<string, unknown>>): FilterState {
  const filter = readChoice(values[FILTER_DIAL_KEY])
  return {
    filter,
    strength: readStrength(filter === 'none' ? undefined : values[STRENGTH_DIAL_KEYS[filter]]),
    asymmetrical: filter !== 'pixel' || values[ASYMMETRICAL_DIAL_KEY] !== false,
  }
}

type QueryInput = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>

function readParam(query: QueryInput, key: string): string | undefined {
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined
  const value = query[key]
  return Array.isArray(value) ? value[0] : value
}

/** Values of `asymmetrical=` in a URL that turn Pixel's toggle off; any other value, or none, leaves it on. */
const OFF_VALUES: readonly string[] = ['off', '0', 'false']

/**
 * `filter=pixel&strength=0.5&asymmetrical=off` from a URL query; missing or unknown values give no filter, and a link
 * without `asymmetrical=off` (every link from before the toggle) has Asymmetrical on.
 */
export function parseFilterQuery(query: QueryInput): FilterState {
  const filter = readChoice(readParam(query, 'filter'))
  return {
    filter,
    strength: readStrength(readParam(query, 'strength')),
    asymmetrical: filter !== 'pixel' || !OFF_VALUES.includes(readParam(query, 'asymmetrical')?.toLowerCase() ?? ''),
  }
}

/**
 * The URL query part for a filter, or '' for none, so links without a filter stay as they were. Pixel adds
 * `asymmetrical=off` only while its toggle is off, so links with it on stay as they were too.
 */
export function filterQuery(state: FilterState): string {
  const filter = readChoice(state.filter)
  if (filter === 'none') return ''
  const params = [
    ['filter', filter],
    ['strength', String(readStrength(state.strength))],
  ]
  if (filter === 'pixel' && state.asymmetrical === false) params.push(['asymmetrical', 'off'])
  return new URLSearchParams(params).toString()
}

/**
 * The scene with the chosen filter at its strength and every other filter off. With Pixel and Asymmetrical off it
 * also sets Pixel's even grid (output.pixelEven 1); otherwise the scene has no pixelEven, as before the toggle.
 */
export function withFilter(scene: Scene, state: FilterState): Scene {
  const output: Partial<OutputSettings> = { ...scene.output }
  for (const key of FILTER_KEYS) output[key] = 0
  delete output.pixelEven
  const filter = readChoice(state.filter)
  if (filter !== 'none') {
    const strength = readStrength(state.strength)
    output[filter] = FLOORED.includes(filter) ? Math.max(strength, DENSITY_FLOOR) : strength
  }
  if (filter === 'pixel' && state.asymmetrical === false) output.pixelEven = 1
  return { ...scene, output }
}
