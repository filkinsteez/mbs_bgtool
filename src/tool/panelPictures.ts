import type { MoodId, PackId, RecipeId } from '@/light'
import type { FilterChoice } from './filterControl'

/** The panel's button pictures: fixed renders made by `scripts/light/panel-pictures.mjs`, not live. */
const FOLDER = '/panel'

/** The look each Mood button shows. */
export const MOOD_PICTURE_LOOK: Readonly<Record<MoodId, RecipeId>> = { sunset: 'sunset.bands', contour: 'contour.halo' }

export const lookPicture = (look: RecipeId, pack: PackId) => `${FOLDER}/${look.replace('.', '-')}-${pack}.webp`

export const filterPicture = (filter: FilterChoice, pack: PackId) => `${FOLDER}/filter-${filter}-${pack}.webp`
