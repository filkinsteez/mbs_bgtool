import type { LabState } from '../types'

function wave(t: number, phase = 0): number {
  return Math.sin(t * Math.PI * 2 + phase)
}

function circularNoise(t: number, phase: number, speed: number): number {
  const detail = Math.max(0, Math.min(1, (speed - 0.1) / 1.9))
  return (
    wave(t, phase) * (0.72 - detail * 0.18) +
    wave(t * 2, phase * 1.7) * (0.2 + detail * 0.08) +
    wave(t * 3, phase * 2.3) * (0.08 + detail * 0.1)
  )
}

export function v1MotionPhase(timeMs: number, loopSeconds: number): number {
  const loopMs = Math.max(2000, loopSeconds * 1000)
  return ((timeMs % loopMs) + loopMs) % loopMs / loopMs
}

// Preview-only motion transform from git commit 67f7de1.
export function applyV1MotionAt(lab: LabState, timeMs: number): LabState {
  if (!lab.motion.enabled || lab.motion.amount <= 0) return lab
  const t = v1MotionPhase(timeMs, lab.motion.loopSeconds)
  const a = lab.motion.amount
  const speed = lab.motion.speed
  const curveShiftX = 0.18 * a * circularNoise(t, 0.2, speed)
  const curveShiftY = 0.12 * a * circularNoise(t, 1.4, speed)
  const gainPulse = 1 + 0.2 * a * circularNoise(t, 0.8, speed)
  const angleDrift = 0.25 * a * circularNoise(t, 2.1, speed)
  return {
    ...lab,
    territory: {
      ...lab.territory,
      gain: Math.max(0.2, Math.min(1.6, (lab.territory.gain ?? 1) * gainPulse)),
      sources: lab.territory.sources.map((src) =>
        src.kind === 'curve' && src.curve
          ? {
              ...src,
              curve: {
                ...src.curve,
                offsetX: src.curve.offsetX + curveShiftX,
                offsetY: src.curve.offsetY + curveShiftY,
              },
            }
          : src,
      ),
    },
    flow: {
      ...lab.flow,
      angle: lab.flow.angle + angleDrift,
    },
  }
}
