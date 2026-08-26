import { describe, expect, it } from 'vitest'
import { resolveLookColorPlan } from './colorDirection'
import {
  buildFrameTopology,
  frameCompositionAt,
  pointInFrameQuietZone,
} from './frameComposition'
import { buildMetaSymbolField } from './territory'
import type { CurveSnapshot } from './types'

const META_SNAPSHOT: CurveSnapshot = {
  frequencyX: 1,
  frequencyY: 2,
  phase: 0,
  amplitudeX: 1,
  amplitudeY: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  curve: 'meta',
  silhouette: 'meta-symbol',
}

const COLORS = ['#111111', '#0064E0', '#2DC9E5', '#7C3AED', '#FF5001', '#FFFFFF']

function fixture(width: number, height: number, seed = 1913, complexity = 0.75) {
  const colorPlan = resolveLookColorPlan({
    mix: COLORS.map((color) => ({ color, enabled: true, weight: 1 })),
    ground: COLORS[0],
    ink: COLORS[5],
    lookId: 'frame',
    complexity,
  })
  return buildFrameTopology({
    field: buildMetaSymbolField(META_SNAPSHOT, width, height, 0.3),
    width,
    height,
    seed,
    complexity,
    paletteSize: COLORS.length,
    colorPlan,
  })
}

describe('Frame composition', () => {
  it('builds interrupted hero/support rails with coarse and fine block groups', () => {
    const topology = fixture(960, 540)
    const roles = new Set(topology.rails.map((rail) => rail.role))
    const kinds = new Set(topology.blocks.map((block) => block.kind))
    const widths = new Set(topology.rails.map((rail) => rail.width.toFixed(3)))
    const runsByPath = new Map<string, number>()

    for (const rail of topology.rails) {
      const path = rail.id.split('-').slice(0, 3).join('-')
      runsByPath.set(path, (runsByPath.get(path) ?? 0) + 1)
      expect(rail.points.length).toBeGreaterThan(1)
    }

    expect(roles).toEqual(new Set(['hero', 'support', 'fine']))
    expect(kinds).toEqual(new Set(['coarse', 'fine', 'tab']))
    expect(widths.size).toBeGreaterThan(5)
    expect(Math.max(...runsByPath.values())).toBeGreaterThan(3)
    expect(topology.blocks.filter((block) => block.kind === 'coarse').length).toBeGreaterThan(4)
    expect(topology.blocks.filter((block) => block.kind === 'fine').length).toBeGreaterThan(15)
  })

  it('reserves a shared quiet aperture across the nested rails', () => {
    const topology = fixture(960, 540, 42, 0.5)
    let checkedSegments = 0
    for (const rail of topology.rails) {
      for (let index = 1; index < rail.points.length; index += 1) {
        const midpoint = {
          x: (rail.points[index - 1].x + rail.points[index].x) / 2,
          y: (rail.points[index - 1].y + rail.points[index].y) / 2,
        }
        expect(pointInFrameQuietZone(midpoint, topology.quietZone, 0.82)).toBe(false)
        checkedSegments += 1
      }
    }
    expect(checkedSegments).toBeGreaterThan(100)
  })

  it('turns portrait into a tall composition instead of a centered landscape badge', () => {
    const topology = fixture(675, 1200, 8675309, 0.5)
    const points = topology.rails.flatMap((rail) => rail.points)
    const width = Math.max(...points.map((point) => point.x))
      - Math.min(...points.map((point) => point.x))
    const height = Math.max(...points.map((point) => point.y))
      - Math.min(...points.map((point) => point.y))

    expect(topology.aspect).toBe('portrait')
    expect(topology.portraitCoverage).toBeCloseTo(675 / 1200, 6)
    expect(width / topology.width).toBeGreaterThan(0.75)
    expect(height / topology.height).toBeGreaterThan(0.62)
  })

  it('limits paint colors to assigned roles and caps accent area', () => {
    const complexity = 0.15
    const topology = fixture(960, 540, 1913, complexity)
    const plan = resolveLookColorPlan({
      mix: COLORS.map((color) => ({ color, enabled: true, weight: 1 })),
      ground: COLORS[0],
      ink: COLORS[5],
      lookId: 'frame',
      complexity,
    })

    expect(topology.paletteIndices.length).toBeLessThanOrEqual(plan.localColorLimit)
    expect(topology.paletteIndices).not.toContain(plan.roles.ground)
    expect(topology.accentAreaFraction).toBeLessThanOrEqual(plan.accentAreaLimit)
  })

  it('moves a fixed topology and closes the loop exactly', () => {
    const topology = fixture(960, 540, 420, 0.85)
    const start = frameCompositionAt(topology, { phase: 0, amount: 0.8, speed: 1.4 })
    const quarter = frameCompositionAt(topology, { phase: 0.25, amount: 0.8, speed: 1.4 })
    const end = frameCompositionAt(topology, { phase: 1, amount: 0.8, speed: 1.4 })
    const signature = (composition: typeof start) => ({
      rails: composition.rails.map((rail) => [rail.id, rail.points.length]),
      blocks: composition.blocks.map((block) => block.id),
    })

    expect(signature(quarter)).toEqual(signature(start))
    expect(end).toEqual(start)
    expect(quarter.rails[0].points).not.toEqual(start.rails[0].points)
    expect(quarter.blocks).not.toEqual(start.blocks)
  })

  it('is deterministic per seed while retaining deliberate seed variation', () => {
    const first = fixture(800, 800, 42, 0.5)
    const repeated = fixture(800, 800, 42, 0.5)
    const variant = fixture(800, 800, 1913, 0.5)

    expect(repeated).toEqual(first)
    expect(variant.quietZone).not.toEqual(first.quietZone)
    expect(variant.blocks.map((block) => [block.x, block.y]))
      .not.toEqual(first.blocks.map((block) => [block.x, block.y]))
  })
})
