import { isHex } from '@/light/color/srgb'
import { isSafeReferenceId } from '@/light/references'
import { isRecipeId, type LensSettings, type OutputSettings, type ParamValue, type Preset } from '@/light/scene'
import { isRecord } from './store'

export interface ReferencePreset extends Preset {
  referenceId: string
}

export type PresetCheck = { ok: true; preset: ReferencePreset } | { ok: false; message: string }

const PRESET_KEYS = ['id', 'referenceId', 'scene']
const SCENE_KEYS = ['recipe', 'seed', 'colors', 'params', 'lens', 'output']

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isParamValue(value: unknown): value is ParamValue {
  return isFiniteNumber(value) || typeof value === 'boolean' || (Array.isArray(value) && value.every(isFiniteNumber))
}

function isSettingValue(value: unknown): value is number | string {
  return isFiniteNumber(value) || (typeof value === 'string' && isHex(value))
}

/** Lens settings also take lists: bloomLevels (numbers) and bloomLevelTints (hexes). */
function isLensValue(value: unknown): boolean {
  if (isSettingValue(value)) return true
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every(isFiniteNumber) || value.every((item) => typeof item === 'string' && isHex(item))
}

function unknownKey(record: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(record).find((key) => !allowed.includes(key))
}

function badKey(record: Record<string, unknown>, valid: (value: unknown) => boolean): string | undefined {
  return Object.keys(record).find((key) => !valid(record[key]))
}

/**
 * Checks a reference preset posted by the lab. On success the preset is
 * rebuilt in the shared key order (id, referenceId, scene{recipe, seed,
 * colors, params, lens, output}); values are kept exactly as given.
 */
export function validatePreset(body: unknown, knownIds: ReadonlySet<string>): PresetCheck {
  const fail = (message: string): PresetCheck => ({ ok: false, message })
  if (!isRecord(body)) return fail('The preset must be a JSON object.')
  const extra = unknownKey(body, PRESET_KEYS)
  if (extra !== undefined) return fail(`Unknown preset field "${extra}".`)
  const { id, referenceId, scene } = body
  if (typeof referenceId !== 'string' || !isSafeReferenceId(referenceId) || !knownIds.has(referenceId)) {
    return fail(`Unknown reference id: ${JSON.stringify(referenceId) ?? 'missing'}.`)
  }
  if (typeof id !== 'string' || id === '') return fail('id must be a non-empty string.')
  if (!isRecord(scene)) return fail('scene must be an object.')
  const extraScene = unknownKey(scene, SCENE_KEYS)
  if (extraScene !== undefined) return fail(`Unknown scene field "${extraScene}".`)

  const { recipe, seed, colors, params, lens, output } = scene
  if (typeof recipe !== 'string' || !isRecipeId(recipe)) return fail(`Unknown recipe: ${JSON.stringify(recipe) ?? 'missing'}.`)
  if (!isFiniteNumber(seed)) return fail('seed must be a finite number.')
  if (!Array.isArray(colors) || !colors.every((color): color is string => typeof color === 'string' && isHex(color))) {
    return fail('colors must be a list of hex colors such as "#0064E0".')
  }
  if (!isRecord(params)) return fail('params must be an object.')
  const badParam = badKey(params, isParamValue)
  if (badParam !== undefined) return fail(`params.${badParam} must be a number, true or false, or a list of numbers.`)
  if (!isRecord(lens)) return fail('lens must be an object.')
  const badLens = badKey(lens, isLensValue)
  if (badLens !== undefined) return fail(`lens.${badLens} must be a number, a hex color, or a list of numbers or hex colors.`)
  if (!isRecord(output)) return fail('output must be an object.')
  const badOutput = badKey(output, isSettingValue)
  if (badOutput !== undefined) return fail(`output.${badOutput} must be a number or a hex color.`)

  return {
    ok: true,
    preset: {
      id,
      referenceId,
      scene: {
        recipe,
        seed,
        colors,
        params: params as Record<string, ParamValue>,
        lens: lens as Partial<LensSettings>,
        output: output as Partial<OutputSettings>,
      },
    },
  }
}
