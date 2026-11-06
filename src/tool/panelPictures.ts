import { recipesForMood, type MoodId, type PackId, type RecipeId } from '@/light'
import type { FilterKey } from '@/light/engine/filters'

/** The panel's button pictures: fixed renders made by `scripts/light/panel-pictures.mjs`, not live. */
const FOLDER = '/panel'

export const lookPicture = (look: RecipeId, pack: PackId) => `${FOLDER}/${look.replace('.', '-')}-${pack}.webp`

/** A Mood button shows the mood's first look, the one picking the mood switches to. */
export const moodPicture = (mood: MoodId, pack: PackId) => lookPicture(recipesForMood(mood)[0].id, pack)

/** No filter has no picture: its button shows the off icon. */
export const filterPicture = (filter: FilterKey, pack: PackId) => `${FOLDER}/filter-${filter}-${pack}.webp`
