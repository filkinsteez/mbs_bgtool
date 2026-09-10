import { describe, it, expect } from 'vitest'
import { applyBrushSegment, artworkBrushPoint, decodeDeformation, DEFORMATION_SIZE, emptyDeformation, encodeDeformation, normalizeDeformation } from './deformation'
import { useBackgroundStore, backgroundHistory } from '@/features/background-generator/store'
import { createDefaultBackgroundRecipe, deserializeBackgroundRecipe } from '@/features/background-generator/recipe'

const dab = { from: { x: 0.4, y: 0.5 }, to: { x: 0.6, y: 0.5 }, radius: 0.24, strength: 0.8, mode: 'push' as const, aspect: 16 / 9 }
const idx = (x: number, y: number) => (Math.floor(y * DEFORMATION_SIZE) * DEFORMATION_SIZE + Math.floor(x * DEFORMATION_SIZE)) * 2

describe('distortion brush', () => {
  it('pulls the source opposite the drag, leaves distant pixels untouched, and does not mutate its input', () => {
    const original = emptyDeformation()
    const painted = applyBrushSegment(original, dab)
    expect(painted[idx(0.58, 0.5)]).toBeLessThan(-0.02)
    expect(painted[idx(0.58, 0.5) + 1]).toBe(0)
    expect(painted[idx(0.1, 0.1)]).toBe(0)
    expect(original.every((n) => n === 0)).toBe(true)
  })
  it('round-trips an empty field exactly and a painted field to sub-pixel precision at 4K', () => {
    expect(decodeDeformation(encodeDeformation(emptyDeformation())).every((n) => n === 0)).toBe(true)
    const field = applyBrushSegment(emptyDeformation(), dab)
    const restored = decodeDeformation(encodeDeformation(field))
    for (let i = 0; i < field.length; i++) expect(Math.abs(restored[i] - field[i]) * 3840).toBeLessThan(0.13)
  })
  it('smoothly reduces existing distortion with Restore', () => {
    const field = applyBrushSegment(emptyDeformation(), dab)
    const restored = applyBrushSegment(field, { ...dab, from: dab.to, mode: 'restore' })
    expect(Math.abs(restored[idx(0.58, 0.5)])).toBeLessThan(Math.abs(field[idx(0.58, 0.5)]))
  })
  it('supports opposite twirl and inflate directions', () => {
    for (const mode of ['twirl', 'inflate'] as const) {
      const a = applyBrushSegment(emptyDeformation(), { ...dab, mode, from: dab.to })
      const b = applyBrushSegment(emptyDeformation(), { ...dab, mode, from: dab.to, reverse: true })
      const i = mode === 'twirl' ? idx(0.62, 0.5) + 1 : idx(0.62, 0.5)
      expect(a[i] * b[i]).toBeLessThan(0)
    }
  })
  it('rejects malformed and oversized saved maps', () => {
    expect(normalizeDeformation({ version: 1, data: 'oops' })).toBeUndefined()
    expect(normalizeDeformation({ version: 99, data: encodeDeformation(emptyDeformation()).data })).toBeUndefined()
    expect(normalizeDeformation({ version: 1, data: '$'.repeat(196608) })).toBeUndefined()
  })
  it('maps the cursor through translated, scaled, and rotated artwork', () => {
    const t = { x: 0.15, y: -0.2, scale: 1.7, rotation: 37 }
    const p = { x: 0.32, y: 0.61 }, aspect = 16 / 9, angle = t.rotation * Math.PI / 180
    const x = (p.x - 0.5) * t.scale, y = (p.y - 0.5) * t.scale
    const screenX = x * Math.cos(angle) - y / aspect * Math.sin(angle) + 0.5 + t.x * 0.5
    const screenY = x * aspect * Math.sin(angle) + y * Math.cos(angle) + 0.5 + t.y * 0.5
    const result = artworkBrushPoint(screenX, screenY, aspect, t)
    expect(result.x).toBeCloseTo(p.x, 10)
    expect(result.y).toBeCloseTo(p.y, 10)
  })
  it('commits a stroke as one undo entry, restores it with redo, and preserves it through serialization', () => {
    const recipe = createDefaultBackgroundRecipe(47)
    recipe.look.version = 'gradients'; recipe.look.id = 'halo'
    const store = useBackgroundStore.getState()
    store.replaceRecipe(recipe)
    store.beginTransaction()
    let field = emptyDeformation()
    for (let i = 0; i < 4; i++) {
      field = applyBrushSegment(field, dab)
      store.setTransient({ look: { deformation: encodeDeformation(field) } })
    }
    store.commitTransaction()
    expect(backgroundHistory.depth.past).toBe(1)
    const painted = useBackgroundStore.getState().recipe
    expect(deserializeBackgroundRecipe(JSON.stringify(painted))!.look.deformation).toEqual(painted.look.deformation)
    store.undo()
    expect(useBackgroundStore.getState().recipe.look.deformation).toBeUndefined()
    store.redo()
    expect(useBackgroundStore.getState().recipe.look.deformation).toEqual(painted.look.deformation)
  })
})
