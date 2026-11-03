import {
  composeScene,
  getRecipe,
  type ColorPack,
  type ControlValues,
  type LensSettings,
  type MoodId,
  type OutputSettings,
  type ParamValue,
  type RecipeId,
  type Scene,
} from '@/light'

export { DEFAULT_CONTROLS, type ControlValues } from '@/light'

export type MoodControlKey = 'horizon' | 'light'

/** The mood control's name in the URL query. */
export const MOOD_CONTROL: Readonly<Record<MoodId, MoodControlKey>> = {
  sunset: 'horizon',
  contour: 'light',
}

/** The mood control's key in the panel. DialKit shows a key as the control's label, with its first letter upper case. */
export const MOOD_DIAL_KEY: Readonly<Record<MoodId, string>> = {
  sunset: 'horizon',
  contour: 'light position',
}

export interface RecipeMapping {
  params: (controls: ControlValues, pack: ColorPack) => Record<string, ParamValue>
  lens?: (controls: ControlValues) => Partial<LensSettings>
  output?: (controls: ControlValues) => Partial<OutputSettings>
}

/** Fallback mappings for recipes without `compose`. A recipe owner deletes the entry once the recipe defines compose. */
export const CONTROL_MAPPINGS: Readonly<Partial<Record<RecipeId, RecipeMapping>>> = {}

/**
 * The recipe's own `compose` for the pack, controls, seed and frame aspect
 * (width / height). Recipes without it get their defaults, the pack's colors
 * by the recipe's role picks, and the fallback mapping's overrides.
 */
export function buildScene(recipeId: RecipeId, pack: ColorPack, seed: number, controls: ControlValues, aspect = 16 / 9): Scene {
  const recipe = getRecipe(recipeId)
  const composed = composeScene(recipe, { pack, controls, seed, aspect })
  if (composed) return composed
  const mapping = CONTROL_MAPPINGS[recipeId]
  if (!mapping) throw new Error(`${recipeId} has neither compose nor a fallback control mapping`)
  return {
    recipe: recipeId,
    seed,
    colors: recipe.fromPack(pack),
    params: mapping.params(controls, pack),
    lens: mapping.lens?.(controls) ?? {},
    output: mapping.output?.(controls) ?? {},
  }
}
