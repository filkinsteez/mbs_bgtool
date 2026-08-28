import type { LookId } from '@/core/lab/looks'
import { lookById, looksForVersion, lookComplexityPatch, lookPatchFor } from '@/core/lab/looks'
import { createDefaultLab } from '@/core/lab/recipe'
import { createDefaultLabV1 } from '@/core/lab/v1/recipe'
import type { LabState, LookVersion } from '@/core/lab/types'
import { constrainArtworkCover } from '@/core/lab/artworkTransform'
import { CANONICAL_META_SAFE_AREA } from '@/core/lab/metaInfluence'
import { resolveCompositionPlan } from '@/core/lab/compositionPlan'
import { resolveLookColorPlan } from '@/core/lab/colorDirection'
import { resolveLookColorPlan as resolveLookColorPlanV1b } from '@/core/lab/v1b/colorDirection'
import { PAPER } from '@/core/state/defaults'
import { chan } from '@/core/organic/random'
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
export const BACKGROUND_RENDER_REVISION = 1
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
  renderRevision: 1
  mode: GeneratorMode
  seed: number
  format: BackgroundFormat
  look: {
    id: LookId
    detail: number
    version: LookVersion
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
    look: { id: 'pattern', detail: 0.5, version: 'v2' },
    materialLookOverlay: { enabled: false },
    palette: {
      packId: pack.id,
      mix,
      ground: mix.filter((item) => item.enabled).at(-1)?.color ?? META_BLUE,
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
    const serializedLookVersion = raw.look?.version
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
    recipe.look.version = raw.version === 1
      ? 'v1'
      : serializedLookVersion === 'v1'
        || serializedLookVersion === 'v1b'
        || serializedLookVersion === 'v2'
        ? serializedLookVersion
        : 'v1'
    const migratedLook = LEGACY_MATERIAL_LOOKS[recipe.material.id as string]
    if (recipe.renderRevision !== BACKGROUND_RENDER_REVISION) return null
    if (migratedLook) {
      recipe.material.id = 'clean'
      recipe.look.id = migratedLook
      recipe.materialLookOverlay.enabled = true
    }
    const catalog = looksForVersion(recipe.look.version)
    if (!catalog.some((look) => look.id === recipe.look.id)) {
      recipe.look.id = catalog[0].id
    }
    const allowedLook = true
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
    recipe.palette.ground = normalizeHexColor(
      rawPalette?.ground,
      weightedPalette.at(-1) ?? META_BLUE,
    )
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
  const isV1 = recipe.look.version === 'v1'
  // V1b is the texture-on-paper comparison variant: it shares the V2 Lab
  // defaults but resolves its color plan on a paper ground, which is the
  // whole point of the variant.
  const isV1b = recipe.look.version === 'v1b'
  const v1bGround = PAPER.toUpperCase()
  const base = isV1 ? createDefaultLabV1(recipe.seed) : createDefaultLab(recipe.seed)
  const look = lookById(recipe.look.id) ?? looksForVersion(recipe.look.version)[0]
  const hasSource = options.hasSource === true
  let lab = mergeDeep(base, lookPatchFor(look, hasSource, recipe.look.version))
  lab = mergeDeep(
    lab,
    lookComplexityPatch(recipe.look.id, recipe.look.detail, recipe.look.version),
  )
  const curve = lab.territory.sources.find((source) => source.kind === 'curve' && source.curve)
  const planInput = {
    mix: recipe.palette.mix,
    ground: isV1b ? v1bGround : recipe.palette.ground,
    ink: recipe.palette.ink,
    lookId: recipe.look.id,
    complexity: recipe.look.detail,
  }
  const colorPlan = isV1
    ? null
    : isV1b
      ? resolveLookColorPlanV1b(planInput)
      : resolveLookColorPlan(planInput)
  const palette = isV1
    ? buildWeightedPalette(recipe.palette.mix, 100)
    : colorPlan!.swatches.map((swatch) => swatch.hex)
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
    look: isV1
      ? {
          id: recipe.look.id,
          strength: 1,
          version: recipe.look.version,
        }
      : {
          id: recipe.look.id,
          strength: 1,
          complexity: recipe.look.detail,
          version: recipe.look.version,
        },
    ...(isV1
      ? {}
      : {
          composition: resolveCompositionPlan({
            seed: recipe.seed,
            lookId: recipe.look.id,
            complexity: recipe.look.detail,
            aspect: recipe.format.width / Math.max(1, recipe.format.height),
            lookVersion: recipe.look.version,
          }),
        }),
    colors: isV1
      ? {
          ink: palette[0] ?? META_BLUE,
          paper: palette.at(-1) ?? '#FFFFFF',
          palette,
        }
      : {
          ink: recipe.palette.ink,
          paper: isV1b ? v1bGround : recipe.palette.ground,
          palette,
          plan: colorPlan!,
        },
    territory: {
      sources: lab.territory.sources.map((source) =>
        source.id === curve?.id && source.curve
          ? {
              ...source,
              // V1b never shows the whole mark. The geometry runs oversized,
              // off-center, and tilted — seeded per recipe — so one arc or
              // lobe sweeps the frame as an organizing field, not a logo.
              // Full weight commits the swept interior to the top band; the
              // wide falloff grades the texture instead of stamping a shape.
              ...(isV1b
                ? {
                    weight: 1,
                    softness: recipe.look.id === 'pixels'
                      ? 0.9
                      : recipe.look.id === 'marks'
                        ? 0.7
                        : 0.5,
                  }
                : {}),
              curve: isV1b
                ? (() => {
                    const scale = 1.45
                      + chan(recipe.seed, 0, 'v1b.symbol.scale') * 0.85
                    const direction = chan(recipe.seed, 0, 'v1b.symbol.dir')
                      * Math.PI * 2
                    const distance = 0.42
                      + chan(recipe.seed, 0, 'v1b.symbol.dist') * 0.34
                    return {
                      ...source.curve,
                      amplitudeX: scale,
                      amplitudeY: scale,
                      offsetX: Math.cos(direction) * distance,
                      offsetY: Math.sin(direction) * distance,
                      rotation: (chan(recipe.seed, 0, 'v1b.symbol.rot') - 0.5) * 1.1,
                      silhouette: 'meta-symbol' as const,
                    }
                  })()
                : {
                    ...source.curve,
                    amplitudeX: CANONICAL_META_SAFE_AREA.width,
                    amplitudeY: CANONICAL_META_SAFE_AREA.height,
                    offsetX: 0,
                    offsetY: 0,
                    rotation: 0,
                    silhouette: 'meta-symbol' as const,
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
