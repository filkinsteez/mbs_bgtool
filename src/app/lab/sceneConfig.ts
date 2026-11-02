import type { ColorConfig, DialConfig, DialValue, SelectConfig } from 'dialkit'
import { isHex, normalizeHex } from '@/light/color/srgb'
import { defaultParams, resolveLens, resolveOutput, resolveScene } from '@/light/engine/resolve'
import { RECIPE_LIST, getRecipe } from '@/light/recipes'
import {
  LENS_COLORS,
  LENS_NUMBERS,
  OUTPUT_NUMBERS,
  isRecipeId,
  type LensSettings,
  type OutputSettings,
  type ParamSpec,
  type ParamValue,
  type Preset,
  type RecipeDefinition,
  type RecipeId,
  type Scene,
} from '@/light/scene'

/** Fits round to 4 decimals, so sliders keep 4: DialKit rounds values to the slider step whenever the config changes. */
export const VALUE_STEP = 0.0001
const AXES = ['x', 'y', 'z', 'w']
const SEED_MAX = 99999

export const RECIPE_OPTIONS = RECIPE_LIST.map((recipe) => ({ value: recipe.id, label: recipe.id }))

type Values = Readonly<Record<string, unknown>>

const sliderStep = (step: number) => (step >= 1 ? step : VALUE_STEP)
const axisKey = (index: number) => AXES[index] ?? `c${index + 1}`
const isRecord = (value: unknown): value is Values => typeof value === 'object' && value !== null && !Array.isArray(value)
const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const hexOr = (value: unknown, fallback: string) => (typeof value === 'string' && isHex(value) ? normalizeHex(value) : fallback)

function paramControl(spec: ParamSpec, value: ParamValue): DialConfig[string] {
  switch (spec.kind) {
    case 'number':
      return [numberOr(value, spec.default), spec.min, spec.max, sliderStep(spec.step)]
    case 'boolean':
      return typeof value === 'boolean' ? value : spec.default
    case 'vector': {
      const vector = Array.isArray(value) && value.length === spec.default.length ? value : spec.default
      return Object.fromEntries(vector.map((component, i) => [axisKey(i), [component, spec.min, spec.max, sliderStep(spec.step)]]))
    }
    default: {
      const unknown: never = spec
      throw new Error(`Unknown param kind: ${JSON.stringify(unknown)}`)
    }
  }
}

function readParam(spec: ParamSpec, value: unknown): ParamValue {
  switch (spec.kind) {
    case 'number':
      return numberOr(value, spec.default)
    case 'boolean':
      return typeof value === 'boolean' ? value : spec.default
    case 'vector':
      return spec.default.map((fallback, i) => numberOr(isRecord(value) ? value[axisKey(i)] : undefined, fallback))
    default: {
      const unknown: never = spec
      throw new Error(`Unknown param kind: ${JSON.stringify(unknown)}`)
    }
  }
}

/** Arrow-key steps for the sliders: the ParamSpec and setting steps, since the sliders themselves are much finer. */
export function sceneKeySteps(recipe: RecipeDefinition): Record<string, number> {
  const steps: Record<string, number> = {}
  for (const spec of recipe.params) {
    if (spec.kind === 'number') steps[`params.${spec.key}`] = spec.step
    if (spec.kind === 'vector') spec.default.forEach((_, i) => (steps[`params.${spec.key}.${axisKey(i)}`] = spec.step))
  }
  for (const setting of LENS_NUMBERS) steps[`lens.${setting.key}`] = setting.step
  for (const setting of OUTPUT_NUMBERS) steps[`output.${setting.key}`] = setting.step
  return steps
}

/**
 * A panel config for a scene: recipe, seed, the color slots (when asked), then
 * one folder each for the recipe's params, the lens and the output. Built from
 * the recipe's ParamSpec at run time; every default is the scene's resolved value.
 */
export function sceneDialConfig(scene: Scene, options: { colors: boolean }): DialConfig {
  const recipe = getRecipe(scene.recipe)
  const resolved = resolveScene(recipe, scene)
  const config: DialConfig = {
    recipe: { type: 'select', options: RECIPE_OPTIONS, default: recipe.id },
    seed: [resolved.seed, 0, Math.max(SEED_MAX, resolved.seed), 1],
  }
  if (options.colors) {
    config.colors = Object.fromEntries(recipe.colorSlots.map((slot, i) => [slot.key, { type: 'color', default: resolved.hex[i] }]))
  }
  config.params = Object.fromEntries(recipe.params.map((spec) => [spec.key, paramControl(spec, resolved.params[spec.key])]))
  config.lens = {
    _collapsed: true,
    ...Object.fromEntries(LENS_NUMBERS.map((s) => [s.key, [resolved.lens[s.key], s.min, s.max, sliderStep(s.step)]])),
    ...Object.fromEntries(LENS_COLORS.map((s) => [s.key, { type: 'color', default: resolved.lens[s.key] }])),
  }
  config.output = {
    _collapsed: true,
    ...Object.fromEntries(OUTPUT_NUMBERS.map((s) => [s.key, [resolved.output[s.key], s.min, s.max, sliderStep(s.step)]])),
  }
  return config
}

function isSelect(control: DialConfig[string]): control is SelectConfig {
  return typeof control === 'object' && !Array.isArray(control) && control.type === 'select' && 'options' in control
}

function isColor(control: DialConfig[string]): control is ColorConfig {
  return typeof control === 'object' && !Array.isArray(control) && control.type === 'color'
}

/** The values DialKit starts a config with, as flat dot paths like DialKit's store keeps them. */
export function configDefaults(config: DialConfig, prefix = ''): Record<string, DialValue> {
  const values: Record<string, DialValue> = {}
  for (const [key, control] of Object.entries(config)) {
    if (key === '_collapsed') continue
    const path = prefix ? `${prefix}.${key}` : key
    if (Array.isArray(control)) values[path] = control[0]
    else if (typeof control !== 'object') values[path] = control
    else if (isSelect(control)) {
      const first = control.options[0]
      values[path] = control.default ?? (typeof first === 'string' ? first : (first?.value ?? ''))
    } else if (isColor(control)) values[path] = control.default ?? '#000000'
    else if (!('type' in control)) Object.assign(values, configDefaults(control, path))
  }
  return values
}

/** Flat dot paths back into nested objects, the shape of DialKit's live values. */
export function nestValues(flat: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const nested: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split('.')
    let node = nested
    for (const key of keys.slice(0, -1)) {
      if (!isRecord(node[key])) node[key] = {}
      node = node[key] as Record<string, unknown>
    }
    node[keys[keys.length - 1]] = value
  }
  return nested
}

/** The recipe id in the panel values, or the fallback when it is missing or unknown. */
export function recipeOf(values: Values, fallback: RecipeId): RecipeId {
  const recipe = values.recipe
  return typeof recipe === 'string' && isRecipeId(recipe) ? recipe : fallback
}

/**
 * The scene the panel values describe. `base` fills what the panel has no
 * control for: colors when the panel shows none, and lens and output settings
 * without a control (such as bloomLevels), which also come from the recipe.
 */
export function sceneFromValues(recipeId: RecipeId, values: Values, base: Scene): Scene {
  const recipe = getRecipe(recipeId)
  const params = isRecord(values.params) ? values.params : {}
  const colors = values.colors
  const lens = isRecord(values.lens) ? values.lens : {}
  const output = isRecord(values.output) ? values.output : {}
  const fallback = resolveScene(recipe, { ...base, params: {} })
  return {
    recipe: recipeId,
    seed: Math.round(numberOr(values.seed, base.seed)),
    colors: isRecord(colors) ? recipe.colorSlots.map((slot, i) => hexOr(colors[slot.key], fallback.hex[i])) : [...base.colors],
    params: Object.fromEntries(recipe.params.map((spec) => [spec.key, readParam(spec, params[spec.key])])),
    lens: {
      ...base.lens,
      ...fallback.lens,
      ...Object.fromEntries(LENS_NUMBERS.map((s) => [s.key, numberOr(lens[s.key], fallback.lens[s.key])])),
      ...Object.fromEntries(LENS_COLORS.map((s) => [s.key, hexOr(lens[s.key], fallback.lens[s.key])])),
    },
    output: {
      ...base.output,
      ...fallback.output,
      ...Object.fromEntries(OUTPUT_NUMBERS.map((s) => [s.key, numberOr(output[s.key], fallback.output[s.key])])),
    },
  }
}

/** The scene for switching `base` to another recipe: that recipe's params, the old colors kept by slot index. */
export function switchRecipe(base: Scene, recipeId: RecipeId): Scene {
  const recipe = getRecipe(recipeId)
  return {
    ...base,
    recipe: recipeId,
    colors: recipe.colorSlots.map((_, i) => base.colors[i] ?? recipe.defaultColors[i]),
    params: defaultParams(recipe),
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9
  if (typeof a === 'string' && typeof b === 'string' && isHex(a) && isHex(b)) return normalizeHex(a) === normalizeHex(b)
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => sameValue(value, b[i]))
  return a === b
}

/** Keys the file had, in its order and with current values; then keys that now differ from the recipe's defaults. */
function settingsToSave<T extends object>(written: Partial<T>, current: T, defaults: T): Partial<T> {
  const out: Record<string, unknown> = {}
  const now = current as Record<string, unknown>
  const before = defaults as Record<string, unknown>
  for (const [key, value] of Object.entries(written)) out[key] = key in now ? now[key] : value
  for (const [key, value] of Object.entries(now)) {
    if (!(key in out) && !sameValue(value, before[key])) out[key] = value
  }
  return out as Partial<T>
}

/**
 * The file's colors with current values; slots after them only while they
 * differ from the recipe's defaults; colors past the recipe's slots kept as written.
 */
function colorsToSave(written: readonly string[], current: readonly string[], defaults: readonly string[]): string[] {
  let length = current.length
  while (length > written.length && sameValue(current[length - 1], defaults[length - 1])) length--
  return [...current.slice(0, length), ...written.slice(current.length)]
}

/**
 * The preset to save, in the file's shape: colors, params and settings the
 * file had stay (with current values, in the file's order); ones it did not
 * have are written only when they differ from the recipe's defaults. An
 * untouched preset saves back to the same file. After a recipe change every
 * color and param is written.
 */
export function presetToSave(file: Preset, scene: Scene): Preset {
  const recipe = getRecipe(scene.recipe)
  const sameRecipe = file.scene.recipe === scene.recipe
  return {
    id: file.id,
    referenceId: file.referenceId,
    scene: {
      recipe: scene.recipe,
      seed: scene.seed,
      colors: sameRecipe ? colorsToSave(file.scene.colors, scene.colors, recipe.defaultColors) : scene.colors,
      params: sameRecipe ? (settingsToSave(file.scene.params, scene.params, defaultParams(recipe)) as Record<string, ParamValue>) : scene.params,
      lens: settingsToSave<LensSettings>(sameRecipe ? file.scene.lens : {}, scene.lens as LensSettings, resolveLens(recipe)),
      output: settingsToSave<OutputSettings>(sameRecipe ? file.scene.output : {}, scene.output as OutputSettings, resolveOutput(recipe)),
    },
  }
}
