import type { RecipeId } from './scene'

export type IgnoreKind = 'fold' | 'text' | 'corners' | 'other'

export interface IgnoreRect {
  kind: IgnoreKind
  /** [x, y, w, h] in target pixels. */
  rect: [number, number, number, number]
}

/** One entry of public/references/awe/manifest.json (shared format). */
export interface ManifestReference {
  id: string
  mood: string
  figmaNodeId: string
  figmaName: string
  title: string
  /** Relative to public/references/awe/. */
  file: string
  fullFile?: string
  width: number
  height: number
  recipe?: string
  ignore?: IgnoreRect[]
  cornerRadius?: number
  notes?: string
}

export interface ReferenceManifest {
  version: number
  references: ManifestReference[]
}

/** Screenshots used until the clean targets and manifest exist. */
export interface FallbackReference {
  id: string
  mood: 'sunset' | 'contour'
  figmaNodeId: string
  title: string
  recipe: RecipeId
  /** Relative to artifacts/brief-screens/. */
  file: string
  ignore: IgnoreRect[]
}

export const MANIFEST_PATH = 'public/references/awe/manifest.json'
export const MANIFEST_DIR = 'public/references/awe'
export const FALLBACK_DIR = 'artifacts/brief-screens'
export const PRESET_DIR = 'src/light/presets/references'

/** Tile corners in the screenshots are painted white; their radius is about 3.4 % of the width. */
export function fallbackCornerRadius(width: number): number {
  return Math.ceil(width * 0.036) + 2
}

export const FALLBACK_REFERENCES: readonly FallbackReference[] = [
  { id: 'sunset-sky-peach', mood: 'sunset', figmaNodeId: '41:14', title: 'Blue sky to peach and deep red', recipe: 'sunset.ramp', file: 'sunset/s39-sky-peach.png', ignore: [] },
  { id: 'sunset-violet-wave', mood: 'sunset', figmaNodeId: '41:31', title: 'Light blue, pink glow, wavy horizon, violet to navy', recipe: 'sunset.ramp', file: 'sunset/s58-wave.png', ignore: [] },
  { id: 'sunset-red-yellow-arcs', mood: 'sunset', figmaNodeId: '41:15', title: 'Maroon to yellow to light blue in arcs', recipe: 'sunset.ramp', file: 'sunset/s40-red-yellow-arc.png', ignore: [] },
  { id: 'sunset-blue-diagonal', mood: 'sunset', figmaNodeId: '41:22', title: 'Deep blue to peach on a diagonal', recipe: 'sunset.ramp', file: 'sunset/s41-blue-diagonal.png', ignore: [] },
  {
    id: 'sunset-film-poster-bands',
    mood: 'sunset',
    figmaNodeId: '41:25',
    title: 'Blurred poster bands',
    recipe: 'sunset.bands',
    file: 'sunset/s42-poster.png',
    ignore: [{ kind: 'text', rect: [0, 1075, 925, 221] }],
  },
  {
    id: 'sunset-green-riso',
    mood: 'sunset',
    figmaNodeId: '41:26',
    title: 'Riso white to green to mustard',
    recipe: 'sunset.bands',
    file: 'sunset/s50-green-riso.png',
    ignore: [{ kind: 'fold', rect: [0, 704, 895, 24] }],
  },
  {
    id: 'sunset-blue-riso',
    mood: 'sunset',
    figmaNodeId: '41:27',
    title: 'Riso white to cyan with a slate band',
    recipe: 'sunset.bands',
    file: 'sunset/s63-blue-riso.png',
    ignore: [{ kind: 'fold', rect: [0, 684, 895, 20] }],
  },
  {
    id: 'sunset-pink-riso',
    mood: 'sunset',
    figmaNodeId: '41:28',
    title: 'Riso cream to magenta with an orange horizon',
    recipe: 'sunset.bands',
    file: 'sunset/s64-pink-riso.png',
    ignore: [{ kind: 'fold', rect: [0, 686, 895, 18] }],
  },
  { id: 'contour-rim-edge', mood: 'contour', figmaNodeId: '41:21', title: 'Blue rim along a rounded triangle', recipe: 'contour.rim', file: 'contour/c47-rim-edge.png', ignore: [] },
  {
    id: 'contour-yellow-halo',
    mood: 'contour',
    figmaNodeId: '41:23',
    title: 'Pale yellow halo arc on blue',
    recipe: 'contour.halo',
    file: 'contour/c57-yellow-arc.png',
    ignore: [{ kind: 'text', rect: [280, 1020, 365, 262] }],
  },
  { id: 'contour-iridescent-rings', mood: 'contour', figmaNodeId: '41:30', title: 'Overlapping cropped rings', recipe: 'contour.halo', file: 'contour/c48-rings.png', ignore: [] },
  { id: 'contour-radial-streaks', mood: 'contour', figmaNodeId: '41:19', title: 'Radial streaks to a bright horizon', recipe: 'contour.streaks', file: 'contour/c62-streaks.png', ignore: [] },
  { id: 'contour-beam-pool', mood: 'contour', figmaNodeId: '41:18', title: 'Beam through haze onto a floor pool', recipe: 'contour.beam', file: 'contour/c49-beam-floor.png', ignore: [] },
  { id: 'contour-light-line', mood: 'contour', figmaNodeId: '41:20', title: 'Thin line with a warm widening halo', recipe: 'contour.rim', file: 'contour/c51-line-flame.png', ignore: [] },
]

/** The Sunset and Contour reference ids (fixed, shared by every agent). */
export const REFERENCE_IDS: readonly string[] = FALLBACK_REFERENCES.map((ref) => ref.id)

/** Warp Speed references exist in the deck but have no presets yet. */
export const WARP_REFERENCE_IDS: readonly string[] = [
  'warp-long-exposure-streaks',
  'warp-refracted-column',
  'warp-curved-spectral-bands',
  'warp-film-poster-columns',
]

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isSafeReferenceId(id: string): boolean {
  return ID_PATTERN.test(id)
}
