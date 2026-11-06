import { recipesForMood, type MoodId, type RecipeId } from '@/light'

/**
 * The pictures on the panel's Mood and Look buttons: fixed renders made by `scripts/light/panel-pictures.mjs`, not live,
 * and the same whichever pack is picked.
 */
const FOLDER = '/panel'

export const lookPicture = (look: RecipeId) => `${FOLDER}/${look.replace('.', '-')}.webp`

/** A Mood button shows the mood's first look, the one picking the mood switches to. */
export const moodPicture = (mood: MoodId) => lookPicture(recipesForMood(mood)[0].id)
