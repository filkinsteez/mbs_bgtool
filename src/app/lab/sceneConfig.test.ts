import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { coerceParam, resolveScene } from '@/light/engine/resolve'
import { RECIPE_LIST, getRecipe } from '@/light/recipes'
import type { DialConfig } from 'dialkit'
import type { Preset, Scene } from '@/light/scene'
import { configDefaults, nestValues, presetToSave, sceneDialConfig, sceneFromValues, VALUE_STEP } from './sceneConfig'

const PRESET_DIR = fileURLToPath(new URL('../../light/presets/references/', import.meta.url))

function defaultScene(recipeId: Scene['recipe']): Scene {
  const recipe = getRecipe(recipeId)
  return { recipe: recipe.id, seed: 1, colors: [...recipe.defaultColors], params: {}, lens: {}, output: {} }
}

/** What DialKit does to a slider value when the config changes: clamp, then round to the step. */
function roundLikeDialKit(config: DialConfig, flat: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out = { ...flat }
  for (const [key, control] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (Array.isArray(control)) {
      const [, min, max, step = 0.01] = control
      const value = Math.min(max, Math.max(min, Number(out[path])))
      const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0
      out[path] = Number((min + Math.round((value - min) / step) * step).toFixed(decimals))
    } else if (typeof control === 'object' && !('type' in control)) {
      Object.assign(out, roundLikeDialKit(control, out, path))
    }
  }
  return out
}

/** Paths where `a` and `b` differ: numbers by more than `tolerance`, anything else at all, including missing keys. */
function differences(a: unknown, b: unknown, tolerance: number, path = ''): string[] {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tolerance + 1e-12 ? [] : [`${path}: ${a} vs ${b}`]
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}: length ${a.length} vs ${b.length}`]
    return a.flatMap((item, i) => differences(item, b[i], tolerance, `${path}[${i}]`))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].flatMap((key) => differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], tolerance, `${path}.${key}`))
  }
  return a === b ? [] : [`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`]
}

describe('lab scene config', () => {
  for (const recipe of RECIPE_LIST) {
    it(`${recipe.id}: one control per param, color slot, lens and output setting`, () => {
      const config = sceneDialConfig(defaultScene(recipe.id), { colors: true })
      const params = config.params as DialConfig
      expect(Object.keys(params)).toEqual(recipe.params.map((spec) => spec.key))
      for (const spec of recipe.params) {
        const control = params[spec.key]
        switch (spec.kind) {
          case 'number':
            expect(control, spec.key).toEqual([spec.default, spec.min, spec.max, spec.step >= 1 ? spec.step : VALUE_STEP])
            break
          case 'boolean':
            expect(control, spec.key).toBe(spec.default)
            break
          case 'vector':
            expect(Object.keys(control as DialConfig), spec.key).toEqual(['x', 'y', 'z', 'w'].slice(0, spec.default.length))
            break
          default: {
            const unknown: never = spec
            throw new Error(`Unknown param kind: ${JSON.stringify(unknown)}`)
          }
        }
      }
      expect(Object.keys(config.colors as DialConfig)).toEqual(recipe.colorSlots.map((slot) => slot.key))
    })

    it(`${recipe.id}: the defaults read back as the same scene`, () => {
      const base = defaultScene(recipe.id)
      const config = sceneDialConfig(base, { colors: true })
      const scene = sceneFromValues(recipe.id, nestValues(configDefaults(config)), base)
      const resolved = resolveScene(recipe, base)
      expect(scene.params).toEqual(resolved.params)
      expect(scene.colors).toEqual(resolved.hex)
      expect(scene.lens).toEqual(resolved.lens)
      expect(scene.output).toEqual(resolved.output)
    })
  }

  const files = readdirSync(PRESET_DIR).filter((name) => name.endsWith('.json'))
  it('finds preset files', () => expect(files.length).toBeGreaterThan(0))
  for (const name of files) {
    const file = JSON.parse(readFileSync(`${PRESET_DIR}${name}`, 'utf8')) as Preset
    const config = sceneDialConfig(file.scene, { colors: true })
    // Values outside a param's range render clamped, and are saved clamped.
    const specs = getRecipe(file.scene.recipe).params
    const params = Object.fromEntries(
      Object.entries(file.scene.params).map(([key, value]) => {
        const spec = specs.find((candidate) => candidate.key === key)
        return [key, spec ? coerceParam(spec, value) : value]
      }),
    )
    const expected = { ...file, scene: { ...file.scene, params } }

    it(`${name}: saves back unchanged`, () => {
      const values = nestValues(configDefaults(config))
      expect(presetToSave(file, sceneFromValues(file.scene.recipe, values, file.scene))).toEqual(expected)
    })

    it(`${name}: after DialKit rounds the sliders, saves no value further off than half a slider step`, () => {
      const values = nestValues(roundLikeDialKit(config, configDefaults(config)))
      expect(differences(presetToSave(file, sceneFromValues(file.scene.recipe, values, file.scene)), expected, VALUE_STEP / 2)).toEqual([])
    })
  }
})
