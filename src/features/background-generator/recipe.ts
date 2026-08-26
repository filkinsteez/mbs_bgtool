import type { LookId } from '@/core/lab/looks'
import { LOOKS, lookPatchFor } from '@/core/lab/looks'
import { createDefaultLab } from '@/core/lab/recipe'
import type { LabState } from '@/core/lab/types'
import { mergeDeep, type DeepPartial } from '@/core/state/store'
import { MATERIAL_BY_ID, type MaterialId } from './material/shadersCatalog'
import {
  buildWeightedPalette,
  CUSTOM_PALETTE_ID,
  META_BLUE,
  PALETTE_PACKS,
  type ColorMix,
} from './palette/registry'

export const BACKGROUND_RECIPE_VERSION = 2
export const BACKGROUND_AUTOSAVE_KEY = 'mbs-bg-generator-autosave-v2'
export const LEGACY_BACKGROUND_AUTOSAVE_KEY = 'mbs-bg-generator-autosave-v1'

export type AspectId = '16:9' | '9:16' | '1:1' | '4:5' | 'custom'
export type ResolutionId = '1080' | '2k' | '4k' | '8k'
export type FramingMode = 'full' | 'oversized' | 'left' | 'right' | 'crossover' | 'free'
export type GeneratorMode = 'background' | 'material'

export type SubjectTransform = {
  preset: FramingMode
  x: number
  y: number
  scale: number
  rotation: number // degrees
}

export type BackgroundRecipeV2 = {
  version: 2
  mode: GeneratorMode
  seed: number
  format: {
    aspect: AspectId
    resolution: ResolutionId
    width: number
    height: number
  }
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
  }
  motion: {
    enabled: boolean
    amount: number
    speed: number
    loopSeconds: number
  }
}

export type BackgroundRecipePatch = DeepPartial<BackgroundRecipeV2>

type LegacyBackgroundRecipeV1 = Partial<
  Omit<BackgroundRecipeV2, 'version' | 'transforms'>
> & {
  version: 1
  framing?: { mode?: FramingMode; x?: number; y?: number; zoom?: number }
  crop?: { x?: number; y?: number; zoom?: number }
}

const ASPECTS: Record<Exclude<AspectId, 'custom'>, readonly [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
}

const LONG_EDGES: Record<ResolutionId, number> = {
  '1080': 1080,
  '2k': 2048,
  '4k': 3840,
  '8k': 7680,
}

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
  resolution: ResolutionId,
  aspect: AspectId,
  custom?: { width: number; height: number },
): { width: number; height: number } {
  if (aspect === 'custom') {
    return {
      width: clampInt(custom?.width ?? 3840, 64, 8192),
      height: clampInt(custom?.height ?? 2160, 64, 8192),
    }
  }
  const [w, h] = ASPECTS[aspect]
  const edge = LONG_EDGES[resolution]
  return w >= h
    ? { width: edge, height: Math.round((edge * h) / w) }
    : { width: Math.round((edge * w) / h), height: edge }
}

export function dimensionsForRatio(
  resolution: ResolutionId,
  ratio: number,
): { width: number; height: number } {
  const safeRatio = Math.max(1 / 8, Math.min(8, Number.isFinite(ratio) ? ratio : 16 / 9))
  const edge = LONG_EDGES[resolution]
  return safeRatio >= 1
    ? { width: edge, height: Math.max(64, Math.round(edge / safeRatio)) }
    : { width: Math.max(64, Math.round(edge * safeRatio)), height: edge }
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
  const mix = pack.colors.map((color, index) => ({
    color,
    enabled: index < 3,
    ratio: index === 0 ? 60 : index < 3 ? 20 : 0,
  }))
  return {
    version: BACKGROUND_RECIPE_VERSION,
    mode: 'background',
    seed,
    format: { aspect: '16:9', resolution: '4k', ...dimensionsFor('4k', '16:9') },
    look: { id: 'frame', detail: 0.5 },
    materialLookOverlay: { enabled: false },
    palette: { packId: pack.id, mix },
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
    },
    motion: { enabled: false, amount: 0.35, speed: 0.5, loopSeconds: 8 },
  }
}

export function deserializeBackgroundRecipe(json: string): BackgroundRecipeV2 | null {
  try {
    const raw = JSON.parse(json) as Partial<BackgroundRecipeV2> | LegacyBackgroundRecipeV1
    if (!raw || (raw.version !== 1 && raw.version !== BACKGROUND_RECIPE_VERSION)) return null
    let recipe: BackgroundRecipeV2
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
        raw as DeepPartial<BackgroundRecipeV2>,
      )
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
    recipe.format.width = clampInt(recipe.format.width, 64, 8192)
    recipe.format.height = clampInt(recipe.format.height, 64, 8192)
    recipe.materialLookOverlay.enabled = recipe.materialLookOverlay.enabled === true
    recipe.transforms.background = normalizeSubjectTransform(recipe.transforms.background)
    recipe.transforms.material = normalizeSubjectTransform(recipe.transforms.material)
    recipe.material.backgroundColor = normalizeHexColor(recipe.material.backgroundColor, META_BLUE)
    recipe.material.highlightColor = normalizeHexColor(recipe.material.highlightColor, '#FFFFFF')
    recipe.material.intensity = clamp01(recipe.material.intensity)
    recipe.material.light = clamp01(recipe.material.light)
    recipe.material.depth = clamp01(recipe.material.depth)
    recipe.motion.amount = clamp01(recipe.motion.amount)
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
    scale: Math.max(0.1, Math.min(4, Number.isFinite(value.scale) ? value.scale : 1)),
    rotation: ((rotation + 180) % 360 + 360) % 360 - 180,
  }
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
  const curve = lab.territory.sources.find((source) => source.kind === 'curve' && source.curve)
  const palette = buildWeightedPalette(recipe.palette.mix, 100)
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
    look: { id: recipe.look.id, strength: 1 },
    colors: {
      ink: palette[0] ?? META_BLUE,
      paper: palette.at(-1) ?? '#FFFFFF',
      palette,
    },
    structure: {
      baseCell: Math.round(16 + recipe.look.detail * 72),
    },
    territory: {
      sources: lab.territory.sources.map((source) =>
        source.id === curve?.id && source.curve
          ? {
              ...source,
              curve: {
                ...source.curve,
                amplitudeX: 1,
                amplitudeY: 1,
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

function clampInt(value: number | undefined, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value ?? min)))
}
