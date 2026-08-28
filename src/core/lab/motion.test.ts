import { describe, expect, it } from 'vitest'
import { createDefaultLab } from './recipe'
import { applyMotionAt, createOrganicMotionWarp, motionPhase } from './motion'

describe('lab motion', () => {
  it('closes the loop exactly for every speed', () => {
    const lab = createDefaultLab()
    lab.motion = { enabled: true, amount: 0.7, speed: 1.37, loopSeconds: 8 }
    expect(motionPhase(0, 8)).toBe(motionPhase(8000, 8))
    expect(applyMotionAt(lab, 0)).toEqual(applyMotionAt(lab, 8000))
  })

  it('does not mutate the persisted recipe', () => {
    const lab = createDefaultLab()
    lab.motion.enabled = true
    const before = structuredClone(lab)
    applyMotionAt(lab, 1200)
    expect(lab).toEqual(before)
  })

  it('keeps authored geometry fixed and deforms only the runtime field', () => {
    const lab = createDefaultLab()
    lab.motion = { enabled: true, amount: 0.8, speed: 1.2, loopSeconds: 8 }
    const animated = applyMotionAt(lab, 2300)

    expect(animated.territory).toBe(lab.territory)
    expect(animated.flow).toBe(lab.flow)
    expect(animated.motion.frame?.phase).toBeCloseTo(0.2875, 10)
    expect(animated.territory.sources[0].curve?.offsetX).toBe(
      lab.territory.sources[0].curve?.offsetX,
    )
    expect(animated.territory.sources[0].curve?.offsetY).toBe(
      lab.territory.sources[0].curve?.offsetY,
    )
  })

  it('uses the original V1 preview transform instead of the V2 runtime field', () => {
    const lab = createDefaultLab()
    lab.look.version = 'v1'
    lab.motion = { enabled: true, amount: 0.8, speed: 1.2, loopSeconds: 8 }
    const animated = applyMotionAt(lab, 2300)

    expect(animated.motion.frame).toBeUndefined()
    expect(animated.territory).not.toBe(lab.territory)
    expect(animated.flow).not.toBe(lab.flow)
    expect(animated.territory.sources[0].curve?.offsetX).not.toBe(
      lab.territory.sources[0].curve?.offsetX,
    )
  })

  it('anchors the center and balances opposite deformation', () => {
    const lab = createDefaultLab(420)
    lab.motion = { enabled: true, amount: 1, speed: 1.5, loopSeconds: 8 }
    const animated = applyMotionAt(lab, 3100)
    const warp = createOrganicMotionWarp(animated.motion, lab.seed, 1000, 600)

    expect(warp.point(500, 300)).toEqual({ x: 500, y: 300 })
    const a = warp.point(710, 420)
    const b = warp.point(290, 180)
    expect((a.x - 710) + (b.x - 290)).toBeCloseTo(0, 10)
    expect((a.y - 420) + (b.y - 180)).toBeCloseTo(0, 10)
  })

  it('produces bounded, spatially varied deformation on both axes', () => {
    const lab = createDefaultLab(1913)
    lab.motion = { enabled: true, amount: 1, speed: 2, loopSeconds: 8 }
    const animated = applyMotionAt(lab, 1750)
    const warp = createOrganicMotionWarp(animated.motion, lab.seed, 1000, 600)
    const offsets: { x: number; y: number }[] = []

    for (const x of [250, 500, 750]) {
      for (const y of [120, 300, 480]) {
        const point = warp.point(x, y)
        offsets.push({ x: point.x - x, y: point.y - y })
      }
    }

    expect(Math.max(...offsets.map((offset) => Math.abs(offset.x)))).toBeGreaterThan(8)
    expect(Math.max(...offsets.map((offset) => Math.abs(offset.y)))).toBeGreaterThan(8)
    expect(Math.max(...offsets.map((offset) => Math.hypot(offset.x, offset.y))))
      .toBeLessThan(600 * 0.14)
    expect(new Set(offsets.map((offset) => `${offset.x.toFixed(3)},${offset.y.toFixed(3)}`)).size)
      .toBeGreaterThan(6)
  })
})
