import {
  getRecipe,
  type ColorPack,
  type LensSettings,
  type MoodId,
  type OutputSettings,
  type ParamValue,
  type RecipeId,
  type Scene,
} from '@/light'

/** The three tool controls, each 0..1. `mood` is Horizon for Sunset and Light for Contour. */
export interface ControlValues {
  intensity: number
  softness: number
  mood: number
}

export const DEFAULT_CONTROLS: ControlValues = { intensity: 0.5, softness: 0.5, mood: 0.5 }

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

// Band widths below the first (Meta Blue) band, by band count. Unequal on purpose.
const BAND_SHARES: Readonly<Record<number, readonly number[]>> = {
  3: [0.45, 0.55],
  4: [0.3, 0.32, 0.38],
  5: [0.22, 0.27, 0.23, 0.28],
}

const RIM_LIGHT_PATH = [
  [0.12, 0.1],
  [0.74, 0.1],
  [0.2, 0.86],
] as const

export const CONTROL_MAPPINGS: Readonly<Record<RecipeId, RecipeMapping>> = {
  'sunset.ramp': {
    params: ({ intensity, softness, mood }) => {
      const horizon = lin(mood, 0.4, 0.64, 0.86)
      return {
        stops: 3,
        pos1: 0,
        pos2: horizon,
        pos3: 1,
        horizon,
        softness: lin(softness, 0.02, 0.1, 0.28),
        warp: 0.04,
        warpScale: 1.2,
        glow: lin(intensity, 0.05, 0.35, 1.1),
        glowWidth: geo(softness, 0.05, 0.11, 0.24),
        intensity: lin(intensity, 0.8, 1, 1.35),
      }
    },
    lens: ({ softness }) => ({ bloom: lin(softness, 0.01, 0.05, 0.14), bloomRadius: lin(softness, 0.6, 0.75, 0.88) }),
  },
  'sunset.bands': {
    params: ({ intensity, softness, mood }, pack) => {
      const bands = Math.min(5, Math.max(3, pack.colors.length))
      const first = lin(mood, 0.3, 0.46, 0.64)
      const edges: Record<string, number> = {}
      let at = first
      edges.edge1 = at
      BAND_SHARES[bands].slice(0, -1).forEach((share, i) => {
        at += share * (1 - first)
        edges[`edge${i + 2}`] = at
      })
      return {
        bands,
        ...edges,
        softness: lin(softness, 0.02, 0.08, 0.2),
        softVary: 0.5,
        warp: 0.03,
        warpScale: 1.4,
        bandLight: lin(intensity, 0.04, 0.1, 0.2),
        intensity: lin(intensity, 0.75, 1, 1.5),
      }
    },
    lens: ({ softness }) => ({ bloom: lin(softness, 0.01, 0.05, 0.14), bloomRadius: lin(softness, 0.55, 0.7, 0.85) }),
  },
  'sunset.blooms': {
    params: ({ intensity, softness, mood }) => {
      const gain = geo(intensity, 0.22, 0.5, 1.5)
      const size = geo(softness, 0.7, 1, 1.45)
      const shift = lin(mood, -0.25, 0, 0.25)
      return {
        glows: 3,
        glow1At: [0.25, 0.3 + shift],
        glow1Radius: 0.42 * size,
        glow1Gain: 0.45 * gain,
        glow1Stretch: 1.6,
        glow2At: [0.75, 0.55 + shift],
        glow2Radius: 0.32 * size,
        glow2Gain: 0.3 * gain,
        glow2Stretch: 1.3,
        glow3At: [0.45, 0.95 + shift],
        glow3Radius: 0.46 * size,
        glow3Gain: 0.35 * gain,
        glow3Stretch: 2,
        haze: lin(softness, 0.1, 0.25, 0.5),
        warp: 0.05,
        intensity: 1,
      }
    },
    lens: ({ softness }) => ({ bloom: lin(softness, 0.03, 0.08, 0.16), bloomRadius: lin(softness, 0.7, 0.8, 0.9) }),
  },
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
  'contour.beam': {
    params: ({ intensity, softness, mood }) => {
      const gain = geo(intensity, 0.45, 1, 2.2)
      return {
        source: [lin(mood, 0.22, 0.5, 0.78), -0.15],
        floorY: 0.72,
        spread: lin(softness, 6, 9, 14),
        beamWidth: geo(softness, 0.06, 0.12, 0.22),
        beamGain: 0.45 * gain,
        haze: 1.2,
        poolGain: 2 * gain,
        poolWidth: geo(softness, 0.16, 0.22, 0.32),
        poolHeight: geo(softness, 0.012, 0.02, 0.04),
        floorGain: 0.8 * gain,
        floorReach: geo(softness, 0.25, 0.35, 0.5),
        streaks: 0.6,
        intensity: 1,
      }
    },
    lens: ({ intensity, softness }) => ({
      bloom: lin(softness, 0.06, 0.1, 0.16),
      bloomRadius: lin(softness, 0.4, 0.5, 0.65),
      halation: lin(intensity, 0.04, 0.1, 0.25),
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

/** Recipe defaults, the pack's colors (by the recipe's own role picks) and the controls' overrides. */
export function buildScene(recipeId: RecipeId, pack: ColorPack, seed: number, controls: ControlValues): Scene {
  const recipe = getRecipe(recipeId)
  const mapping = CONTROL_MAPPINGS[recipeId]
  return {
    recipe: recipeId,
    seed,
    colors: recipe.fromPack(pack),
    params: mapping.params(controls, pack),
    lens: mapping.lens?.(controls) ?? {},
    output: mapping.output?.(controls) ?? {},
  }
}
