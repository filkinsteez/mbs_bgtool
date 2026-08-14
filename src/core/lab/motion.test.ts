import { describe, expect, it } from 'vitest'
import { createDefaultLab } from './recipe'
import { applyMotionAt, motionPhase } from './motion'

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
})
