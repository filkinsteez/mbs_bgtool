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
import { placeHorizon } from '@/light/recipes/sunset/horizon'

export { DEFAULT_CONTROLS, type ControlValues } from '@/light'

/**
 * The intensity, softness and mood control the tool sends for each mood: the panel has no sliders for them (owner,
 * 2026-11-09). A dragged line still sets the mood control from its start (`toolControls`).
 */
export const FIXED_CONTROLS: Readonly<Record<MoodId, Omit<ControlValues, 'drag'>>> = {
  sunset: { intensity: 0.5, softness: 0.5, mood: 0.5 },
  contour: { intensity: 0.5, softness: 0.5, mood: 0.5 },
  rush: { intensity: 0.5, softness: 0.5, mood: 0.5 },
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

// ---------------------------------------------------------------------------
// Dragging the light

/** The light's place in frame units: x from the left edge, y from the top edge (`ControlValues.point`). */
export type LightPoint = readonly [number, number]

/**
 * How far past each frame edge a drag may carry the light, in frame units. A drag can start anywhere in the stage
 * around the image; past this, the line's ends stay at the reach.
 */
export const POINT_REACH = 0.5

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** The mood control's own steps: the panel and the URL keep it to 0.01. */
const onSliderStep = (value: number) => Math.round(clamp01(value) * 100) / 100

/** The point within the drag's reach (-0.5..1.5 on each axis), rounded to 0.001 of the frame. */
export function clampPoint(point: readonly number[]): LightPoint {
  const axis = (value: number) => Math.round(Math.min(1 + POINT_REACH, Math.max(-POINT_REACH, value)) * 1000) / 1000 || 0
  return [axis(point[0]), axis(point[1])]
}

/** Height of the shared Sunset horizon at the frame's middle column for a Horizon value (0 top edge, 1 bottom edge). */
function horizonHeight(control: number, seed: number, aspect: number): number {
  return placeHorizon(control, seed, aspect).y
}

/** The Horizon value whose line sits at height y; the line rises steadily with the control, so halving finds it. */
function horizonFor(y: number, seed: number, aspect: number): number {
  if (y >= horizonHeight(0, seed, aspect)) return 0
  if (y <= horizonHeight(1, seed, aspect)) return 1
  let low = 0
  let high = 1
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2
    if (horizonHeight(middle, seed, aspect) > y) low = middle
    else high = middle
  }
  return (low + high) / 2
}

/** The frame's width and height in short-side units. */
const frameShorts = (aspect: number): [number, number] => (aspect >= 1 ? [aspect, 1] : [1, 1 / aspect])

const pairOf = (value: ParamValue | undefined): [number, number] | null =>
  Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? [value[0], value[1]] : null

const numberOf = (value: ParamValue | undefined): number => (typeof value === 'number' ? value : Number.NaN)

/**
 * Where a Contour look puts its light, in frame units, read from its composed
 * params: the hot spot of Rim and Halo, the pool where Beam's beam lands, the
 * point where Streaks' shafts meet; where Rush's streaks start. Null for Sunset
 * looks, whose light height is the shared horizon, and for params it can't read.
 */
export function lightPlace(scene: Scene, aspect: number): LightPoint | null {
  const [fw, fh] = frameShorts(aspect)
  const { params } = scene
  switch (scene.recipe) {
    case 'sunset.ramp':
    case 'sunset.bands':
    case 'sunset.blooms':
    case 'sunset.merged':
      return null
    case 'contour.rim':
    case 'contour.halo':
    case 'contour.merged': {
      const anchor = pairOf(params[scene.recipe === 'contour.halo' ? 'ring1At' : 'at'])
      const offset = pairOf(params.light1At)
      return anchor && offset ? [anchor[0] + offset[0] / fw, anchor[1] + offset[1] / fh] : null
    }
    case 'contour.beam': {
      // The beam lands at depth focal / (pool height - horizon), straight below where it stands on screen.
      const horizon = numberOf(params.horizon)
      const focal = numberOf(params.focal)
      const edge = Math.max(numberOf(params.floorY), horizon + 0.01)
      const k = Math.min(0.9, (numberOf(params.landing) * numberOf(params.beamWidth)) / focal)
      const place: LightPoint = [numberOf(params.beamAt) / fw + 0.5, (horizon + (edge - horizon) * (1 - k)) / fh + 0.5]
      return place.every(Number.isFinite) ? place : null
    }
    case 'contour.streaks': {
      const center = pairOf(params.center)
      return center ? [center[0] / fw + 0.5, center[1] / fh + 0.5] : null
    }
    case 'rush.split': {
      // Where the streaks start, still together, before they split into their colors.
      const start = pairOf(params.run)
      return start ? [start[0] / fw + 0.5, start[1] / fh + 0.5] : null
    }
    default: {
      const unknown: never = scene.recipe
      throw new Error(`Unknown recipe: ${String(unknown)}`)
    }
  }
}

/** Places sampled along a Contour look's Light position path, evenly from 0 to 1. */
const PATH_SAMPLES = 17
const PATH_CACHE_SIZE = 64
const pathCache = new Map<string, readonly LightPoint[] | null>()

/**
 * The places a Contour look's light takes as Light position runs from 0 to 1,
 * for a pack, seed and frame aspect, without a dragged point. Intensity and
 * Softness don't move the light, so the path is taken at their middle values.
 */
function lightPath(recipeId: RecipeId, pack: ColorPack, seed: number, aspect: number): readonly LightPoint[] | null {
  const key = `${recipeId}|${pack.id}|${seed}|${aspect.toFixed(4)}`
  const known = pathCache.get(key)
  if (known !== undefined) return known
  const places: LightPoint[] = []
  for (let i = 0; i < PATH_SAMPLES; i++) {
    const scene = buildScene(recipeId, pack, seed, { intensity: 0.5, softness: 0.5, mood: i / (PATH_SAMPLES - 1) }, aspect)
    const place = lightPlace(scene, aspect)
    if (!place) break
    places.push(place)
  }
  const path = places.length === PATH_SAMPLES ? places : null
  pathCache.set(key, path)
  if (pathCache.size > PATH_CACHE_SIZE) pathCache.delete(pathCache.keys().next().value as string)
  return path
}

/** The place at a value of the control along a sampled path. */
function pathAt(path: readonly LightPoint[], value: number): LightPoint {
  const last = path.length - 1
  const at = clamp01(value) * last
  const i = Math.min(last - 1, Math.floor(at))
  const t = at - i
  return [lerp(path[i][0], path[i + 1][0], t), lerp(path[i][1], path[i + 1][1], t)]
}

/**
 * Where two separate parts of a path lie about equally near the point, the
 * control goes between them instead of jumping from one to the other: a part
 * this much farther (short-side units) than the nearest still counts 1 / e.
 */
const NEAR_WIDTH = 0.03

/**
 * For each stretch of the path between two samples, its place nearest the point: the control value there and how far
 * it is from the point (short-side units).
 */
function nearestOnStretches(path: readonly LightPoint[], point: LightPoint, aspect: number): { value: number; distance: number }[] {
  const [fw, fh] = frameShorts(aspect)
  const px = point[0] * fw
  const py = point[1] * fh
  const last = path.length - 1
  const found: { value: number; distance: number }[] = []
  for (let i = 0; i < last; i++) {
    const ax = path[i][0] * fw
    const ay = path[i][1] * fh
    const dx = path[i + 1][0] * fw - ax
    const dy = path[i + 1][1] * fh - ay
    const length2 = dx * dx + dy * dy
    const t = length2 > 1e-12 ? clamp01(((px - ax) * dx + (py - ay) * dy) / length2) : 0
    found.push({ value: (i + t) / last, distance: Math.hypot(ax + t * dx - px, ay + t * dy - py) })
  }
  return found
}

/** The control value whose place on the path lies nearest the point. */
function nearestOnPath(path: readonly LightPoint[], point: LightPoint, aspect: number): number {
  const found = nearestOnStretches(path, point, aspect)
  // Each part of the path that comes near the point counts once, at its nearest place.
  const parts = found.filter(
    (f, i) => (i === 0 || f.distance <= found[i - 1].distance) && (i === found.length - 1 || f.distance <= found[i + 1].distance),
  )
  const nearest = Math.min(...parts.map((f) => f.distance))
  let sum = 0
  let weight = 0
  for (const f of parts) {
    const w = Math.exp(-(f.distance - nearest) / NEAR_WIDTH)
    sum += w * f.value
    weight += w
  }
  return sum / weight
}

const moodOf = (recipeId: RecipeId): MoodId => getRecipe(recipeId).mood

/**
 * The mood control value, on the slider's 0.01 steps, that puts the look's
 * light nearest the point. Sunset: the Horizon whose shared line sits at the
 * point's height. Contour: the Light position whose light lies nearest the
 * point along the look's own path. Null when a Contour look's light can't be
 * read from its params, and for Rush, whose line sets the streaks itself.
 */
export function moodForPoint(recipeId: RecipeId, pack: ColorPack, seed: number, aspect: number, point: LightPoint): number | null {
  const mood = moodOf(recipeId)
  switch (mood) {
    case 'sunset':
      return onSliderStep(horizonFor(point[1], seed, aspect))
    case 'contour': {
      const path = lightPath(recipeId, pack, seed, aspect)
      return path ? onSliderStep(nearestOnPath(path, point, aspect)) : null
    }
    case 'rush':
      return null
    default: {
      const unknown: never = mood
      throw new Error(`Unknown mood: ${String(unknown)}`)
    }
  }
}

/**
 * How near (short-side units) a Contour look's light must be able to come to a dragged line's start for the line to
 * stay through a new seed, look, pack or format.
 */
export const KEEP_LINE_DISTANCE = 0.1

/**
 * Whether a dragged line stays when the seed, look, pack or format changes. Sunset: always, as the shared horizon can
 * sit at the line's height for every seed. Contour: only when the look's light path in the new scene comes within
 * KEEP_LINE_DISTANCE of the line's start; farther away, the place on the path nearest the start is mostly an end of
 * the path, where the light is at the end of its track. A Contour path that can't be read keeps the line. Rush: always,
 * as its streaks start wherever the line does.
 */
export function keepsLine(recipeId: RecipeId, pack: ColorPack, seed: number, aspect: number, start: LightPoint): boolean {
  const mood = moodOf(recipeId)
  switch (mood) {
    case 'sunset':
      return true
    case 'contour': {
      const path = lightPath(recipeId, pack, seed, aspect)
      if (!path) return true
      return Math.min(...nearestOnStretches(path, start, aspect).map((f) => f.distance)) <= KEEP_LINE_DISTANCE
    }
    case 'rush':
      return true
    default: {
      const unknown: never = mood
      throw new Error(`Unknown mood: ${String(unknown)}`)
    }
  }
}

/**
 * How far the look's light moves (frame units) when the mood control goes
 * from `from` to `to`: the shared horizon's height change for Sunset, the
 * move along the look's own path for Contour, none for Rush.
 */
function moodShift(recipeId: RecipeId, pack: ColorPack, seed: number, aspect: number, from: number, to: number): LightPoint {
  const mood = moodOf(recipeId)
  switch (mood) {
    case 'sunset':
      return [0, horizonHeight(to, seed, aspect) - horizonHeight(from, seed, aspect)]
    case 'contour': {
      const path = lightPath(recipeId, pack, seed, aspect)
      if (!path) return [0, 0]
      const a = pathAt(path, from)
      const b = pathAt(path, to)
      return [b[0] - a[0], b[1] - a[1]]
    }
    case 'rush':
      return [0, 0]
    default: {
      const unknown: never = mood
      throw new Error(`Unknown mood: ${String(unknown)}`)
    }
  }
}

/** The line the user dragged on the image (`ControlValues.drag`): from where the light is strongest to where it reaches the look's far end. */
export interface LightDrag {
  from: LightPoint
  to: LightPoint
}

/** A line shorter than this (frame units) has no clear direction, so it counts as no line. */
export const MIN_DRAG_LENGTH = 0.002

/** The line with both ends within the drag's reach, on 0.001 of the frame; undefined when it is too short to have a direction. */
export function clampDrag(drag: { from: readonly number[]; to: readonly number[] }): LightDrag | undefined {
  const from = clampPoint(drag.from)
  const to = clampPoint(drag.to)
  return Math.hypot(to[0] - from[0], to[1] - from[1]) >= MIN_DRAG_LENGTH ? { from, to } : undefined
}

/** A length on the 0.001-of-the-frame steps the line's ends are kept to. */
const onLineStep = (value: number) => Math.round(value * 1000) / 1000 || 0

/**
 * Where the dragged line goes when the mood control moves from `from` to
 * `to`: both ends move as far as the look's light moves for that change, so
 * the line keeps its direction and length and the slider carries the light on
 * from where the drag left it. The move is rounded once to the ends' 0.001
 * steps, so both ends move alike, equal slider steps move the line equally,
 * and the ends stay on the steps the URL keeps.
 */
export function moveDragWithMood(
  recipeId: RecipeId,
  pack: ColorPack,
  seed: number,
  aspect: number,
  drag: LightDrag,
  from: number,
  to: number,
): LightDrag {
  const [dx, dy] = moodShift(recipeId, pack, seed, aspect, from, to).map(onLineStep)
  return { from: clampPoint([drag.from[0] + dx, drag.from[1] + dy]), to: clampPoint([drag.to[0] + dx, drag.to[1] + dy]) }
}

/**
 * The controls for a dragged line: the line, and the mood control set from
 * its start, so the slider shows where the light starts.
 */
export function controlsForDrag(
  recipeId: RecipeId,
  pack: ColorPack,
  seed: number,
  controls: ControlValues,
  aspect: number,
  drag: LightDrag,
): ControlValues & { drag: LightDrag } {
  const mood = moodForPoint(recipeId, pack, seed, aspect, drag.from)
  return { ...controls, mood: mood ?? controls.mood, drag }
}

/**
 * The controls the tool sends for a look: the mood's fixed intensity, softness and mood control, and the dragged line,
 * with the mood control set from the line's start as `controlsForDrag` sets it.
 */
export function toolControls(recipeId: RecipeId, pack: ColorPack, seed: number, aspect: number, drag?: LightDrag): ControlValues {
  const controls = { ...FIXED_CONTROLS[moodOf(recipeId)] }
  return drag ? controlsForDrag(recipeId, pack, seed, controls, aspect, drag) : controls
}
