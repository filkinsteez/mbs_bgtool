import { describe, expect, it } from 'vitest'
import { resolveLookColorPlan } from './colorDirection'
import { resolveCompositionPlan } from './compositionPlan'
import {
  planPixelField,
  resolvePixelGlitchFrame,
  type PixelFieldInput,
} from './pixelField'

const PALETTE = ['#0064E0', '#0288F9', '#2DC9E5', '#7C3AED', '#FF5001', '#FFFFFF']

function input(
  seed = 1913,
  complexity = 0.5,
  aspect = 16 / 9,
): PixelFieldInput {
  const colorPlan = resolveLookColorPlan({
    mix: PALETTE.map((color, index) => ({
      color,
      weight: index === 0 ? 34 : index === PALETTE.length - 1 ? 8 : 14.5,
      enabled: true,
    })),
    ground: PALETTE.at(-1)!,
    ink: PALETTE[0],
    lookId: 'pixels',
    complexity,
  })
  return {
    seed,
    complexity,
    aspect,
    paletteSize: PALETTE.length,
    colorPlan,
    composition: resolveCompositionPlan({
      seed,
      lookId: 'pixels',
      complexity,
      aspect,
    }),
  }
}

function largestConnectedRegion(mask: Uint8Array, columns: number, rows: number): number {
  const visited = new Uint8Array(mask.length)
  let largest = 0
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue
    const queue = [start]
    visited[start] = 1
    let count = 0
    for (let read = 0; read < queue.length; read += 1) {
      const index = queue[read]
      count += 1
      const column = index % columns
      const row = Math.floor(index / columns)
      for (const [x, y] of [
        [column - 1, row],
        [column + 1, row],
        [column, row - 1],
        [column, row + 1],
      ]) {
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue
        const neighbor = y * columns + x
        if (!mask[neighbor] || visited[neighbor]) continue
        visited[neighbor] = 1
        queue.push(neighbor)
      }
    }
    largest = Math.max(largest, count)
  }
  return largest
}

describe('adaptive pixel field', () => {
  it('is deterministic, seeded, and resolution-independent', () => {
    const first = planPixelField(input(1913, 0.5, 3840 / 2160))
    const repeated = planPixelField(input(1913, 0.5, 1200 / 675))
    const differentSeed = planPixelField(input(42, 0.5, 3840 / 2160))

    expect(repeated).toEqual(first)
    expect(differentSeed.tiles).not.toEqual(first.tiles)
    expect(differentSeed.quietZone).not.toEqual(first.quietZone)
  })

  it('shows macro, meso, and micro blocks at medium complexity', () => {
    for (const seed of [42, 1913, 8675309]) {
      const plan = planPixelField(input(seed, 0.5))
      const context = `seed ${seed}: ${JSON.stringify(plan.diagnostics.scaleCounts)}`
      expect(plan.diagnostics.scaleCounts.macro, context).toBeGreaterThan(0)
      expect(plan.diagnostics.scaleCounts.meso, context).toBeGreaterThan(0)
      expect(plan.diagnostics.scaleCounts.micro, context).toBeGreaterThan(0)
    }
  })

  it('builds connected macro masses instead of scattered mosaic noise', () => {
    for (const seed of [42, 1913, 8675309]) {
      const plan = planPixelField(input(seed, 0.5))
      const largest = largestConnectedRegion(
        plan.masks.active,
        plan.columns,
        plan.rows,
      )
      expect(largest / plan.diagnostics.activeCellCount).toBeGreaterThan(0.55)
    }
  })

  it('covers every protected Meta cell without filling its guarded outline', () => {
    const plan = planPixelField(input(1913, 0.65, 4 / 5))
    let tileCellArea = 0
    for (const tile of plan.tiles) {
      tileCellArea += tile.columnSpan * tile.rowSpan
    }
    for (let index = 0; index < plan.masks.protected.length; index += 1) {
      if (plan.masks.protected[index]) expect(plan.masks.active[index]).toBe(1)
    }

    expect(plan.diagnostics.protectedCellCount).toBeGreaterThan(100)
    expect(tileCellArea).toBe(plan.diagnostics.activeCellCount)
  })

  it('reserves one deliberate contiguous negative-space region', () => {
    const plan = planPixelField(input(42, 0.5))
    const largest = largestConnectedRegion(
      plan.masks.quiet,
      plan.columns,
      plan.rows,
    )

    expect(plan.diagnostics.quietCellCount).toBeGreaterThan(20)
    expect(largest / plan.diagnostics.quietCellCount).toBeGreaterThan(0.88)
    for (let index = 0; index < plan.masks.quiet.length; index += 1) {
      if (plan.masks.quiet[index]) expect(plan.masks.active[index]).toBe(0)
    }
  })

  it('keeps accents sparse and glitches bounded to exposed small blocks', () => {
    const plan = planPixelField(input(8675309, 0.85))
    const accents = plan.tiles.filter((tile) => tile.role === 'accent')
    const glitches = plan.tiles.filter((tile) => tile.glitch)

    expect(accents.length).toBeGreaterThan(0)
    expect(plan.diagnostics.accentArea).toBeLessThanOrEqual(
      input(8675309, 0.85).colorPlan!.accentAreaLimit,
    )
    expect(accents.every((tile) => tile.edgeExposure > 0 && tile.scale !== 'macro')).toBe(true)
    expect(glitches.length).toBeGreaterThan(0)
    expect(glitches.length).toBeLessThanOrEqual(6)
    expect(glitches.every((tile) =>
      !tile.protected && tile.edgeExposure > 0 && tile.scale !== 'macro')).toBe(true)
    expect(plan.tiles.every((tile) =>
      tile.colorIndex !== plan.colorHierarchy.ground)).toBe(true)
    expect(plan.colorHierarchy.visible.length).toBeLessThanOrEqual(
      input(8675309, 0.85).colorPlan!.localColorLimit,
    )
  })

  it('loops glitch motion exactly without changing planned topology', () => {
    const plan = planPixelField(input(1913, 0.5))
    const tile = plan.tiles.find((candidate) => candidate.glitch)
    expect(tile?.glitch).toBeTruthy()
    const glitch = tile!.glitch!
    const start = resolvePixelGlitchFrame(glitch, 0, 0.8, 1.37)
    const quarter = resolvePixelGlitchFrame(glitch, 0.25, 0.8, 1.37)
    const end = resolvePixelGlitchFrame(glitch, 1, 0.8, 1.37)

    expect(end).toEqual(start)
    expect(quarter).not.toEqual(start)
    expect(Math.abs(start.offset)).toBeLessThanOrEqual(glitch.maxOffset)
    expect(Math.abs(quarter.offset)).toBeLessThanOrEqual(glitch.maxOffset)
    expect(planPixelField(input(1913, 0.5)).tiles).toEqual(plan.tiles)
  })

  it('uses complexity to add finer normalized topology', () => {
    const low = planPixelField(input(1913, 0.15))
    const high = planPixelField(input(1913, 0.85))

    expect(high.columns * high.rows).toBeGreaterThan(low.columns * low.rows)
    expect(high.tiles.length).toBeGreaterThan(low.tiles.length)
    expect(high.diagnostics.scaleCounts.micro).toBeGreaterThan(
      low.diagnostics.scaleCounts.micro,
    )
  })
})
