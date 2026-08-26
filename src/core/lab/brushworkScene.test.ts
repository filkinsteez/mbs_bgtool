import { describe, expect, it } from 'vitest'
import { resolveLookColorPlan } from './colorDirection'
import { resolveCompositionPlan } from './compositionPlan'
import { resolveBrushworkColorIndex } from './brushworkRender'
import {
  brushworkPressureAt,
  brushworkQuietAt,
  buildBrushworkScene,
  deformBrushworkStroke,
} from './brushworkScene'

const SEED = 0x05eed123
const ASPECT = 16 / 9

function plan(complexity: number) {
  return resolveCompositionPlan({
    seed: SEED,
    lookId: 'brushwork',
    complexity,
    aspect: ASPECT,
  })
}

function scene(complexity: number) {
  return buildBrushworkScene({
    seed: SEED,
    complexity,
    aspect: ASPECT,
    composition: plan(complexity),
  })
}

describe('Brushwork stroke scene', () => {
  it('is deterministic and changes with the recipe seed', () => {
    const first = scene(0.5)
    expect(scene(0.5)).toEqual(first)
    expect(buildBrushworkScene({
      seed: SEED + 1,
      complexity: 0.5,
      aspect: ASPECT,
      composition: resolveCompositionPlan({
        seed: SEED + 1,
        lookId: 'brushwork',
        complexity: 0.5,
        aspect: ASPECT,
      }),
    })).not.toEqual(first)
  })

  it('reveals stable hero, support, and filler identities across Complexity', () => {
    const low = scene(0.15)
    const mid = scene(0.5)
    const high = scene(0.85)
    const lowIds = low.strokes.map((stroke) => stroke.id)
    const midIds = new Set(mid.strokes.map((stroke) => stroke.id))
    const highById = new Map(high.strokes.map((stroke) => [stroke.id, stroke]))

    expect(low.catalogSize).toBe(44)
    expect(low.strokes.length).toBeLessThan(mid.strokes.length)
    expect(mid.strokes.length).toBeLessThan(high.strokes.length)
    expect(low.strokes.filter((stroke) => stroke.role === 'hero')).toHaveLength(2)
    expect(high.strokes.some((stroke) => stroke.role === 'support')).toBe(true)
    expect(high.strokes.some((stroke) => stroke.role === 'filler')).toBe(true)
    for (const id of lowIds) {
      expect(midIds.has(id)).toBe(true)
      expect(highById.get(id)).toEqual(low.strokes.find((stroke) => stroke.id === id))
    }
  })

  it('keeps Brushwork anchors, quiet space, and rhythm stable across Complexity', () => {
    const low = plan(0.15)
    const high = plan(0.85)
    expect(high.anchors).toEqual(low.anchors)
    expect(high.quietShapes).toEqual(low.quietShapes)
    expect(high.rhythm).toEqual(low.rhythm)
    expect(high.scales.micro).toBeLessThan(low.scales.micro)
  })

  it('uses anchors while keeping stroke centers out of planned quiet shapes', () => {
    const composition = plan(0.85)
    const high = scene(0.85)
    for (const stroke of high.strokes) {
      expect(stroke.anchorIndex).toBeLessThan(composition.anchors.length)
      expect(brushworkQuietAt(composition, stroke.center.x, stroke.center.y)).toBeLessThan(0.45)
    }
    const primaryHero = high.strokes.find((stroke) => stroke.id === 1000)
    expect(primaryHero?.center).toEqual({
      x: composition.anchors[0].x,
      y: composition.anchors[0].y,
    })
  })

  it('gives broad strokes an early pressure load and a long asymmetric taper', () => {
    const hero = scene(0.15).strokes.find((stroke) => stroke.role === 'hero')
    expect(hero).toBeDefined()
    const pressure = hero!.pressure
    expect(pressure.peakAt).toBeLessThan(0.4)
    expect(brushworkPressureAt(pressure, pressure.peakAt)).toBeCloseTo(pressure.peak)
    expect(brushworkPressureAt(pressure, 0.25)).toBeGreaterThan(
      brushworkPressureAt(pressure, 0.75),
    )
    expect(brushworkPressureAt(pressure, 1)).toBeCloseTo(pressure.end)
  })

  it('builds fixed broken bristle topology from approved palette roles', () => {
    const high = scene(0.85)
    const roles = new Set(high.strokes.map((stroke) => stroke.colorRole))
    expect([...roles].every((role) =>
      ['dominant', 'support', 'accent', 'ink'].includes(role))).toBe(true)
    expect(high.strokes.every((stroke) => stroke.bristles.length >= 4)).toBe(true)
    expect(high.strokes.some((stroke) =>
      stroke.bristles.some((bristle) =>
        bristle.active.some(Boolean) && bristle.active.some((active) => !active)))).toBe(true)
  })

  it('maps every stroke through approved color-plan roles and avoids the ground', () => {
    const colorPlan = resolveLookColorPlan({
      mix: [
        { color: '#060F2C', weight: 10, enabled: true },
        { color: '#0064E0', weight: 40, enabled: true },
        { color: '#FF5001', weight: 30, enabled: true },
        { color: '#FFFFFF', weight: 20, enabled: true },
      ],
      ground: '#060F2C',
      ink: '#FFFFFF',
      lookId: 'brushwork',
      complexity: 0.85,
    })
    const palette = colorPlan.swatches.map((swatch) => swatch.hex)
    const approvedRoles = new Set([
      colorPlan.roles.dominant,
      ...colorPlan.roles.support,
      colorPlan.roles.accent,
      colorPlan.roles.ink,
    ])
    for (const stroke of scene(0.85).strokes) {
      const index = resolveBrushworkColorIndex(stroke, palette, colorPlan)
      expect(approvedRoles.has(index)).toBe(true)
      expect(index).not.toBe(colorPlan.roles.ground)
    }
  })

  it('deforms a fixed topology on an exactly closed motion loop', () => {
    const high = scene(0.85)
    const stroke = high.strokes.find((candidate) => candidate.role === 'hero')!
    const start = deformBrushworkStroke(stroke, 0, 0.8, ASPECT)
    const quarter = deformBrushworkStroke(stroke, 0.25, 0.8, ASPECT)
    const end = deformBrushworkStroke(stroke, 1, 0.8, ASPECT)

    expect(end).toEqual(start)
    expect(quarter).not.toEqual(start)
    expect(quarter).toHaveLength(stroke.points.length)
    expect(stroke.bristles.every((bristle) =>
      bristle.active.length === stroke.points.length - 1)).toBe(true)
  })
})
