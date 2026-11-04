import type { OutputSettings } from '../../scene'
import { GRAIN_FILTER } from '../grain'
import type { OutputFilter } from './types'

export type { FilterFrame, FilterKey, FilterSource, OutputFilter } from './types'

/**
 * The output filter chain, in the order the stages run: grain, then the cell
 * filters, then (in the output pass itself) the sRGB encode and the dither.
 * A filter plugs in by exporting an OutputFilter from its own file in this
 * folder and adding it here.
 */
export const OUTPUT_FILTERS: readonly OutputFilter[] = [GRAIN_FILTER]

/** The stages whose strength is above 0, in chain order. */
export function activeFilters(output: OutputSettings): OutputFilter[] {
  return OUTPUT_FILTERS.filter((stage) => output[stage.key] > 0)
}
