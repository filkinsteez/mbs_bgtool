import type { OutputSettings } from '../../scene'
import { GRAIN_FILTER } from '../grain'
import { PIXEL_FILTER } from './pixel'
import type { FilterKey, OutputFilter } from './types'

export type { FilterFrame, FilterKey, FilterSource, OutputFilter } from './types'

/** Every filter strength in the output settings. */
export const FILTER_KEYS: readonly FilterKey[] = ['grain', 'pixel']

/**
 * The output filter chain, in the order the stages run: grain, then the cell
 * filter, then (in the output pass itself) the sRGB encode and the dither.
 * A filter plugs in by exporting an OutputFilter from its own file in this
 * folder and adding it here.
 */
export const OUTPUT_FILTERS: readonly OutputFilter[] = [GRAIN_FILTER, PIXEL_FILTER]

/** The stages whose strength is above 0, in chain order. */
export function activeFilters(output: OutputSettings): OutputFilter[] {
  return OUTPUT_FILTERS.filter((stage) => output[stage.key] > 0)
}

/** For export file names: `-grain50` for grain at 0.5, one part per stage that is on, '' with none. */
export function filterFileTag(output?: Partial<OutputSettings>): string {
  return OUTPUT_FILTERS.map((stage) => {
    const strength = output?.[stage.key]
    if (typeof strength !== 'number' || !Number.isFinite(strength) || strength <= 0) return ''
    return `-${stage.key}${Math.max(1, Math.round(Math.min(1, strength) * 100))}`
  }).join('')
}
