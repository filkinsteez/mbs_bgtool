import { describe, expect, it } from 'vitest'
import {
  defaultPresetName,
  parseLookPreset,
  presetFilename,
  serializeLookPreset,
} from './lookPreset'
import {
  canonicalizeFormat,
  constrainBackgroundTransform,
  createDefaultBackgroundRecipe,
} from './recipe'
import { mergeDeep } from '@/core/state/store'

function tweakedRecipe() {
  return mergeDeep(createDefaultBackgroundRecipe(4242), {
    gradientState: {
      presetId: 'fine-smear',
      controls: { detail: 0.72, blend: 0.32, distortion: 0.4, position: 0.64 },
      orientation: 90,
    },
    transforms: {
      background: { preset: 'free' as const, x: 0.12, y: -0.3, scale: 1.4, rotation: 17 },
    },
    paletteState: {
      packId: 'elemental',
      elementalAccent: '#410840',
      boundaries: [82, 91],
    },
  })
}

describe('look presets', () => {
  it('round-trips the full recipe through the envelope', () => {
    const recipe = tweakedRecipe()
    const json = serializeLookPreset(recipe, 'background', 'Studio teal')
    const parsed = parseLookPreset(json)
    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe('Studio teal')
    expect(parsed!.recipe.seed).toBe(4242)
    expect(parsed!.recipe.look).toMatchObject({
      id: 'smear',
      version: 'gradients',
      detail: 0.72,
      gradient: { orientation: 90 },
    })
    // The deserializer applies the same cover constraint live dragging
    // does, so the round-trip preserves exactly what the app allows.
    const format = canonicalizeFormat(recipe.format)
    expect(parsed!.recipe.transforms.background).toEqual(
      constrainBackgroundTransform(
        recipe.transforms.background,
        format.width,
        format.height,
      ),
    )
    expect(parsed!.recipe.transforms.background.rotation).toBe(17)
    expect(parsed!.recipe.palette).toMatchObject({
      packId: 'elemental',
      ink: '#0064E0',
      ground: '#410840',
    })
    expect(parsed!.recipe.mode).toBe('background')
  })

  it('stamps the live mode so a 3D preset reopens in the 3D tab', () => {
    const json = serializeLookPreset(createDefaultBackgroundRecipe(7), 'material', 'metal study')
    expect(parseLookPreset(json)!.recipe.mode).toBe('material')
  })

  it('rejects non-preset payloads', () => {
    expect(parseLookPreset('not json')).toBeNull()
    expect(parseLookPreset('{"kind":"other-thing","presetVersion":1}')).toBeNull()
    expect(parseLookPreset(JSON.stringify({
      kind: 'mbs-look-preset', presetVersion: 1, name: 'x', recipe: { hello: true },
    }))).toBeNull()
  })

  it('accepts a bare serialized recipe (the autosave shape)', () => {
    const parsed = parseLookPreset(JSON.stringify(createDefaultBackgroundRecipe(99)))
    expect(parsed).not.toBeNull()
    expect(parsed!.recipe.seed).toBe(99)
  })

  it('derives the Look from semantic state instead of stale render fields', () => {
    const recipe = createDefaultBackgroundRecipe(5)
    const raw = JSON.parse(serializeLookPreset(recipe, 'background', 'stale')) as {
      recipe: { look: { id: string; version: string } }
    }
    raw.recipe.look = { id: 'discontinued-look', version: 'v4' }
    const parsed = parseLookPreset(JSON.stringify(raw))
    expect(parsed).not.toBeNull()
    expect(parsed!.recipe.look.version).toBe('gradients')
    expect(parsed!.recipe.look.id).toBe('diffusion')
  })

  it('derives names and safe filenames', () => {
    const recipe = createDefaultBackgroundRecipe(3)
    expect(defaultPresetName(recipe, 'background')).toContain(String(recipe.seed))
    expect(presetFilename('Studio Teal #2!')).toBe('mbs-look-studio-teal-2.json')
    expect(presetFilename('///')).toBe('mbs-look-preset.json')
  })
})
