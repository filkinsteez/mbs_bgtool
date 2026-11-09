import { recipesForMood, type MoodId, type RecipeId } from '@/light'

/**
 * The look a mood shows for a seed, until each mood's looks merge into one look: the mood's looks in RECIPE_IDS
 * order (Sunrise: Bands, Ramp, Blooms; Contour: Halo, Rim, Beam, Streaks), one after another as the seed rises, so
 * seed 1 is the first look and Shuffle reaches every look. The look renders with the same seed.
 */
export function lookForSeed(mood: MoodId, seed: number): RecipeId {
  const looks = recipesForMood(mood)
  const index = (((Math.round(seed) - 1) % looks.length) + looks.length) % looks.length
  return looks[index].id
}
