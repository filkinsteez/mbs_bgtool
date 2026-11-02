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

export { DEFAULT_CONTROLS, type ControlValues } from '@/light'

export type MoodControlKey = 'horizon' | 'light'

export const MOOD_CONTROL: Readonly<Record<MoodId, MoodControlKey>> = {
  sunset: 'horizon',
  contour: 'light',
}

export interface RecipeMapping {
  params: (controls: ControlValues, pack: ColorPack) => Record<string, ParamValue>
  lens?: (controls: ControlValues) => Partial<LensSettings>
  output?: (controls: ControlValues) => Partial<OutputSettings>
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Piecewise linear through (0, lo), (0.5, mid), (1, hi). */
function lin(t: number, lo: number, mid: number, hi: number): number {
  const u = clamp01(t)
  return u < 0.5 ? lerp(lo, mid, u * 2) : lerp(mid, hi, (u - 0.5) * 2)
}

/** Piecewise geometric through (0, lo), (0.5, mid), (1, hi); for widths and gains (all > 0). */
function geo(t: number, lo: number, mid: number, hi: number): number {
  const u = clamp01(t)
  return u < 0.5 ? lo * (mid / lo) ** (u * 2) : mid * (hi / mid) ** ((u - 0.5) * 2)
}

/** A point along a polyline of frame positions, by arc length in frame units. */
function alongPath(points: readonly (readonly [number, number])[], t: number): [number, number] {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]))
  let remaining = clamp01(t) * lengths.reduce((a, b) => a + b, 0)
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] > 0 ? Math.min(1, remaining / lengths[i]) : 0
      return [lerp(points[i][0], points[i + 1][0], f), lerp(points[i][1], points[i + 1][1], f)]
    }
    remaining -= lengths[i]
  }
  return [points[0][0], points[0][1]]
}

const RIM_LIGHT_PATH = [
  [0.12, 0.1],
  [0.74, 0.1],
  [0.2, 0.86],
] as const

/** Fallback mappings for recipes without `compose`. A recipe owner deletes the entry once the recipe defines compose. */
export const CONTROL_MAPPINGS: Readonly<Partial<Record<RecipeId, RecipeMapping>>> = {
  'contour.rim': {
    params: ({ intensity, softness, mood }) => ({
      line: false,
      lightAt: alongPath(RIM_LIGHT_PATH, mood),
      lightReach: 0.45,
      coreWidth: geo(softness, 0.002, 0.005, 0.012),
      tailWidth: geo(softness, 0.015, 0.035, 0.08),
      tailWeight: 0.35,
      intensity: geo(intensity, 1, 2.5, 6.5),
      ambient: 0.15,
      fill: 0.15,
      fillDepth: geo(softness, 0.2, 0.3, 0.45),
    }),
    lens: ({ intensity, softness }) => ({
      bloom: lin(softness, 0.03, 0.06, 0.12),
      bloomRadius: lin(softness, 0.35, 0.45, 0.6),
      halation: lin(intensity, 0.05, 0.15, 0.35),
      halationThreshold: 0.8,
      halationRadius: lin(softness, 0.025, 0.04, 0.07),
    }),
  },
  'contour.halo': {
    params: ({ intensity, softness, mood }) => ({
      rings: 1,
      ring1At: [lin(mood, 0.8, 1.15, 1.38), lin(mood, 1.12, 1.05, 0.95)],
      ring1Radius: 1.05,
      ring1Gain: geo(intensity, 0.2, 0.5, 1.4),
      coreWidth: geo(softness, 0.025, 0.06, 0.12),
      tailIn: geo(softness, 0.06, 0.12, 0.25),
      tailOut: geo(softness, 0.1, 0.2, 0.4),
      edgeSoftness: geo(softness, 0.1, 0.25, 0.5),
      intensity: 1,
    }),
    lens: ({ softness }) => ({ bloom: lin(softness, 0.03, 0.06, 0.12), bloomRadius: lin(softness, 0.5, 0.6, 0.75) }),
  },
}

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
