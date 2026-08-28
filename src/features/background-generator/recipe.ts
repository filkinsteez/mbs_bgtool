import type { LookId } from '@/core/lab/looks'
import { LOOKS, lookComplexityPatch, lookPatchFor } from '@/core/lab/looks'
import { PAPER } from '@/core/state/defaults'
import { createDefaultLab } from '@/core/lab/recipe'
import type { LabState } from '@/core/lab/types'
import { constrainArtworkToCanvas } from '@/core/lab/artworkTransform'
import { resolveCompositionPlan } from '@/core/lab/compositionPlan'
import { resolveLookColorPlan } from '@/core/lab/colorDirection'
import { mergeDeep, type DeepPartial } from '@/core/state/store'
import { MATERIAL_BY_ID, type MaterialId } from './material/catalog'
import {
  buildWeightedPalette,
  colorMixForPack,
  CUSTOM_PALETTE_ID,
  META_BLUE,
  PALETTE_PACKS,
  type ColorMix,
} from './palette/registry'

export const BACKGROUND_RECIPE_VERSION = 2
export const BACKGROUND_RENDER_REVISION = 2
export const BACKGROUND_AUTOSAVE_KEY = 'mbs-bg-generator-autosave-v2'
export const LEGACY_BACKGROUND_AUTOSAVE_KEY = 'mbs-bg-generator-autosave-v1'

export type AspectId = '16:9' | '9:16' | '1:1' | '4:5' | 'custom'
export type FixedAspectId = Exclude<AspectId, 'custom'>
export type FramingMode = 'full' | 'oversized' | 'left' | 'right' | 'crossover' | 'free'
export type GeneratorMode = 'background' | 'material'
const LEGACY_MATERIAL_LOOKS: Record<string, LookId> = {
  film: 'brushwork',
  pixel: 'pixels',
  crt: 'scanlines',
}

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
  version: 2
  renderRevision: 2
  mode: GeneratorMode
  seed: number
  format: BackgroundFormat
  look: {
    id: LookId
    detail: number
  }
  materialLookOverlay: {
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
    id: MaterialId
    backgroundColor: string
    highlightColor: string
    intensity: number
    light: number
    depth: number
    camera: MaterialCameraPose | null
  }
  motion: {
    enabled: boolean
    amount: number
    speed: number
    loopSeconds: number
  }
}

export type BackgroundRecipePatch = DeepPartial<BackgroundRecipeV2>

type SerializedFormat = Partial<BackgroundFormat> & {
  resolution?: unknown
}

type SerializedBackgroundRecipeV2 = Omit<
  DeepPartial<BackgroundRecipeV2>,
  'version' | 'format'
> & {
  version: 2
  format?: SerializedFormat
}

type LegacyBackgroundRecipeV1 = Partial<
  Omit<BackgroundRecipeV2, 'version' | 'transforms' | 'format'>
> & {
  version: 1
  format?: SerializedFormat
  framing?: { mode?: FramingMode; x?: number; y?: number; zoom?: number }
  crop?: { x?: number; y?: number; zoom?: number }
}

const ASPECTS: Record<FixedAspectId, readonly [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
}

const EXPORT_LONG_EDGE = 3840

// The reference sheet was judged on the lab's warm paper: generated
// backgrounds default to texture-on-paper, never ink-on-ink.
export const DEFAULT_GROUND = PAPER.toUpperCase()

// The symbol keeps breathing room inside the artboard; framing presets
// (oversized, left, right, crossover) supply the deliberate crops.
const SYMBOL_AMPLITUDE = 0.78

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
  const pack = PALETTE_PACKS[0]
  const mix = colorMixForPack(pack)
  return {
    version: BACKGROUND_RECIPE_VERSION,
    renderRevision: BACKGROUND_RENDER_REVISION,
    mode: 'background',
    seed,
    format: { aspect: '16:9', ...dimensionsFor('16:9') },
    look: { id: 'frame', detail: 0.5 },
    materialLookOverlay: { enabled: false },
    palette: {
      packId: pack.id,
      mix,
      ground: DEFAULT_GROUND,
      ink: mix.find((item) => item.enabled)?.color ?? META_BLUE,
    },
    transforms: {
      background: presetTransform('background'),
      material: presetTransform('material'),
    },
    material: {
      id: 'clean',
      backgroundColor: META_BLUE,
      highlightColor: '#FFFFFF',
      intensity: 0.65,
      light: 0.5,
      depth: 0.35,
      camera: null,
    },
    motion: { enabled: false, amount: 0, speed: 0.5, loopSeconds: 8 },
  }
}

export function deserializeBackgroundRecipe(json: string): BackgroundRecipeV2 | null {
  try {
    const raw = JSON.parse(json) as SerializedBackgroundRecipeV2 | LegacyBackgroundRecipeV1
    if (!raw || (raw.version !== 1 && raw.version !== BACKGROUND_RECIPE_VERSION)) return null
    let recipe: BackgroundRecipeV2
    const rawPalette = raw.palette
    const rawMotion = raw.motion
    if (raw.version === 1) {
      const legacy = raw as LegacyBackgroundRecipeV1
      const framing = legacy.framing ?? {}
      const crop = legacy.crop ?? {}
      const migrated = normalizeSubjectTransform({
        preset: framing.mode ?? 'free',
        x: (framing.x ?? 0) + (crop.x ?? 0),
        y: (framing.y ?? 0) + (crop.y ?? 0),
        scale: (framing.zoom ?? 1) * (crop.zoom ?? 1),
        rotation: 0,
      })
      const { version: _version, framing: _framing, crop: _crop, ...rest } = legacy
      void _version
      void _framing
      void _crop
      recipe = mergeDeep(createDefaultBackgroundRecipe(legacy.seed), {
        ...rest,
        version: BACKGROUND_RECIPE_VERSION,
        transforms: {
          background: migrated,
          material: migrated,
        },
      })
    } else {
      recipe = mergeDeep(
        createDefaultBackgroundRecipe(raw.seed),
        raw as unknown as DeepPartial<BackgroundRecipeV2>,
      )
    }
    const migratedLook = LEGACY_MATERIAL_LOOKS[recipe.material.id as string]
    if (recipe.renderRevision !== BACKGROUND_RENDER_REVISION) return null
    if (migratedLook) {
      recipe.material.id = 'clean'
      recipe.look.id = migratedLook
      recipe.materialLookOverlay.enabled = true
    }
    const allowedLook = LOOKS.some((look) => look.id === recipe.look.id)
    const pack = PALETTE_PACKS.find((item) => item.id === recipe.palette.packId)
    const customPalette = recipe.palette.packId === CUSTOM_PALETTE_ID
      && Array.isArray(recipe.palette.mix)
      && recipe.palette.mix.length > 0
    const allowedMode = recipe.mode === 'background' || recipe.mode === 'material'
    if (
      !allowedMode
      || !allowedLook
      || (!pack && !customPalette)
      || !MATERIAL_BY_ID[recipe.material.id]
    ) return null
    recipe.seed = clampInt(recipe.seed, 0, 0x7fffffff)
    if (!['16:9', '9:16', '1:1', '4:5', 'custom'].includes(recipe.format.aspect)) {
      return null
    }
    recipe.format = canonicalizeFormat({
      aspect: recipe.format.aspect,
      width: raw.format?.width,
      height: raw.format?.height,
    })
    recipe.materialLookOverlay.enabled = recipe.materialLookOverlay.enabled === true
    const weightedPalette = buildWeightedPalette(recipe.palette.mix, 100)
    recipe.palette.ground = normalizeHexColor(rawPalette?.ground, DEFAULT_GROUND)
    recipe.palette.ink = normalizeHexColor(
      rawPalette?.ink,
      weightedPalette[0] ?? META_BLUE,
    )
    recipe.transforms.background = constrainBackgroundTransform(
      recipe.transforms.background,
      recipe.format.width,
      recipe.format.height,
    )
    recipe.transforms.material = normalizeSubjectTransform(recipe.transforms.material)
    recipe.material.backgroundColor = normalizeHexColor(recipe.material.backgroundColor, META_BLUE)
    recipe.material.highlightColor = normalizeHexColor(recipe.material.highlightColor, '#FFFFFF')
    recipe.material.intensity = clamp01(recipe.material.intensity)
    recipe.material.light = clamp01(recipe.material.light)
    recipe.material.depth = clamp01(recipe.material.depth)
    recipe.material.camera = normalizeMaterialCamera(recipe.material.camera)
    recipe.motion.amount = clamp01(recipe.motion.amount)
    if (rawMotion?.enabled === false) recipe.motion.amount = 0
    recipe.motion.enabled = recipe.motion.amount > 0
    recipe.motion.speed = Math.max(0.1, Math.min(2, recipe.motion.speed))
    recipe.motion.loopSeconds = Math.max(2, Math.min(30, recipe.motion.loopSeconds))
    return recipe
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
  return constrainArtworkToCanvas(
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
  const base = createDefaultLab(recipe.seed)
  const look = LOOKS.find((item) => item.id === recipe.look.id) ?? LOOKS[0]
  const hasSource = options.hasSource === true
  let lab = mergeDeep(base, lookPatchFor(look, hasSource))
  lab = mergeDeep(lab, lookComplexityPatch(recipe.look.id, recipe.look.detail))
  const curve = lab.territory.sources.find((source) => source.kind === 'curve' && source.curve)
  const colorPlan = resolveLookColorPlan({
    mix: recipe.palette.mix,
    ground: recipe.palette.ground,
    ink: recipe.palette.ink,
    lookId: recipe.look.id,
    complexity: recipe.look.detail,
  })
  const palette = colorPlan.swatches.map((swatch) => swatch.hex)
  lab = mergeDeep(lab, {
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
    look: { id: recipe.look.id, strength: 1, complexity: recipe.look.detail },
    composition: resolveCompositionPlan({
      seed: recipe.seed,
      lookId: recipe.look.id,
      complexity: recipe.look.detail,
      aspect: recipe.format.width / Math.max(1, recipe.format.height),
    }),
    colors: {
      ink: recipe.palette.ink,
      paper: recipe.palette.ground,
      palette,
      plan: colorPlan,
    },
    territory: {
      sources: lab.territory.sources.map((source) =>
        source.id === curve?.id && source.curve
          ? {
              ...source,
              // The symbol IS the composition: full weight commits its
              // interior to the top band instead of leaving it straddling
              // a band boundary (the editor's 0.8 leaves headroom for a
              // photo's tone source that generated backgrounds don't have).
              weight: 1,
              // Pixels reads as the reference's soft quantized gradient and
              // Marks wants a graded stipple halo — both need a wider
              // falloff around the silhouette than the editor default.
              softness: recipe.look.id === 'pixels'
                ? 0.8
                : recipe.look.id === 'marks'
                  ? 0.7
                  : source.softness,
              curve: {
                ...source.curve,
                amplitudeX: SYMBOL_AMPLITUDE,
                amplitudeY: SYMBOL_AMPLITUDE,
                offsetX: 0,
                offsetY: 0,
                rotation: 0,
                silhouette: 'meta-symbol',
              },
            }
          : source,
      ),
    },
    motion: recipe.motion,
  })
  return lab
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
