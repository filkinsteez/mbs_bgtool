import type { LookId } from '@/core/lab/looks'
import type { GradientSettings, LabState } from '@/core/lab/types'
import type { Deformation } from '@/core/lab/gradients/deformation'
import { constrainArtworkCover } from '@/core/lab/artworkTransform'
import { resolveLookColorPlan } from '@/core/lab/colorDirection'
import { mergeDeep, type DeepPartial } from '@/core/state/store'
import {
  createDefaultGradientState,
  createDefaultPaletteState,
  gradientLookId,
  normalizeGradientState,
  normalizePaletteState,
  resolveGradientSettings,
  resolvePaletteMix,
  type ProductionGradientState,
  type ProductionPaletteState,
} from './gradientControls'
import { findPreset } from './curatedPresets'
import {
  META_BLUE,
  migrateLegacyHex,
  type ColorMix,
} from './palette/registry'

export const BACKGROUND_RECIPE_VERSION = 3
export const BACKGROUND_RENDER_REVISION = 2
export const BACKGROUND_AUTOSAVE_KEY = 'mbs-bg-generator-autosave-v3'
export const LEGACY_BACKGROUND_AUTOSAVE_KEY = 'mbs-bg-generator-autosave-v1'

export type AspectId = '16:9' | '9:16' | '1:1' | '4:5' | 'custom'
export type FixedAspectId = Exclude<AspectId, 'custom'>
export type FramingMode = 'full' | 'oversized' | 'left' | 'right' | 'crossover' | 'free'
export type GeneratorMode = 'background' | 'material'

export type SubjectTransform = {
  preset: FramingMode
  x: number
  y: number
  scale: number
  rotation: number // degrees
}

export type MaterialCameraPose = {
  position: [number, number, number]
  target: [number, number, number]
  zoom: number
}

export type BackgroundFormat = {
  aspect: AspectId
  width: number
  height: number
}

export type BackgroundRecipeV2 = {
  version: 3
  renderRevision: 2
  mode: GeneratorMode
  seed: number
  format: BackgroundFormat
  presetId: string
  gradientState: ProductionGradientState
  paletteState: ProductionPaletteState
  look: {
    id: LookId
    detail: number
    version: 'gradients'
    gradient?: GradientSettings
    deformation?: Deformation
  }
  materialLookOverlay: {
    enabled: boolean
  }
  backgroundSymbol: {
    enabled: boolean
  }
  palette: {
    packId: string
    mix: ColorMix[]
    ground: string
    ink: string
  }
  transforms: {
    background: SubjectTransform
    material: SubjectTransform
  }
  material: {
    backgroundColor: string
    highlightColor: string
    intensity: number
    light: number
    depth: number
    camera: MaterialCameraPose | null
  }
}

export type BackgroundRecipePatch = DeepPartial<BackgroundRecipeV2>

type SerializedFormat = Partial<BackgroundFormat> & {
  resolution?: unknown
}

const ASPECTS: Record<FixedAspectId, readonly [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
}

const EXPORT_LONG_EDGE = 3840

type FramingTransform = Omit<SubjectTransform, 'preset' | 'rotation'>

const MATERIAL_FRAMING: Record<Exclude<FramingMode, 'free'>, FramingTransform> = {
  full: { x: 0, y: 0, scale: 0.95 },
  oversized: { x: 0, y: 0.03, scale: 1.35 },
  left: { x: 0.28, y: 0.02, scale: 1.6 },
  right: { x: -0.28, y: 0.02, scale: 1.6 },
  crossover: { x: 0, y: -0.16, scale: 1.9 },
}

const BACKGROUND_FRAMING: Record<Exclude<FramingMode, 'free'>, FramingTransform> = {
  ...MATERIAL_FRAMING,
  full: { x: 0, y: 0, scale: 1 },
}

export function dimensionsFor(
  aspect: FixedAspectId,
): { width: number; height: number } {
  const [w, h] = ASPECTS[aspect]
  const edge = EXPORT_LONG_EDGE
  return w >= h
    ? { width: edge, height: Math.round((edge * h) / w) }
    : { width: Math.round((edge * w) / h), height: edge }
}

export function dimensionsForRatio(
  ratio: number,
): { width: number; height: number } {
  const validRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9
  const safeRatio = Math.max(1 / 8, Math.min(8, validRatio))
  const edge = EXPORT_LONG_EDGE
  return safeRatio >= 1
    ? { width: edge, height: Math.max(64, Math.round(edge / safeRatio)) }
    : { width: Math.max(64, Math.round(edge * safeRatio)), height: edge }
}

function closestFixedAspect(ratio: number): FixedAspectId {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9
  return (Object.entries(ASPECTS) as [FixedAspectId, readonly [number, number]][])
    .reduce((closest, [aspect, [width, height]]) => {
      const distance = Math.abs(Math.log(safeRatio / (width / height)))
      return distance < closest.distance ? { aspect, distance } : closest
    }, { aspect: '16:9' as FixedAspectId, distance: Number.POSITIVE_INFINITY })
    .aspect
}

export function canonicalizeFormat(
  format: Partial<BackgroundFormat>,
): BackgroundFormat {
  const aspect = format.aspect
  if (aspect && aspect !== 'custom' && aspect in ASPECTS) {
    return { aspect, ...dimensionsFor(aspect) }
  }
  if (
    aspect === 'custom'
    && Number.isFinite(format.width)
    && Number.isFinite(format.height)
    && (format.width ?? 0) > 0
    && (format.height ?? 0) > 0
  ) {
    const fixedAspect = closestFixedAspect(
      (format.width ?? 0) / (format.height ?? 1),
    )
    return {
      aspect: fixedAspect,
      ...dimensionsFor(fixedAspect),
    }
  }
  return { aspect: '16:9', ...dimensionsFor('16:9') }
}

function presetTransform(
  mode: GeneratorMode,
  preset: Exclude<FramingMode, 'free'> = 'full',
): SubjectTransform {
  const framing = mode === 'background' ? BACKGROUND_FRAMING : MATERIAL_FRAMING
  return { preset, ...framing[preset], rotation: 0 }
}

export function createDefaultBackgroundRecipe(seed = 1913): BackgroundRecipeV2 {
  const gradientState = createDefaultGradientState()
  const paletteState = createDefaultPaletteState()
  const mixResolved = resolvePaletteMix(paletteState)
  const preset = findPreset(gradientState.presetId)
  const gradientSettings = resolveGradientSettings(
    preset.family,
    gradientState.controls,
    preset.grain,
    gradientState.orientation,
    gradientState.center,
    gradientState.field,
    mixResolved.mix.length,
  )
  return {
    version: BACKGROUND_RECIPE_VERSION,
    renderRevision: BACKGROUND_RENDER_REVISION,
    mode: 'material',
    seed,
    format: { aspect: '16:9', ...dimensionsFor('16:9') },
    presetId: gradientState.presetId,
    gradientState,
    paletteState,
    look: {
      id: gradientLookId(preset.family),
      detail: gradientState.controls.detail,
      version: 'gradients',
      gradient: gradientSettings,
      deformation: gradientState.deformation,
    },
    materialLookOverlay: { enabled: true },
    backgroundSymbol: { enabled: true },
    palette: {
      packId: paletteState.packId,
      mix: mixResolved.mix,
      ground: mixResolved.ground,
      ink: mixResolved.ink,
    },
    transforms: {
      background: presetTransform('background'),
      material: presetTransform('material'),
    },
    material: {
      backgroundColor: META_BLUE,
      highlightColor: '#FFFFFF',
      intensity: 0.45,
      light: 0.5,
      depth: 0.2,
      camera: null,
    },
  }
}

export function deserializeBackgroundRecipe(json: string): BackgroundRecipeV2 | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown> & {
      version?: number
      renderRevision?: number
      seed?: number
      format?: SerializedFormat
    }
    if (raw.version !== 1 && raw.version !== 2 && raw.version !== BACKGROUND_RECIPE_VERSION) {
      return null
    }
    const seed = clampInt(raw.seed, 0, 0x7fffffff)
    const base = createDefaultBackgroundRecipe(Number.isFinite(seed) ? seed : 1913)
    const format = canonicalizeFormat({
      aspect: raw.format?.aspect,
      width: raw.format?.width,
      height: raw.format?.height,
    })
    // V1/V2 and incompatible recipes reset to the curated baseline while
    // preserving output format.
    if (raw.version !== BACKGROUND_RECIPE_VERSION || raw.renderRevision !== BACKGROUND_RENDER_REVISION) {
      return {
        ...createDefaultBackgroundRecipe(),
        format,
      }
    }
    const merged = mergeDeep(base, raw as unknown as DeepPartial<BackgroundRecipeV2>)
    const normalizedGradientState = normalizeGradientState(merged.gradientState)
    const normalizedPaletteState = normalizePaletteState(merged.paletteState)
    const preset = findPreset(normalizedGradientState.presetId)
    const resolvedPalette = resolvePaletteMix(normalizedPaletteState)
    const resolvedSettings = resolveGradientSettings(
      preset.family,
      normalizedGradientState.controls,
      preset.grain,
      normalizedGradientState.orientation,
      normalizedGradientState.center,
      normalizedGradientState.field,
      resolvedPalette.mix.length,
    )
    const safeRecipe: BackgroundRecipeV2 = {
      version: BACKGROUND_RECIPE_VERSION,
      renderRevision: BACKGROUND_RENDER_REVISION,
      mode: merged.mode === 'background' || merged.mode === 'material' ? merged.mode : 'material',
      seed: clampInt(merged.seed, 0, 0x7fffffff),
      format,
      presetId: preset.id,
      gradientState: normalizedGradientState,
      paletteState: normalizedPaletteState,
      look: {
        id: gradientLookId(preset.family),
        version: 'gradients',
        detail: normalizedGradientState.controls.detail,
        gradient: resolvedSettings,
        deformation: normalizedGradientState.deformation,
      },
      materialLookOverlay: { enabled: true },
      backgroundSymbol: {
        enabled: merged.backgroundSymbol.enabled !== false,
      },
      palette: {
        packId: normalizedPaletteState.packId,
        mix: resolvedPalette.mix.map((item) => ({ ...item, color: migrateLegacyHex(item.color) })),
        ink: migrateLegacyHex(resolvedPalette.ink),
        ground: migrateLegacyHex(resolvedPalette.ground),
      },
      transforms: {
        background: constrainBackgroundTransform(
          merged.transforms.background,
          format.width,
          format.height,
        ),
        material: normalizeSubjectTransform(merged.transforms.material),
      },
      material: {
        backgroundColor: migrateLegacyHex(normalizeHexColor(merged.material.backgroundColor, META_BLUE)),
        highlightColor: migrateLegacyHex(normalizeHexColor(merged.material.highlightColor, '#FFFFFF')),
        intensity: clamp01(merged.material.intensity),
        light: clamp01(merged.material.light),
        depth: clamp01(merged.material.depth),
        camera: normalizeMaterialCamera(merged.material.camera),
      },
    }
    return safeRecipe
  } catch {
    return null
  }
}

export function applyFramingPreset(
  recipe: BackgroundRecipeV2,
  preset: FramingMode,
  targetMode: GeneratorMode = recipe.mode,
): BackgroundRecipeV2 {
  if (preset === 'free') {
    return mergeDeep(recipe, { transforms: { [targetMode]: { preset } } })
  }
  const framing = targetMode === 'background' ? BACKGROUND_FRAMING : MATERIAL_FRAMING
  return mergeDeep(recipe, {
    transforms: {
      [targetMode]: {
        preset,
        ...framing[preset],
        rotation: 0,
      },
    },
  })
}

export function subjectTransformFor(
  recipe: BackgroundRecipeV2,
  mode: GeneratorMode = recipe.mode,
): SubjectTransform {
  return recipe.transforms[mode]
}

export function normalizeSubjectTransform(value: SubjectTransform): SubjectTransform {
  const allowedPreset: FramingMode[] = ['full', 'oversized', 'left', 'right', 'crossover', 'free']
  const rotation = Number.isFinite(value.rotation) ? value.rotation : 0
  return {
    preset: allowedPreset.includes(value.preset) ? value.preset : 'free',
    x: Math.max(-2, Math.min(2, Number.isFinite(value.x) ? value.x : 0)),
    y: Math.max(-2, Math.min(2, Number.isFinite(value.y) ? value.y : 0)),
    scale: Math.max(0.1, Math.min(12, Number.isFinite(value.scale) ? value.scale : 1)),
    rotation: ((rotation + 180) % 360 + 360) % 360 - 180,
  }
}

export function constrainBackgroundTransform(
  value: SubjectTransform,
  artboardWidth: number,
  artboardHeight: number,
): SubjectTransform {
  return constrainArtworkCover(
    normalizeSubjectTransform(value),
    artboardWidth,
    artboardHeight,
  )
}

export type BackgroundRecipeToLabOptions = {
  hasSource?: boolean
  source?: NonNullable<LabState['source']>
}

export function backgroundRecipeToLab(
  recipe: BackgroundRecipeV2,
  options: BackgroundRecipeToLabOptions = {},
): LabState {
  const hasSource = options.hasSource === true
  const colorPlan = resolveLookColorPlan({
    mix: recipe.palette.mix,
    ground: recipe.palette.ground,
    ink: recipe.palette.ink,
    lookId: recipe.look.id,
    complexity: recipe.look.detail,
  })
  return {
    version: 1,
    studyId: 'territory',
    seed: recipe.seed,
    output: {
      width: recipe.format.width,
      height: recipe.format.height,
      transparent: false,
    },
    source: hasSource
      ? (options.source ?? {
          width: recipe.format.width,
          height: recipe.format.height,
          fit: 'contain',
        })
      : null,
    look: {
      id: recipe.look.id,
      strength: 1,
      complexity: recipe.look.detail,
      gradient: recipe.look.gradient!,
      deformation: recipe.look.deformation,
      version: 'gradients',
    },
    colors: {
      ink: recipe.palette.ink,
      paper: recipe.palette.ground,
      palette: colorPlan.swatches.map((swatch) => swatch.hex),
      plan: colorPlan,
    },
  }
}

export function materialBaseColor(recipe: BackgroundRecipeV2): string {
  return normalizeHexColor(recipe.material.backgroundColor, META_BLUE)
}

export function materialHighlightColor(recipe: BackgroundRecipeV2): string {
  return normalizeHexColor(recipe.material.highlightColor, '#FFFFFF')
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function normalizeHexColor(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback
}

function normalizeMaterialCamera(
  value: MaterialCameraPose | null | undefined,
): MaterialCameraPose | null {
  if (!value) return null
  const position = normalizeVector3(value.position)
  const target = normalizeVector3(value.target)
  const zoom = Number.isFinite(value.zoom)
    ? Math.max(0.5, Math.min(8, value.zoom))
    : 1
  return position && target ? { position, target, zoom } : null
}

function normalizeVector3(
  value: [number, number, number] | undefined,
): [number, number, number] | null {
  return Array.isArray(value)
    && value.length === 3
    && value.every(Number.isFinite)
    ? [value[0], value[1], value[2]]
    : null
}

function clampInt(value: number | undefined, min: number, max: number): number {
  const finite = Number.isFinite(value) ? (value as number) : min
  return Math.max(min, Math.min(max, Math.round(finite)))
}
