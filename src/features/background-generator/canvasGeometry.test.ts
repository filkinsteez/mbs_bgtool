import { describe, expect, it } from 'vitest'
import {
  artworkContainsPoint,
  moveSubject,
  rotateSubject,
  scaleSubjectFromCorner,
  subjectBox,
  subjectVisualBounds,
} from './canvasGeometry'
import type { SubjectTransform } from './recipe'

const BASE: SubjectTransform = {
  preset: 'free',
  x: 0,
  y: 0,
  scale: 0.5,
  rotation: 0,
}
const COVERED: SubjectTransform = { ...BASE, scale: 1.5 }

describe('canvas geometry', () => {
  it('maps normalized transforms to an artboard box', () => {
    expect(subjectBox({ ...BASE, x: 0.5, y: -0.5 }, 1000, 500)).toEqual({
      centerX: 750,
      centerY: 125,
      width: 500,
      height: 250,
      rotation: 0,
    })
  })

  it('moves, axis-constrains, and snaps the artwork center', () => {
    const constrained = moveSubject(COVERED, 100, 20, 1000, 500, true, false)
    expect(constrained.transform.x).toBeCloseTo(0.2)
    expect(constrained.transform.y).toBe(0)

    const snapped = moveSubject({ ...COVERED, x: 0.01 }, 0, 0, 1000, 500, false, true)
    expect(snapped.transform.x).toBeCloseTo(0)
    expect(snapped.guideX).toBe(500)
  })

  it('keeps the generated background edge-to-edge while moving and scaling', () => {
    const full: SubjectTransform = {
      preset: 'full',
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    }

    expect(moveSubject(full, 200, 100, 1000, 500, false).transform).toBe(full)
    expect(scaleSubjectFromCorner(full, 'se', 1000, 500, 700, 350, true).transform)
      .toBe(full)
  })

  it('snaps all four artwork edges in screen space while moving', () => {
    const cases = [
      { dx: 246, dy: 20, edge: 'left' as const, target: 0, guide: 'guideX' as const },
      { dx: -246, dy: 20, edge: 'right' as const, target: 1000, guide: 'guideX' as const },
      { dx: 20, dy: 121, edge: 'top' as const, target: 0, guide: 'guideY' as const },
      { dx: 20, dy: -121, edge: 'bottom' as const, target: 500, guide: 'guideY' as const },
    ]
    for (const item of cases) {
      const result = moveSubject(COVERED, item.dx, item.dy, 1000, 500, false, true)
      expect(subjectVisualBounds(result.transform, 1000, 500)[item.edge]).toBeCloseTo(item.target)
      expect(result[item.guide]).toBe(item.target)
    }

    const outsideThreshold = moveSubject(COVERED, 241, 20, 1000, 500, false, true)
    expect(outsideThreshold.guideX).toBeUndefined()
    const sameEightPixelsAtTwoX = moveSubject(COVERED, 492, 20, 2000, 1000, false, true)
    expect(sameEightPixelsAtTwoX.guideX).toBe(0)
  })

  it('clamps oversized rotated visual bounds around the artboard', () => {
    const rotated = { ...BASE, scale: 2, rotation: 30 }
    const result = moveSubject(
      rotated,
      2000,
      -2000,
      1000,
      500,
      false,
      true,
    )
    const bounds = subjectVisualBounds(result.transform, 1000, 500)
    expect(bounds.left).toBeLessThanOrEqual(0)
    expect(bounds.right).toBeGreaterThanOrEqual(1000)
    expect(bounds.top).toBeLessThanOrEqual(0)
    expect(bounds.bottom).toBeGreaterThanOrEqual(500)
  })

  it('hit-tests the complete transformed artwork rectangle', () => {
    const box = subjectBox(BASE, 1000, 500)
    expect(artworkContainsPoint(BASE, 1000, 500, box.centerX, box.centerY)).toBe(true)
    expect(artworkContainsPoint(
      BASE,
      1000,
      500,
      box.centerX - box.width / 2 + 2,
      box.centerY - box.height / 2 + 2,
    )).toBe(true)
    expect(artworkContainsPoint(
      BASE,
      1000,
      500,
      box.centerX - box.width / 2 - 2,
      box.centerY,
    )).toBe(false)
  })

  it('keeps the opposite corner fixed during uniform scaling', () => {
    const scaled = scaleSubjectFromCorner(COVERED, 'se', 1000, 500, 1000, 500, false, false)
    const box = subjectBox(scaled.transform, 1000, 500)
    expect(scaled.transform.scale).toBeCloseTo(1.25)
    expect(box.centerX - box.width / 2).toBeCloseTo(-250)
    expect(box.centerY - box.height / 2).toBeCloseTo(-125)
  })

  it('snaps every dragged corner edge and preserves its opposite anchor', () => {
    const cases = [
      {
        corner: 'nw' as const,
        pointer: { x: 4, y: 4 },
        edges: { left: 0, top: 0 },
        opposite: { x: 1500, y: 750 },
      },
      {
        corner: 'ne' as const,
        pointer: { x: 996, y: 4 },
        edges: { right: 1000, top: 0 },
        opposite: { x: -500, y: 750 },
      },
      {
        corner: 'sw' as const,
        pointer: { x: 4, y: 496 },
        edges: { left: 0, bottom: 500 },
        opposite: { x: 1500, y: -250 },
      },
      {
        corner: 'se' as const,
        pointer: { x: 996, y: 496 },
        edges: { right: 1000, bottom: 500 },
        opposite: { x: -500, y: -250 },
      },
    ]
    for (const item of cases) {
      const result = scaleSubjectFromCorner(
        { ...BASE, scale: 2 },
        item.corner,
        1000,
        500,
        item.pointer.x,
        item.pointer.y,
        false,
      )
      const bounds = subjectVisualBounds(result.transform, 1000, 500)
      for (const [edge, target] of Object.entries(item.edges)) {
        expect(bounds[edge as keyof typeof bounds]).toBeCloseTo(target)
      }
      const box = subjectBox(result.transform, 1000, 500)
      const oppositeX = item.corner.includes('w')
        ? box.centerX + box.width / 2
        : box.centerX - box.width / 2
      const oppositeY = item.corner.includes('n')
        ? box.centerY + box.height / 2
        : box.centerY - box.height / 2
      expect(oppositeX).toBeCloseTo(item.opposite.x)
      expect(oppositeY).toBeCloseTo(item.opposite.y)
      expect(result.guideX).toBe(item.edges.left ?? item.edges.right)
      expect(result.guideY).toBe(item.edges.top ?? item.edges.bottom)
    }
  })

  it('keeps the center fixed for Alt scaling while snapping edges', () => {
    const result = scaleSubjectFromCorner({ ...BASE, scale: 2 }, 'se', 1000, 500, 996, 496, true)
    const box = subjectBox(result.transform, 1000, 500)
    const bounds = subjectVisualBounds(result.transform, 1000, 500)
    expect(box.centerX).toBe(500)
    expect(box.centerY).toBe(250)
    expect(bounds.right).toBeCloseTo(1000)
    expect(bounds.bottom).toBeCloseTo(500)
    expect(result.guideX).toBe(1000)
    expect(result.guideY).toBe(500)
  })

  it('snaps rotation to 15 degree increments with Shift', () => {
    const rotated = rotateSubject(BASE, 500, 250, 500, 100, 650, 250, true)
    expect(rotated.rotation).toBe(90)
  })
})
