import { chan } from '@/core/organic/random'
import type { Field } from './field'
import type { LabState, MotionState } from './types'
import { applyV1MotionAt } from './v1/motion'

const TAU = Math.PI * 2

const WARP_MODES = [
  { xFrequency: 0.58, yFrequency: 0.31, temporalHarmonic: 1, baseWeight: 1, energyWeight: 0 },
  { xFrequency: -0.37, yFrequency: 0.92, temporalHarmonic: 2, baseWeight: 0.22, energyWeight: 0.5 },
  { xFrequency: 1.08, yFrequency: 0.66, temporalHarmonic: 3, baseWeight: 0.04, energyWeight: 0.32 },
] as const

export type OrganicMotionWarp = {
  active: boolean
  field: (source: Field) => Field
  point: (x: number, y: number) => { x: number; y: number }
}

export function motionPhase(timeMs: number, loopSeconds: number): number {
  const loopMs = Math.max(2000, loopSeconds * 1000)
  return ((timeMs % loopMs) + loopMs) % loopMs / loopMs
}

// Builds one low-frequency, divergence-like domain warp per frame. Every
// spatial basis is odd around the canvas center, so the symbol stays anchored
// while its lobes and boundaries flex. Integer temporal harmonics guarantee a
// seamless loop; speed adds higher-frequency motion without changing the seam.
export function createOrganicMotionWarp(
  motion: MotionState,
  seed: number,
  width: number,
  height: number,
): OrganicMotionWarp {
  const phase = motion.frame?.phase
  const amount = Math.max(0, Math.min(1, motion.amount))
  if (phase === undefined || amount <= 0 || width <= 0 || height <= 0) {
    return {
      active: false,
      field: (source) => source,
      point: (x, y) => ({ x, y }),
    }
  }

  const energy = Math.max(0, Math.min(1, (motion.speed - 0.1) / 1.9))
  const theta = phase * TAU
  const halfMin = Math.max(1, Math.min(width, height) / 2)
  const centerX = width / 2
  const centerY = height / 2
  const strength = Math.min(width, height) * 0.052 * amount ** 0.82
  const breathStrength = Math.min(width, height) * 0.012 * amount ** 0.9
  const modes = WARP_MODES.map((mode, index) => {
    const temporalPhase = (
      theta * mode.temporalHarmonic
      + chan(seed, index, 'motion.organic.phase') * TAU
    )
    return {
      ...mode,
      cosine: Math.cos(temporalPhase),
      sine: Math.sin(temporalPhase),
      weight: mode.baseWeight + mode.energyWeight * energy,
    }
  })
  const totalWeight = modes.reduce((sum, mode) => sum + mode.weight, 0)
  const breathPhaseX = theta + chan(seed, 0, 'motion.organic.breath') * TAU
  const breathPhaseY = theta * 2 + chan(seed, 1, 'motion.organic.breath') * TAU
  const stretchX = Math.cos(breathPhaseX) * 0.72 + Math.cos(breathPhaseY) * 0.28
  const stretchY = Math.sin(breathPhaseX) * 0.68 - Math.sin(breathPhaseY) * 0.32
  const shear = Math.sin(theta + chan(seed, 2, 'motion.organic.breath') * TAU) * 0.28
  let warpedX = 0
  let warpedY = 0

  const resolve = (x: number, y: number) => {
    const u = (x - centerX) / halfMin
    const v = (y - centerY) / halfMin
    let dx = 0
    let dy = 0

    for (const mode of modes) {
      const along = Math.sin(TAU * (mode.xFrequency * u + mode.yFrequency * v))
      const across = Math.sin(TAU * (-mode.yFrequency * u + mode.xFrequency * v))
      dx += mode.weight * (along * mode.cosine + across * mode.sine)
      dy += mode.weight * (across * mode.cosine - along * mode.sine)
    }

    warpedX = x
      + (dx / totalWeight) * strength
      + (u * stretchX + v * shear) * breathStrength
    warpedY = y
      + (dy / totalWeight) * strength
      + (v * stretchY - u * shear) * breathStrength
  }

  return {
    active: true,
    field: (source) => (x, y) => {
      resolve(x, y)
      return source(warpedX, warpedY)
    },
    point: (x, y) => {
      resolve(x, y)
      return { x: warpedX, y: warpedY }
    },
  }
}

// Preview-only runtime phase. The persisted geometry stays untouched, so the
// animation deforms the generated field rather than translating the symbol.
export function applyMotionAt(lab: LabState, timeMs: number): LabState {
  if (lab.look?.version === 'v1') return applyV1MotionAt(lab, timeMs)
  if (lab.motion.amount <= 0) return lab
  return {
    ...lab,
    motion: {
      ...lab.motion,
      frame: {
        phase: motionPhase(timeMs, lab.motion.loopSeconds),
      },
    },
  }
}
