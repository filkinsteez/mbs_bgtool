import { hexToLinear, isHex, normalizeHex, type Rgb } from '../color/srgb'
import {
  DEFAULT_LENS,
  DEFAULT_OUTPUT,
  type LensSettings,
  type OutputSettings,
  type ParamSpec,
  type ParamValue,
  type RecipeContext,
  type RecipeProgram,
  type Scene,
} from '../scene'

/** A scene without its recipe id; every field optional. */
export type SceneInput = Partial<Omit<Scene, 'recipe'>>

export interface ResolvedScene {
  program: RecipeProgram
  seed: number
  hex: string[]
  colors: Rgb[]
  params: Record<string, ParamValue>
  lens: LensSettings
  output: OutputSettings
}

export function defaultParams(program: Pick<RecipeProgram, 'params'>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {}
  for (const spec of program.params) out[spec.key] = cloneDefault(spec)
  return out
}

function cloneDefault(spec: ParamSpec): ParamValue {
  switch (spec.kind) {
    case 'number':
    case 'boolean':
      return spec.default
    case 'vector':
      return [...spec.default]
    default: {
      const unknown: never = spec
      throw new Error(`Unknown param kind: ${JSON.stringify(unknown)}`)
    }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Returns a valid value for the spec: the given value when it fits (clamped to range), else the default. */
export function coerceParam(spec: ParamSpec, value: unknown): ParamValue {
  switch (spec.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? clamp(value, spec.min, spec.max) : spec.default
    case 'boolean':
      return typeof value === 'boolean' ? value : spec.default
    case 'vector': {
      if (!Array.isArray(value) || value.length !== spec.default.length) return [...spec.default]
      return value.map((v, i) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default[i]))
    }
    default: {
      const unknown: never = spec
      throw new Error(`Unknown param kind: ${JSON.stringify(unknown)}`)
    }
  }
}

function mergeNumbers<T extends object>(base: T, ...layers: (Partial<T> | undefined)[]): T {
  const out = { ...base } as Record<string, unknown>
  for (const layer of layers) {
    if (!layer) continue
    for (const [key, value] of Object.entries(layer)) {
      if (!(key in base)) continue
      const current = (base as Record<string, unknown>)[key]
      if (typeof current === 'number' && typeof value === 'number' && Number.isFinite(value)) out[key] = value
      else if (typeof current === 'string' && typeof value === 'string' && isHex(value)) out[key] = normalizeHex(value)
      else if (typeof current === 'boolean' && typeof value === 'boolean') out[key] = value
    }
  }
  return out as T
}

export function resolveLens(program: RecipeProgram, lens?: Partial<LensSettings>): LensSettings {
  const out = mergeNumbers(DEFAULT_LENS, program.lens, lens)
  const levels = lens?.bloomLevels ?? program.lens?.bloomLevels
  if (Array.isArray(levels) && levels.length > 0 && levels.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
    out.bloomLevels = levels.slice(0, 8)
  }
  const tints = lens?.bloomLevelTints ?? program.lens?.bloomLevelTints
  if (Array.isArray(tints) && tints.length > 0 && tints.every((v) => typeof v === 'string' && isHex(v))) {
    out.bloomLevelTints = tints.slice(0, 8).map(normalizeHex)
  }
  return out
}

export function resolveOutput(program: RecipeProgram, output?: Partial<OutputSettings>): OutputSettings {
  return mergeNumbers(DEFAULT_OUTPUT, program.output, output)
}

export function resolveColors(program: RecipeProgram, colors?: readonly string[]): string[] {
  return program.colorSlots.map((_, i) => {
    const given = colors?.[i]
    if (typeof given === 'string' && isHex(given)) return normalizeHex(given)
    return normalizeHex(program.defaultColors[i] ?? '#000000')
  })
}

export function resolveScene(program: RecipeProgram, scene: SceneInput): ResolvedScene {
  const params: Record<string, ParamValue> = {}
  for (const spec of program.params) params[spec.key] = coerceParam(spec, scene.params?.[spec.key])
  const hex = resolveColors(program, scene.colors)
  const seed = typeof scene.seed === 'number' && Number.isFinite(scene.seed) ? Math.round(scene.seed) : 1
  return {
    program,
    seed,
    hex,
    colors: hex.map(hexToLinear),
    params,
    lens: resolveLens(program, scene.lens),
    output: resolveOutput(program, scene.output),
  }
}

/** The context a recipe's functions get; `aspect` is the frame's width / height from `frameAspect`. */
export function recipeContext(resolved: ResolvedScene, aspect: number): RecipeContext {
  const { params, colors, hex, seed, program } = resolved
  const get = (key: string): ParamValue => {
    if (!(key in params)) throw new Error(`${program.id} has no param "${key}"`)
    return params[key]
  }
  return {
    params,
    colors,
    hex,
    seed,
    aspect,
    num: (key) => {
      const v = get(key)
      if (typeof v !== 'number') throw new Error(`${program.id} param "${key}" is not a number`)
      return v
    },
    bool: (key) => {
      const v = get(key)
      if (typeof v !== 'boolean') throw new Error(`${program.id} param "${key}" is not a boolean`)
      return v
    },
    vec: (key) => {
      const v = get(key)
      if (!Array.isArray(v)) throw new Error(`${program.id} param "${key}" is not a vector`)
      return v
    },
    color: (key) => {
      const index = program.colorSlots.findIndex((slot) => slot.key === key)
      if (index < 0) throw new Error(`${program.id} has no color slot "${key}"`)
      return colors[index]
    },
  }
}
