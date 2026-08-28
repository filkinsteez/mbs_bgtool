import { describe, expect, it } from 'vitest'
import { resolveLookColorPlan } from './colorDirection'
import { resolveCompositionPlan, type CompositionPlan } from './compositionPlan'
import {
  buildQuiltPlan,
  resolveQuiltMotion,
  type BuildQuiltPlanOptions,
  type QuiltPlan,
} from './quilt'
import { META_CURVE } from './territory'

const palette = ['#0064E0', '#0288F9', '#2DC9E5', '#4F43FF', '#FF5001', '#132682']
const colorPlan = resolveLookColorPlan({
  mix: palette.map((color, index) => ({
    color,
    enabled: true,
    weight: index === 0 ? 50 : 10,
  })),
  ground: palette.at(-1)!,
  ink: palette[0],
  lookId: 'quilt',
  complexity: 0.5,
})

function options(overrides: Partial<BuildQuiltPlanOptions> = {}): BuildQuiltPlanOptions {
  const width = overrides.width ?? 1600
  const height = overrides.height ?? 900
  const complexity = overrides.complexity ?? 0.5
  return {
    width,
    height,
    seed: 1913,
    complexity,
    paletteSize: palette.length,
    colorPlan,
    composition: resolveCompositionPlan({
      seed: overrides.seed ?? 1913,
      lookId: 'quilt',
      complexity,
      aspect: width / height,
    }),
    curve: { ...META_CURVE, amplitudeX: 1, amplitudeY: 1, silhouette: 'meta-symbol' },
    ...overrides,
  }
}

function topology(plan: QuiltPlan) {
  return {
    patches: plan.patches.map((patch) => ({
      id: patch.id,
      depth: patch.depth,
      regionId: patch.regionId,
      family: patch.family,
      rect: patch.rect,
      baseColor: patch.baseColor,
      pieces: patch.pieces,
      pieceSeams: patch.pieceSeams,
      inset: patch.inset,
    })),
    constructionSeams: plan.constructionSeams,
  }
}

describe('Quilt plan', () => {
  it('is deterministic and seed-addressed', () => {
    const first = buildQuiltPlan(options())
    const second = buildQuiltPlan(options())
    const variant = buildQuiltPlan(options({ seed: 8675309 }))

    expect(second).toEqual(first)
    expect(topology(variant)).not.toEqual(topology(first))
  })

  it('keeps normalized topology identical between preview and 4K', () => {
    const composition = resolveCompositionPlan({
      seed: 42,
      lookId: 'quilt',
      complexity: 0.72,
      aspect: 16 / 9,
    })
    const preview = buildQuiltPlan(options({
      width: 1200,
      height: 675,
      seed: 42,
      complexity: 0.72,
      composition,
    }))
    const exportPlan = buildQuiltPlan(options({
      width: 3840,
      height: 2160,
      seed: 42,
      complexity: 0.72,
      composition,
    }))

    expect(topology(exportPlan)).toEqual(topology(preview))
    expect(exportPlan.frame.scaleX).toBeGreaterThan(preview.frame.scaleX)
  })

  it('uses multiple scales and adds detail with Complexity', () => {
    const low = buildQuiltPlan(options({ complexity: 0.15 }))
    const high = buildQuiltPlan(options({ complexity: 0.85 }))
    const highAreas = new Set(
      high.patches.map((patch) =>
        Math.round(patch.rect.width * patch.rect.height * 1000)),
    )

    expect(high.patches.length).toBeGreaterThan(low.patches.length)
    expect(highAreas.size).toBeGreaterThan(3)
    expect(new Set(high.patches.map((patch) => patch.family)).size).toBeGreaterThan(1)
    expect(high.constructionSeams.some((seam) => seam.level === 'major')).toBe(true)
    expect(high.constructionSeams.some((seam) => seam.level === 'minor')).toBe(true)
  })

  it('turns composition quiet zones into larger whole-cloth areas', () => {
    const composition: CompositionPlan = {
      revision: 1,
      archetype: 'lobe',
      edgePolicy: 'contained',
      latents: { energy: 0.5, openness: 0.9, directionality: 0.5, mutation: 0.5 },
      anchors: [{ x: 0.78, y: 0.5, radius: 0.2, strength: 1, angle: 0 }],
      quietShapes: [{
        x: 0.3,
        y: 0.5,
        radiusX: 0.28,
        radiusY: 0.42,
        rotation: 0,
        softness: 0.18,
      }],
      scales: { macro: 0.6, meso: 0.16, motif: 0.04, micro: 0.008 },
      rhythm: {
        steps: 7,
        pulses: 3,
        phase: 0,
        swing: 0,
        pattern: [true, false, true, false, true, false, false],
      },
      field: { angle: 0, phase: 0, frequencyA: 1, frequencyB: 2, warp: 0.3 },
    }
    const plan = buildQuiltPlan(options({ complexity: 0.85, composition }))
    const quiet = plan.patches.filter((patch) => patch.quiet > 0.62)
    const active = plan.patches.filter((patch) => patch.quiet < 0.2)
    const averageArea = (patches: typeof plan.patches) =>
      patches.reduce((sum, patch) => sum + patch.rect.width * patch.rect.height, 0)
      / Math.max(1, patches.length)

    expect(quiet.length).toBeGreaterThan(0)
    expect(active.length).toBeGreaterThan(0)
    expect(quiet.every((patch) => patch.family === 'whole-cloth')).toBe(true)
    expect(averageArea(quiet)).toBeGreaterThan(averageArea(active))
  })

  it('reserves the contrast role for sparse stitched insets', () => {
    const plan = buildQuiltPlan(options({ complexity: 0.85 }))
    const basePool = new Set([
      colorPlan.roles.dominant,
      ...colorPlan.roles.support,
      ...colorPlan.depthOrder,
    ].filter((index) =>
      index !== colorPlan.roles.ground
      && index !== colorPlan.roles.accent))
    const insets = plan.patches.filter((patch) => patch.inset)

    for (const patch of plan.patches) {
      expect(basePool.has(patch.baseColor)).toBe(true)
      for (const piece of patch.pieces) expect(basePool.has(piece.color)).toBe(true)
    }
    expect(insets.length).toBeGreaterThan(0)
    expect(insets.length).toBeLessThan(plan.patches.length / 2)
    expect(insets.every((patch) => patch.inset?.color === colorPlan.roles.accent)).toBe(true)
  })

  it('uses both material colors when only two swatches are available', () => {
    const materialPalette = ['#0064E0', '#FFFFFF']
    const materialPlan = resolveLookColorPlan({
      mix: [
        { color: materialPalette[0], enabled: true, weight: 72 },
        { color: materialPalette[1], enabled: true, weight: 28 },
      ],
      ground: materialPalette[0],
      ink: materialPalette[1],
      lookId: 'quilt',
      complexity: 0.5,
    })
    const plan = buildQuiltPlan(options({
      paletteSize: materialPalette.length,
      colorPlan: materialPlan,
    }))
    const colors = new Set(plan.patches.flatMap((patch) => [
      patch.baseColor,
      ...patch.pieces.map((piece) => piece.color),
    ]))

    expect(colors).toEqual(new Set([0, 1]))
  })

  it('loops stitch motion exactly without changing topology', () => {
    const start = resolveQuiltMotion(0, 0.8, 1.4)
    const quarter = resolveQuiltMotion(0.25, 0.8, 1.4)
    const end = resolveQuiltMotion(1, 0.8, 1.4)

    expect(end).toEqual(start)
    expect(quarter).not.toEqual(start)
  })
})
