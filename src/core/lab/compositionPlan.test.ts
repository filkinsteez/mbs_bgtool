import { describe, expect, it } from 'vitest'
import { resolveCompositionPlan } from './compositionPlan'

describe('composition plan', () => {
  it('is deterministic and uses Look-specific visual grammars', () => {
    const input = { seed: 1913, lookId: 'streams', complexity: 0.5, aspect: 16 / 9 }
    expect(resolveCompositionPlan(input)).toEqual(resolveCompositionPlan(input))
    expect(resolveCompositionPlan(input)).not.toEqual(resolveCompositionPlan({
      ...input,
      lookId: 'quilt',
    }))
  })

  it('keeps macro identity while complexity adds hierarchy', () => {
    const low = resolveCompositionPlan({
      seed: 0x05eed123,
      lookId: 'marks',
      complexity: 0.15,
      aspect: 4 / 5,
    })
    const high = resolveCompositionPlan({
      seed: 0x05eed123,
      lookId: 'marks',
      complexity: 0.85,
      aspect: 4 / 5,
    })

    expect(high.archetype).toBe(low.archetype)
    expect(high.edgePolicy).toBe(low.edgePolicy)
    expect(high.anchors[0]).toEqual(low.anchors[0])
    expect(high.scales.motif).toBeLessThan(low.scales.motif)
    expect(high.anchors.length).toBeGreaterThan(low.anchors.length)
  })

  it('creates bounded focal, quiet-space, and rhythm decisions', () => {
    const plan = resolveCompositionPlan({
      seed: 0x31ced00d,
      lookId: 'scanlines',
      complexity: 0.82,
      aspect: 9 / 16,
    })
    expect(plan.anchors.length).toBeGreaterThanOrEqual(2)
    expect(plan.quietShapes.length).toBeGreaterThanOrEqual(1)
    expect(plan.rhythm.pattern).toHaveLength(plan.rhythm.steps)
    expect(plan.rhythm.pattern.filter(Boolean)).toHaveLength(plan.rhythm.pulses)
    expect(plan.field.warp).toBeGreaterThan(0)
  })
})
