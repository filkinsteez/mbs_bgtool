import {
  deserializeBackgroundRecipe,
  type BackgroundRecipeV2,
  type GeneratorMode,
} from './recipe'

// A look preset is the whole recipe in a named envelope, so a file saved
// from one person's session replays exactly in another's — framing
// transforms, palette mix, look, complexity, seed, motion, 3D camera and
// material included. Parsing leans on deserializeBackgroundRecipe: the
// same healing that guards autosave guards hand-edited or older files.

export const LOOK_PRESET_KIND = 'mbs-look-preset'
export const LOOK_PRESET_VERSION = 1

type LookPresetFile = {
  kind: typeof LOOK_PRESET_KIND
  presetVersion: number
  name: string
  recipe: unknown
}

export type ParsedLookPreset = {
  name: string
  recipe: BackgroundRecipeV2
}

export function defaultPresetName(
  recipe: BackgroundRecipeV2,
  mode: GeneratorMode,
): string {
  const treatment = mode === 'material'
    ? `${recipe.material.id}-${recipe.look.id}`
    : recipe.look.id
  return `${recipe.look.version}-${treatment}-${recipe.seed}`
}

export function presetFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `mbs-look-${slug || 'preset'}.json`
}

export function serializeLookPreset(
  recipe: BackgroundRecipeV2,
  mode: GeneratorMode,
  name: string,
): string {
  const preset: LookPresetFile = {
    kind: LOOK_PRESET_KIND,
    presetVersion: LOOK_PRESET_VERSION,
    name,
    recipe: { ...recipe, mode },
  }
  return JSON.stringify(preset, null, 2)
}

export function parseLookPreset(json: string): ParsedLookPreset | null {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const envelope = raw as Partial<LookPresetFile>
  if (envelope.kind === LOOK_PRESET_KIND) {
    if (
      typeof envelope.presetVersion !== 'number'
      || envelope.presetVersion < 1
      || !envelope.recipe
    ) return null
    const recipe = deserializeBackgroundRecipe(JSON.stringify(envelope.recipe))
    if (!recipe) return null
    const name = typeof envelope.name === 'string' && envelope.name.trim()
      ? envelope.name.trim()
      : defaultPresetName(recipe, recipe.mode)
    return { name, recipe }
  }
  // A bare serialized recipe (the autosave shape) loads too.
  const recipe = deserializeBackgroundRecipe(json)
  if (!recipe) return null
  return { name: defaultPresetName(recipe, recipe.mode), recipe }
}
