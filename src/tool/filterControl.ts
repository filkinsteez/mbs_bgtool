import type { DialConfig } from 'dialkit'
import type { OutputSettings, Scene } from '@/light'
import { FILTER_KEYS, type FilterKey } from '@/light/engine/filters'

/** The panel's Filter choice: no filter, or one filter at a time. */
export type FilterChoice = 'none' | FilterKey

export interface FilterState {
  filter: FilterChoice
  /** 0..1, in steps of 0.01. */
  strength: number
}

/** Panel keys; DialKit shows them as "Filter" and "Strength". */
export const FILTER_DIAL_KEY = 'filter'
export const STRENGTH_DIAL_KEY = 'strength'

/** Filters the tool offers, in panel order. A filter joins once it runs in the tool. */
export const TOOL_FILTERS: readonly FilterKey[] = ['grain', 'ascii', 'pixel']

/** Off by default (the brief); a filter turned on starts at 0.5. */
export const DEFAULT_FILTER: FilterState = { filter: 'none', strength: 0.5 }

const LABELS: Readonly<Record<FilterChoice, string>> = { none: 'None', grain: 'Grain', ascii: 'ASCII', pixel: 'Pixel' }

const CHOICES: readonly FilterChoice[] = ['none', ...TOOL_FILTERS]

function readChoice(value: unknown): FilterChoice {
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

/** The Filter choice, and the Strength slider only while a filter is on, so the panel never shows a slider that does nothing. */
export function filterDials(initial: FilterState, showStrength: boolean): DialConfig {
  return {
    [FILTER_DIAL_KEY]: { type: 'select', options: CHOICES.map((value) => ({ value, label: LABELS[value] })), default: readChoice(initial.filter) },
    ...(showStrength ? { [STRENGTH_DIAL_KEY]: [readStrength(initial.strength), 0, 1, 0.01] as [number, number, number, number] } : {}),
  }
}

/** The filter from the panel's live values; anything missing or unknown is no filter at the default strength. */
export function readFilter(values: Readonly<Record<string, unknown>>): FilterState {
  return { filter: readChoice(values[FILTER_DIAL_KEY]), strength: readStrength(values[STRENGTH_DIAL_KEY]) }
}

type QueryInput = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>

function readParam(query: QueryInput, key: string): string | undefined {
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined
  const value = query[key]
  return Array.isArray(value) ? value[0] : value
}

/** `filter=grain&strength=0.5` from a URL query; missing or unknown values give no filter. */
export function parseFilterQuery(query: QueryInput): FilterState {
  return { filter: readChoice(readParam(query, 'filter')), strength: readStrength(readParam(query, 'strength')) }
}

/** The URL query part for a filter, or '' for none, so links without a filter stay as they were. */
export function filterQuery(state: FilterState): string {
  const filter = readChoice(state.filter)
  if (filter === 'none') return ''
  return new URLSearchParams([
    ['filter', filter],
    ['strength', String(readStrength(state.strength))],
  ]).toString()
}

/** The scene with the chosen filter at its strength and every other filter off. */
export function withFilter(scene: Scene, state: FilterState): Scene {
  const output: Partial<OutputSettings> = { ...scene.output }
  for (const key of FILTER_KEYS) output[key] = 0
  const filter = readChoice(state.filter)
  if (filter !== 'none') output[filter] = readStrength(state.strength)
  return { ...scene, output }
}
