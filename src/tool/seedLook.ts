import { getRecipe, HIDDEN_RECIPE_IDS, recipesForMood, type MoodId, type RecipeId } from '@/light'

/**
 * The looks a mood shows, in seed order: its panel looks in RECIPE_IDS order, or its hidden looks when it has no panel
 * look, as Rush has only `rush.split`.
 */
export function moodLooks(mood: MoodId): RecipeId[] {
  const looks: RecipeId[] = recipesForMood(mood).map((recipe) => recipe.id)
  return looks.length > 0 ? looks : HIDDEN_RECIPE_IDS.filter((id) => getRecipe(id).mood === mood)
}

/**
 * The look a mood shows for a seed, until each mood's looks merge into one look: the mood's looks (Sunrise: Bands,
 * Ramp, Blooms; Contour: Halo, Rim, Beam, Streaks; Rush: Split), one after another as the seed rises, so seed 1 is the
 * first look and Shuffle reaches every look. The look renders with the same seed.
 */
export function lookForSeed(mood: MoodId, seed: number): RecipeId {
  const looks = moodLooks(mood)
  const index = (((Math.round(seed) - 1) % looks.length) + looks.length) % looks.length
  return looks[index]
}
