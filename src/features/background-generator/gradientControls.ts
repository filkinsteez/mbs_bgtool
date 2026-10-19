import type { GradientSettings } from '@/core/lab/types'
import { normalizeDeformation, type Deformation } from '@/core/lab/gradients/deformation'
import {
  activeSpatialSources,
  normalizeSpatialGradientField,
  type SpatialGradientField,
} from '@/core/lab/gradients/spatialField'
import {
  CURATED_PRESETS,
  DEFAULT_PRESET_ID,
  ELEMENTAL_ACCENTS,
  findPreset,
  PRODUCTION_COLOR_PACKS,
  type GradientFamily,
  type ProductionColorPackId,
  type SemanticGradientControls,
} from './curatedPresets'
import type { ColorMix } from './palette/registry'

export type ProductionGradientState = {
  presetId: string
  controls: SemanticGradientControls
  orientation: 0 | 90 | 180 | 270
  center: {
    x: number
    y: number
  }
  field: SpatialGradientField
  deformation?: Deformation
}

export type ProductionPaletteState = {
  packId: ProductionColorPackId
  elementalAccent: string
  boundaries: [number, number]
}

type LegacyPaletteState = Partial<ProductionPaletteState> & {
  metaBlueShare?: unknown
}

const MIN_BOUNDARY = 0
const MAX_BOUNDARY = 100

const clamp01 = (value: number, fallback = 0.5) =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : fallback))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ease = (t: number) => {
  const n = clamp01(t)
  return n * n * (3 - 2 * n)
}

export function sourceSoftnessHeadroom(value: number): number {
  return ease((clamp01(value) - 0.8) / 0.2)
}

function mapControlFromBaseline(
  value: number,
  baseline: number,
  pivot: number,
): number {
  const next = clamp01(value)
  const base = clamp01(baseline)
  if (next <= pivot) {
    return pivot <= 0 ? 0 : base * (next / pivot)
  }
  return pivot >= 1
    ? 1
    : base + (1 - base) * ((next - pivot) / (1 - pivot))
}

function controlValueForMappedValue(
  value: number,
  baseline: number,
  pivot: number,
): number {
  const next = clamp01(value)
  const base = clamp01(baseline)
  if (next <= base) {
    return base <= 0 ? 0 : pivot * (next / base)
  }
  return base >= 1
    ? 1
    : pivot + (1 - pivot) * ((next - base) / (1 - base))
}

export function structureControlValue(
  controls: SemanticGradientControls,
  baseline: SemanticGradientControls,
): number {
  const pivot = clamp01((baseline.detail + baseline.distortion) / 2)
  return clamp01((
    controlValueForMappedValue(controls.detail, baseline.detail, pivot)
    + controlValueForMappedValue(
      controls.distortion,
      baseline.distortion,
      pivot,
    )
  ) / 2)
}

export function applyStructureControl(
  controls: SemanticGradientControls,
  baseline: SemanticGradientControls,
  value: number,
): SemanticGradientControls {
  const pivot = clamp01((baseline.detail + baseline.distortion) / 2)
  return {
    ...controls,
    detail: mapControlFromBaseline(value, baseline.detail, pivot),
    distortion: mapControlFromBaseline(
      value,
      baseline.distortion,
      pivot,
    ),
  }
}

export function transferVisibleGradientControls(
  controls: SemanticGradientControls,
  currentBaseline: SemanticGradientControls,
  nextBaseline: SemanticGradientControls,
): SemanticGradientControls {
  const detail = structureControlValue(controls, currentBaseline)
  return {
    ...applyStructureControl(nextBaseline, nextBaseline, detail),
    blend: controls.blend,
  }
}

export function createDefaultGradientState(): ProductionGradientState {
  const preset = findPreset(DEFAULT_PRESET_ID)
  return {
    presetId: preset.id,
    controls: { ...preset.controls },
    orientation: preset.orientation,
    center: { x: 0.5, y: 0.5 },
    field: normalizeSpatialGradientField(preset.field, preset.field),
    deformation: undefined,
  }
}

export function createDefaultPaletteState(): ProductionPaletteState {
  return {
    packId: 'atmospheric',
    elementalAccent: ELEMENTAL_ACCENTS[0],
    boundaries: [70, 85],
  }
}

export function gradientLookId(family: GradientFamily): 'diffusion' | 'smear' {
  return family === 'smear' ? 'smear' : 'diffusion'
}

export function resolveGradientSettings(
  family: GradientFamily,
  controls: SemanticGradientControls,
  grain: number,
  orientation: 0 | 90 | 180 | 270 = 0,
  center: { x: number; y: number } = { x: 0.5, y: 0.5 },
  field?: SpatialGradientField,
  sourceCount = 3,
): Required<GradientSettings> {
  const detail = ease(controls.detail)
  const blend = ease(controls.blend)
  const distortion = ease(controls.distortion)
  const position = clamp01(controls.position)
  const activeField = activeSpatialSources(
    normalizeSpatialGradientField(field ?? null),
    sourceCount,
  )
  const sourceA = activeField[0] ?? { x: 0.5, y: 0.5, spread: 0.5 }
  const sourceB = activeField[1] ?? sourceA
  const sourceC = activeField[2] ?? sourceB
  if (family === 'smear') {
    return {
      softness: lerp(0.25, 0.82, blend),
      distortion: lerp(0.18, 0.85, distortion),
      grain: clamp01(grain, 0),
      scale: lerp(0.85, 0.18, detail),
      folds: lerp(0.04, 0.9, distortion),
      bleed: lerp(0.1, 0.68, blend),
      depth: lerp(0.78, 0.3, blend),
      reflow: lerp(0.08, 0.92, position),
      orientation,
      centerX: clamp01(center.x),
      centerY: clamp01(center.y),
      source1X: sourceA.x,
      source1Y: sourceA.y,
      source1Spread: sourceA.spread,
      source2X: sourceB.x,
      source2Y: sourceB.y,
      source2Spread: sourceB.spread,
      source3X: sourceC.x,
      source3Y: sourceC.y,
      source3Spread: sourceC.spread,
      sourceCount: Math.max(1, Math.min(3, sourceCount)),
    }
  }
  return {
    softness: lerp(0.3, 0.9, blend),
    distortion: lerp(0.1, 0.72, distortion),
    grain: clamp01(grain, 0),
    scale: lerp(0.75, 0.28, detail),
    folds: lerp(0.05, 0.65, distortion),
    bleed: lerp(0.2, 0.85, blend),
    depth: lerp(0.75, 0.2, blend),
    reflow: lerp(0.08, 0.92, position),
    orientation,
    centerX: clamp01(center.x),
    centerY: clamp01(center.y),
    source1X: sourceA.x,
    source1Y: sourceA.y,
    source1Spread: sourceA.spread,
    source2X: sourceB.x,
    source2Y: sourceB.y,
    source2Spread: sourceB.spread,
    source3X: sourceC.x,
    source3Y: sourceC.y,
    source3Spread: sourceC.spread,
    sourceCount: Math.max(1, Math.min(3, sourceCount)),
  }
}

export function resolvePresetGradientState(
  presetId: string,
): {
  family: GradientFamily
  seed: number
  controls: SemanticGradientControls
  orientation: 0 | 90 | 180 | 270
  field: SpatialGradientField
  settings: Required<GradientSettings>
} {
  const preset = findPreset(presetId)
  return {
    family: preset.family,
    seed: preset.seed,
    controls: { ...preset.controls },
    orientation: preset.orientation,
    field: normalizeSpatialGradientField(preset.field, preset.field),
    settings: resolveGradientSettings(
      preset.family,
      preset.controls,
      preset.grain,
      preset.orientation,
      preset.field,
    ),
  }
}

export function resolvePaletteColors(
  state: Pick<ProductionPaletteState, 'packId' | 'elementalAccent'>,
): string[] {
  const pack = PRODUCTION_COLOR_PACKS.find((item) => item.id === state.packId)
    ?? PRODUCTION_COLOR_PACKS[0]
  return pack.id === 'elemental'
    ? [
        pack.colors[0],
        ELEMENTAL_ACCENTS.includes(state.elementalAccent as never)
          ? state.elementalAccent
          : ELEMENTAL_ACCENTS[0],
      ]
    : [...pack.colors]
}

export function paletteBoundaryLimits(
  state: ProductionPaletteState,
  index: number,
): { min: number; max: number } {
  const normalized = normalizePaletteState(state)
  const colorCount = resolvePaletteColors(normalized).length
  if (index === 0) {
    return {
      min: MIN_BOUNDARY,
      max: colorCount > 2
        ? normalized.boundaries[1]
        : MAX_BOUNDARY,
    }
  }
  return {
    min: normalized.boundaries[0],
    max: MAX_BOUNDARY,
  }
}

export function setPaletteBoundary(
  state: ProductionPaletteState,
  index: number,
  value: number,
): ProductionPaletteState {
  const normalized = normalizePaletteState(state)
  const visibleBoundaryCount = resolvePaletteColors(normalized).length - 1
  if (index < 0 || index >= visibleBoundaryCount) return normalized
  const limits = paletteBoundaryLimits(normalized, index)
  const next = [...normalized.boundaries] as [number, number]
  next[index] = Math.max(
    limits.min,
    Math.min(limits.max, Math.round(Number.isFinite(value) ? value : next[index])),
  )
  return normalizePaletteState({ ...normalized, boundaries: next })
}

export function resolvePaletteMix(state: ProductionPaletteState): {
  mix: ColorMix[]
  ink: string
  ground: string
} {
  const normalized = normalizePaletteState(state)
  const colors = resolvePaletteColors(normalized)
  const [first, second] = normalized.boundaries
  const ratios = colors.length > 2
    ? [first, second - first, 100 - second]
    : [first, 100 - first]
  const mix = colors.map((color, index) => ({
    color,
    ratio: ratios[index],
    enabled: ratios[index] > 0,
  }))
  return {
    mix,
    ink: colors[0],
    ground: colors[colors.length - 1],
  }
}

export function normalizeGradientState(
  value?: Partial<ProductionGradientState> | null,
): ProductionGradientState {
  const preset = findPreset(value?.presetId || DEFAULT_PRESET_ID)
  const controls = value?.controls
  return {
    presetId: preset.id,
    controls: {
      detail: clamp01(controls?.detail ?? preset.controls.detail, preset.controls.detail),
      blend: clamp01(controls?.blend ?? preset.controls.blend, preset.controls.blend),
      distortion: clamp01(
        controls?.distortion ?? preset.controls.distortion,
        preset.controls.distortion,
      ),
      position: clamp01(
        controls?.position ?? preset.controls.position,
        preset.controls.position,
      ),
    },
    orientation: value?.orientation === 0
      || value?.orientation === 90
      || value?.orientation === 180
      || value?.orientation === 270
      ? value.orientation
      : preset.orientation,
    center: {
      x: clamp01(value?.center?.x ?? 0.5),
      y: clamp01(value?.center?.y ?? 0.5),
    },
    field: normalizeSpatialGradientField(value?.field, preset.field),
    deformation: normalizeDeformation(value?.deformation),
  }
}

export function normalizePaletteState(
  value?: LegacyPaletteState | null,
): ProductionPaletteState {
  const defaults = createDefaultPaletteState()
  const packId = PRODUCTION_COLOR_PACKS.some((pack) => pack.id === value?.packId)
    ? value!.packId!
    : defaults.packId
  const elementalAccent = ELEMENTAL_ACCENTS.includes(value?.elementalAccent as never)
    ? value!.elementalAccent!
    : defaults.elementalAccent
  const legacyShare = typeof value?.metaBlueShare === 'number'
    && Number.isFinite(value.metaBlueShare)
    ? value.metaBlueShare
    : undefined
  const requestedFirst = legacyShare
    ?? value?.boundaries?.[0]
    ?? defaults.boundaries[0]
  const first = Math.max(
    MIN_BOUNDARY,
    Math.min(
      MAX_BOUNDARY,
      Math.round(Number.isFinite(requestedFirst) ? requestedFirst : defaults.boundaries[0]),
    ),
  )
  const migratedSecond = first + Math.ceil((100 - first) / 2)
  const requestedSecond = legacyShare === undefined
    ? value?.boundaries?.[1] ?? migratedSecond
    : migratedSecond
  const second = Math.max(
    first,
    Math.min(
      MAX_BOUNDARY,
      Math.round(Number.isFinite(requestedSecond) ? requestedSecond : migratedSecond),
    ),
  )
  return {
    packId,
    elementalAccent,
    boundaries: [first, second],
  }
}

export const PRODUCTION_PRESET_COUNT = CURATED_PRESETS.length
