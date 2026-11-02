import type { ColorPack } from './color/packs'
import { isHex, normalizeHex } from './color/srgb'
import {
  DEFAULT_LENS,
  DEFAULT_OUTPUT,
  LENS_COLORS,
  LENS_NUMBERS,
  OUTPUT_NUMBERS,
  type ComposeInput,
  type Composition,
  type ParamSpec,
  type ParamValue,
  type RecipeDefinition,
  type Scene,
} from './scene'

/** No light. Allowed in a composition next to the pack's colors. */
export const NO_LIGHT = '#000000'

const LENS_LISTS = ['bloomLevels', 'bloomLevelTints'] as const
const MAX_LENS_LEVELS = 8

/** The tool's scene from the recipe's compose, or null when the recipe has none. */
export function composeScene(recipe: RecipeDefinition, input: ComposeInput): Scene | null {
  if (!recipe.compose) return null
  const { colors, params, lens, output } = recipe.compose(input)
  return { recipe: recipe.id, seed: input.seed, colors, params, lens, output }
}

/** Why a param value does not fit its spec, or null when it fits. */
export function paramProblem(spec: ParamSpec, value: ParamValue): string | null {
  switch (spec.kind) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'is not a finite number'
      if (value < spec.min || value > spec.max) return `${value} is outside ${spec.min}..${spec.max}`
      return null
    case 'boolean':
      return typeof value === 'boolean' ? null : 'is not a boolean'
    case 'vector': {
      if (!Array.isArray(value) || value.length !== spec.default.length) return `is not a vector of ${spec.default.length}`
      const bad = value.find((v) => typeof v !== 'number' || !Number.isFinite(v) || v < spec.min || v > spec.max)
      return bad === undefined ? null : `component ${bad} is outside ${spec.min}..${spec.max}`
    }
    default: {
      const unknown: never = spec
      return `has an unknown kind: ${JSON.stringify(unknown)}`
    }
  }
}

function settingProblems(
  group: 'lens' | 'output',
  values: Record<string, unknown>,
  defaults: object,
  numbers: readonly { key: string; min: number; max: number }[],
  colorKeys: readonly string[],
  lists: readonly string[],
): string[] {
  const problems: string[] = []
  const ranges = new Map(numbers.map((setting) => [setting.key, setting]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (lists.includes(key)) {
      const isTints = key === 'bloomLevelTints'
      const ok =
        Array.isArray(value) &&
        value.length <= MAX_LENS_LEVELS &&
        value.every((v) => (isTints ? typeof v === 'string' && isHex(v) : typeof v === 'number' && Number.isFinite(v) && v >= 0))
      if (!ok) problems.push(`${group}.${key} is not a list of up to ${MAX_LENS_LEVELS} ${isTints ? 'hexes' : 'numbers >= 0'}`)
      continue
    }
    if (!(key in defaults)) {
      problems.push(`${group}.${key} does not exist`)
      continue
    }
    if (colorKeys.includes(key)) {
      if (typeof value !== 'string' || !isHex(value)) problems.push(`${group}.${key} = ${String(value)} is not a hex`)
      continue
    }
    const range = ranges.get(key)
    if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${group}.${key} = ${String(value)} is not a finite number`)
    else if (range && (value < range.min || value > range.max)) problems.push(`${group}.${key} = ${value} is outside ${range.min}..${range.max}`)
  }
  return problems
}

/**
 * What is wrong with a composition for this recipe and pack: params the recipe
 * does not declare, wrong kinds, values out of range, unknown lens or output
 * settings, and colors that are not exact hexes of the pack (or #000000).
 * Empty when it is valid.
 */
export function compositionProblems(recipe: RecipeDefinition, pack: ColorPack, composition: Composition): string[] {
  const problems: string[] = []
  const allowed = new Set([...pack.colors.map((c) => c.hex), NO_LIGHT])
  if (!Array.isArray(composition.colors) || composition.colors.length !== recipe.colorSlots.length) {
    problems.push(`colors has ${composition.colors?.length ?? 0} entries; the recipe has ${recipe.colorSlots.length} slots`)
  }
  for (const [i, hex] of (composition.colors ?? []).entries()) {
    if (typeof hex !== 'string' || !isHex(hex) || !allowed.has(normalizeHex(hex))) {
      problems.push(`color ${i} (${recipe.colorSlots[i]?.key ?? '?'}) = ${String(hex)} is not a ${pack.id} color`)
    }
  }
  const specs = new Map(recipe.params.map((spec) => [spec.key, spec]))
  for (const [key, value] of Object.entries(composition.params ?? {})) {
    const spec = specs.get(key)
    const problem = spec ? paramProblem(spec, value) : 'is not in the recipe params'
    if (problem) problems.push(`param ${key} ${problem}`)
  }
  problems.push(
    ...settingProblems('lens', composition.lens ?? {}, DEFAULT_LENS, LENS_NUMBERS, LENS_COLORS.map((c) => c.key), LENS_LISTS),
    ...settingProblems('output', composition.output ?? {}, DEFAULT_OUTPUT, OUTPUT_NUMBERS, [], []),
  )
  return problems
}
