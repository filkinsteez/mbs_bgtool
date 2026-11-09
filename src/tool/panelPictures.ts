import { recipesForMood, type MoodId } from '@/light'

/**
 * The pictures on the panel's Mood buttons: fixed renders made by `scripts/light/panel-pictures.mjs`, not live, and
 * the same whichever pack is picked. A mood's picture shows its first look, the one seed 1 opens on.
 */
const FOLDER = '/panel'

export const moodPicture = (mood: MoodId) => `${FOLDER}/${recipesForMood(mood)[0].id.replace('.', '-')}.webp`
