import { RECIPE_IDS, type MoodId, type RecipeDefinition, type RecipeId } from '../scene'
import { contourBeam } from './contour/beam'
import { contourHalo } from './contour/halo'
import { contourRim } from './contour/rim'
import { sunsetBands } from './sunset/bands'
import { sunsetBlooms } from './sunset/blooms'
import { sunsetRamp } from './sunset/ramp'

export const RECIPES: Readonly<Record<RecipeId, RecipeDefinition>> = {
  'sunset.ramp': sunsetRamp,
  'sunset.bands': sunsetBands,
  'sunset.blooms': sunsetBlooms,
  'contour.rim': contourRim,
  'contour.beam': contourBeam,
  'contour.halo': contourHalo,
}

export const RECIPE_LIST: readonly RecipeDefinition[] = RECIPE_IDS.map((id) => RECIPES[id])

export function getRecipe(id: RecipeId): RecipeDefinition {
  const recipe = RECIPES[id]
  if (!recipe) throw new Error(`Unknown recipe: ${id}`)
  return recipe
}

export function recipesForMood(mood: MoodId): RecipeDefinition[] {
  return RECIPE_LIST.filter((recipe) => recipe.mood === mood)
}
