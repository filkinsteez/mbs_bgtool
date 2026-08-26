import { describe, expect, it } from 'vitest'
import {
  distinctColorIndex,
  resolveLookColorPlan,
  weightedColorIndex,
} from './colorDirection'

const MIX = [
  { color: '#0064E0', weight: 60, enabled: true },
  { color: '#00D1FF', weight: 20, enabled: true },
  { color: '#FFD600', weight: 20, enabled: true },
]

describe('Look color direction', () => {
  it('keeps unique approved swatches and their independent weights', () => {
    const plan = resolveLookColorPlan({
      mix: MIX,
      ground: '#FFD600',
      ink: '#0064E0',
      lookId: 'quilt',
      complexity: 0.5,
    })
    expect(plan.swatches.map((swatch) => swatch.hex)).toEqual([
      '#0064E0',
      '#00D1FF',
      '#FFD600',
    ])
    expect(plan.swatches.map((swatch) => swatch.weight)).toEqual([0.6, 0.2, 0.2])
    expect(plan.roles.dominant).toBe(0)
    expect(plan.roles.ground).toBe(2)
    expect(plan.roles.ink).toBe(0)
  })

  it('uses weighted selection without duplicating palette entries', () => {
    const plan = resolveLookColorPlan({
      mix: MIX,
      ground: '#FFD600',
      ink: '#0064E0',
      lookId: 'pixels',
      complexity: 0.8,
    })
    expect(weightedColorIndex(plan, 0.59)).toBe(0)
    expect(weightedColorIndex(plan, 0.61)).toBe(1)
    expect(weightedColorIndex(plan, 0.81)).toBe(2)
  })

  it('never selects the same color for a required contrasting pair', () => {
    const plan = resolveLookColorPlan({
      mix: MIX,
      ground: '#FFD600',
      ink: '#0064E0',
      lookId: 'beads',
      complexity: 0.5,
    })
    for (let base = 0; base < plan.swatches.length; base += 1) {
      expect(distinctColorIndex(plan, base, 0.2)).not.toBe(base)
      expect(distinctColorIndex(plan, base, 0.9)).not.toBe(base)
    }
  })
})
