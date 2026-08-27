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

function everyRegionTouches(
  mask: Uint8Array,
  target: Uint8Array,
  columns: number,
  rows: number,
): boolean {
  const visited = new Uint8Array(mask.length)
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue
    const queue = [start]
    visited[start] = 1
    let touches = false
    for (let read = 0; read < queue.length; read += 1) {
      const index = queue[read]
      if (target[index]) touches = true
      const column = index % columns
      const row = Math.floor(index / columns)
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue
          const x = column + offsetX
          const y = row + offsetY
          if (x < 0 || x >= columns || y < 0 || y >= rows) continue
          const neighbor = y * columns + x
          if (!mask[neighbor] || visited[neighbor]) continue
          visited[neighbor] = 1
          queue.push(neighbor)
        }
      }
    }
    if (!touches) return false
  }
  return true
}

function maximumExtension(
  active: Uint8Array,
  protectedMask: Uint8Array,
  columns: number,
  rows: number,
  aspect: number,
): number {
  const protectedPoints: { x: number; y: number }[] = []
  for (let index = 0; index < protectedMask.length; index += 1) {
    if (!protectedMask[index]) continue
    protectedPoints.push({
      x: ((index % columns) + 0.5) * aspect / columns,
      y: (Math.floor(index / columns) + 0.5) / rows,
    })
  }
  let maximum = 0
  for (let index = 0; index < active.length; index += 1) {
    if (!active[index] || protectedMask[index]) continue
    const x = ((index % columns) + 0.5) * aspect / columns
    const y = (Math.floor(index / columns) + 0.5) / rows
    let nearest = Number.POSITIVE_INFINITY
    for (const point of protectedPoints) {
      nearest = Math.min(nearest, Math.hypot(x - point.x, y - point.y))
    }
    maximum = Math.max(maximum, nearest)
  }
  return maximum
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
    for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5]) {
      for (const seed of [42, 1913, 8675309]) {
        const plan = planPixelField(input(seed, 0.5, aspect))
        expect(everyRegionTouches(
          plan.masks.active,
          plan.masks.protected,
          plan.columns,
          plan.rows,
        )).toBe(true)
        if (aspect === 16 / 9) {
          const largest = largestConnectedRegion(
            plan.masks.active,
            plan.columns,
            plan.rows,
          )
          expect(largest / plan.diagnostics.activeCellCount).toBeGreaterThan(0.55)
        }
      }
    }
  })

  it('keeps perimeter caps within one macro unit and disables low glitches', () => {
    for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5]) {
      for (const seed of [42, 1913, 8675309]) {
        const plan = planPixelField(input(seed, 0.15, aspect))
        const macroUnit = 6 * Math.max(aspect / plan.columns, 1 / plan.rows)
        for (const attachment of plan.attachments) {
          const length = Math.hypot(
            (attachment.endX - attachment.startX) * aspect,
            attachment.endY - attachment.startY,
          )
          expect(length + attachment.endRadius).toBeLessThanOrEqual(
            macroUnit + Number.EPSILON,
          )
        }
        expect(maximumExtension(
          plan.masks.active,
          plan.masks.protected,
          plan.columns,
          plan.rows,
          aspect,
        )).toBeLessThanOrEqual(macroUnit * 1.15)
        expect(plan.tiles.filter((tile) => tile.glitch)).toHaveLength(0)
      }
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
    for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5]) {
      const plan = planPixelField(input(42, 0.5, aspect))
      const largest = largestConnectedRegion(
        plan.masks.quiet,
        plan.columns,
        plan.rows,
      )
      let massOverlap = 0

      expect(plan.diagnostics.quietCellCount).toBeGreaterThan(3)
      expect(largest / plan.diagnostics.quietCellCount).toBeGreaterThan(0.7)
      expect(plan.quietZone.attachment).toBeLessThan(plan.attachments.length)
      for (let index = 0; index < plan.masks.quiet.length; index += 1) {
        if (!plan.masks.quiet[index]) continue
        expect(plan.masks.active[index]).toBe(0)
        if (plan.masks.mass[index]) massOverlap += 1
      }
      expect(massOverlap).toBeGreaterThan(0)
    }
  })

  it('keeps accents sparse and glitches bounded to exposed small blocks', () => {
    const planInput = input(8675309, 0.85)
    const plan = planPixelField(planInput)
    const accents = plan.tiles.filter((tile) => tile.role === 'accent')

    expect(accents.length).toBeGreaterThan(0)
    expect(plan.diagnostics.accentArea).toBeLessThanOrEqual(
      planInput.colorPlan!.accentAreaLimit,
    )
    expect(accents.every((tile) => tile.edgeExposure > 0 && tile.scale !== 'macro')).toBe(true)
    expect(plan.tiles.every((tile) =>
      tile.colorIndex !== plan.colorHierarchy.ground)).toBe(true)
    expect(plan.colorHierarchy.visible.length).toBeLessThanOrEqual(
      planInput.colorPlan!.localColorLimit,
    )

    for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5]) {
      for (const seed of [42, 1913, 8675309]) {
        const boundedPlan = planPixelField(input(seed, 0.85, aspect))
        const glitches = boundedPlan.tiles.filter((tile) => tile.glitch)
        expect(glitches.length).toBeGreaterThan(0)
        expect(glitches.length).toBeLessThanOrEqual(5)
        expect(glitches.every((tile) =>
          !tile.protected && tile.edgeExposure > 0 && tile.scale !== 'macro')).toBe(true)
        expect(boundedPlan.diagnostics.glitchArea).toBeLessThan(0.035)
        expect(boundedPlan.diagnostics.maxGlitchDisplacement).toBeLessThan(0.008)
      }
    }
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

  it('adds fine stairs and glitches without moving low-complexity masses', () => {
    const low = planPixelField(input(1913, 0.15))
    const medium = planPixelField(input(1913, 0.5))
    const high = planPixelField(input(1913, 0.85))

    expect(high.columns).toBe(low.columns)
    expect(high.rows).toBe(low.rows)
    expect(medium.masks.base).toEqual(low.masks.base)
    expect(high.masks.base).toEqual(low.masks.base)
    for (let index = 0; index < low.masks.base.length; index += 1) {
      if (low.masks.base[index]) expect(high.masks.active[index]).toBe(1)
    }
    expect(high.tiles.length).toBeGreaterThan(low.tiles.length)
    expect(low.diagnostics.scaleCounts.micro).toBe(0)
    expect(medium.diagnostics.scaleCounts.micro).toBeGreaterThan(0)
    expect(high.diagnostics.scaleCounts.micro).toBeGreaterThan(0)
    expect(medium.diagnostics.activeCellCount).toBeGreaterThan(
      low.diagnostics.activeCellCount,
    )
    expect(high.diagnostics.activeCellCount).toBeGreaterThan(
      medium.diagnostics.activeCellCount,
    )
    expect(low.tiles.filter((tile) => tile.glitch)).toHaveLength(0)
    expect(medium.tiles.filter((tile) => tile.glitch)).toHaveLength(2)
    expect(high.tiles.filter((tile) => tile.glitch)).toHaveLength(5)
  })
})
