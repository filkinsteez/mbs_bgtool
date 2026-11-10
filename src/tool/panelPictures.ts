import type { MoodId } from '@/light'
import { MOOD_LOOKS } from './state'

/**
 * The pictures on the panel's Mood buttons: fixed renders made by `scripts/light/panel-pictures.mjs`, not live, and
 * the same whichever pack is picked. A mood's picture shows its one look.
 */
const FOLDER = '/panel'

export const moodPicture = (mood: MoodId) => `${FOLDER}/${MOOD_LOOKS[mood].replace('.', '-')}.webp`
