import type { Field } from '../field'
import {
  buildCurveField as buildCurrentCurveField,
  compileTerritory as compileCurrentTerritory,
  territoryGrid,
  type TerritoryDeps,
} from '../territory'
import type { CurveSnapshot, TerritoryState } from '../types'
import { V1_META_SYMBOL_GEOMETRY } from './metaSymbol'

// Keep the renderer snapshot on its commit-era symbol while reusing the
// otherwise unchanged territory math. The override is intentional and cannot
// be replaced by a caller.
export function buildCurveField(
  snap: CurveSnapshot,
  outW: number,
  outH: number,
  softness: number,
): Field {
  return buildCurrentCurveField(
    snap,
    outW,
    outH,
    softness,
    V1_META_SYMBOL_GEOMETRY,
  )
}

export function compileTerritory(
  state: TerritoryState,
  deps: TerritoryDeps,
): Field {
  return compileCurrentTerritory(state, {
    ...deps,
    metaSymbol: V1_META_SYMBOL_GEOMETRY,
  })
}

export { territoryGrid }
