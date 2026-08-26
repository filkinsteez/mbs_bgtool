import { describe, expect, it } from 'vitest'
import { resolveLookColorPlan } from './colorDirection'
import { resolveCompositionPlan } from './compositionPlan'
import { clearTrailPlanCache, getCachedTrailPlan } from './renderTrails'
import {
  animatedTrailPathPoints,
  buildTrailPlan,
  normalizeTrailPhase,
  resolveTrailColorIndices,
  trailQuietFraction,
  type TrailPlanInput,
} from './trails'
import type { MotionState } from './types'

const input = (
  complexity: number,
  seed = 1913,
  width = 1600,
  height = 900,
): TrailPlanInput => ({
  seed,
  width,
  height,
  complexity,
  composition: resolveCompositionPlan({
    seed,
    lookId: 'trails',
    complexity,
    aspect: width / height,
  }),
})

function pointPairs(points: Float32Array): string[] {
  const pairs: string[] = []
  for (let index = 0; index < points.length; index += 2) {
    pairs.push(`${points[index]},${points[index + 1]}`)
  }
  return pairs
}

describe('persistent Trails geometry', () => {
  it('is deterministic per recipe and cached independently of motion', () => {
    const options = input(0.5)
    expect(buildTrailPlan(options)).toEqual(buildTrailPlan(options))
    expect(buildTrailPlan(options)).not.toEqual(buildTrailPlan(input(0.5, 42)))

    clearTrailPlanCache()
    const first = getCachedTrailPlan(options)
    expect(getCachedTrailPlan(options)).toBe(first)
    expect(getCachedTrailPlan(input(0.85))).not.toBe(first)
  })

  it('keeps the complete family grammar at low complexity', () => {
    const low = buildTrailPlan(input(0.15))
    const high = buildTrailPlan(input(0.85))
    const lowMain = low.families.filter((family) => family.parentFamilyId === null)
    const highMain = high.families.filter((family) => family.parentFamilyId === null)

    expect(lowMain.filter((family) => family.tier === 'hero')).toHaveLength(2)
    expect(lowMain.filter((family) => family.tier === 'support').length).toBeGreaterThanOrEqual(2)
    expect(low.families.some((family) => family.parentFamilyId !== null)).toBe(true)
    expect(low.crossings.length).toBeGreaterThanOrEqual(1)
    expect(low.paths.filter((path) => path.breaks.length > 0).length).toBeGreaterThanOrEqual(1)
    expect(high.paths.length).toBeGreaterThan(low.paths.length)
    expect(highMain.length).toBeGreaterThan(lowMain.length)
    expect(highMain.slice(0, lowMain.length).map(({ id, tier, colorSlot }) => ({
      id,
      tier,
      colorSlot,
    }))).toEqual(lowMain.map(({ id, tier, colorSlot }) => ({ id, tier, colorSlot })))

    for (const path of low.paths.filter((path) => path.tier === 'hero' && path.primary)) {
      expect(path.length).toBeGreaterThan(Math.min(low.width, low.height) * 1.15)
    }
    expect(trailQuietFraction(low)).toBeGreaterThan(0.34)
    expect(trailQuietFraction(high)).toBeGreaterThan(0.24)
  })

  it('attaches every branch to a parent and preserves lineage color', () => {
    const plan = buildTrailPlan(input(0.85))
    const branchPaths = plan.paths.filter((path) => path.parentId !== null)
    expect(branchPaths.length).toBeGreaterThanOrEqual(3)

    for (const branch of branchPaths) {
      const parent = plan.paths[branch.parentId!]
      const parentPoints = new Set(pointPairs(parent.points))
      expect(parentPoints.has(`${branch.points[0]},${branch.points[1]}`)).toBe(true)
      const family = plan.families[branch.familyId]
      const parentFamily = plan.families[family.parentFamilyId!]
      expect(family.colorSlot).toBe(parentFamily.colorSlot)
    }
  })

  it('records valid under-path gaps for deliberate crossings', () => {
    const plan = buildTrailPlan(input(0.85))
    expect(plan.crossings.length).toBeGreaterThanOrEqual(2)
    for (const crossing of plan.crossings) {
      const under = plan.paths[crossing.underPathId]
      expect(under.breaks.some((gap) =>
        crossing.underPointIndex >= gap.from && crossing.underPointIndex <= gap.to)).toBe(true)
      expect(crossing.overPointIndex).toBeGreaterThanOrEqual(0)
      expect(crossing.overPointIndex).toBeLessThan(
        plan.paths[crossing.overPathId].points.length / 2,
      )
    }
  })

  it('uses an analytic exact loop without changing topology', () => {
    const plan = buildTrailPlan(input(0.7))
    const motion = (phase: number): MotionState => ({
      enabled: true,
      amount: 0.8,
      speed: 1.37,
      loopSeconds: 8,
      frame: { phase },
    })
    expect(normalizeTrailPhase(1)).toBe(0)
    expect(normalizeTrailPhase(-0.25)).toBe(0.75)

    const start = plan.paths.map((path) => animatedTrailPathPoints(plan, path, motion(0)))
    const quarter = plan.paths.map((path) => animatedTrailPathPoints(plan, path, motion(0.25)))
    const end = plan.paths.map((path) => animatedTrailPathPoints(plan, path, motion(1)))
    expect(end).toEqual(start)
    expect(quarter[0]).not.toEqual(start[0])
    expect(end.map((points) => points.length)).toEqual(
      plan.paths.map((path) => path.points.length),
    )

    for (const branch of plan.paths.filter((path) => path.parentId !== null)) {
      const branchAnimated = start[branch.id]
      const parentAnimated = new Set(pointPairs(start[branch.parentId!]))
      expect(parentAnimated.has(`${branchAnimated[0]},${branchAnimated[1]}`)).toBe(true)
    }
  })

  it('deals family colors only from the approved local palette lineage', () => {
    const geometry = buildTrailPlan(input(0.85))
    const colors = resolveLookColorPlan({
      mix: [
        { color: '#0064E0', weight: 55, enabled: true },
        { color: '#0288F9', weight: 25, enabled: true },
        { color: '#FF5001', weight: 15, enabled: true },
        { color: '#FFFFFF', weight: 5, enabled: true },
      ],
      ground: '#FFFFFF',
      ink: '#0064E0',
      lookId: 'trails',
      complexity: 0.85,
    })
    const indices = resolveTrailColorIndices(colors, colors.swatches.length, geometry.families)
    expect(new Set(indices).size).toBeLessThanOrEqual(colors.localColorLimit)
    expect(indices.every((index) => index >= 0 && index < colors.swatches.length)).toBe(true)
    expect(indices).not.toContain(colors.roles.ground)
    for (const family of geometry.families) {
      if (family.parentFamilyId === null) continue
      expect(indices[family.id]).toBe(indices[family.parentFamilyId])
    }
  })
})
