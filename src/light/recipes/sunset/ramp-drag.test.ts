import { describe, expect, it } from 'vitest'
import { getPack, PACK_IDS, packHexes } from '../../color/packs'
import { compositionProblems } from '../../compose'
import { sunsetRamp } from './ramp'
import { composeRamp, rampStructure } from './ramp-compose'
import { limitTilt, rampLine } from './ramp-drag'

const ASPECTS = [16 / 9, 9 / 16, 1, 4 / 5]

/** A line from a start (frame units) in a direction (degrees, 0 right, -90 up) with a length in short sides. */
function lineAt(from: [number, number], angle: number, length: number, aspect: number) {
  const [w, h] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
  const turn = (angle * Math.PI) / 180
  return { from, to: [from[0] + (length * Math.cos(turn)) / w, from[1] + (length * Math.sin(turn)) / h] as [number, number] }
}

describe('rampLine', () => {
  it('gives the shader tilt of the direction the line points', () => {
    expect(rampLine({ from: [0.5, 0.8], to: [0.5, 0.2] }, 16 / 9).tilt).toBeCloseTo(0)
    expect(Math.abs(rampLine({ from: [0.5, 0.2], to: [0.5, 0.8] }, 16 / 9).tilt)).toBeCloseTo(180)
    expect(rampLine(lineAt([0.5, 0.5], -45, 0.4, 16 / 9), 16 / 9).tilt).toBeCloseTo(-45)
    expect(rampLine(lineAt([0.5, 0.5], -135, 0.4, 9 / 16), 9 / 16).tilt).toBeCloseTo(45)
    expect(rampLine(lineAt([0.5, 0.5], -90, 0.4, 9 / 16), 9 / 16).length).toBeCloseTo(0.4)
  })
})

describe('limitTilt', () => {
  it('stays within the limit, is level pointing up or down and changes evenly', () => {
    for (let t = -720; t <= 720; t += 1) expect(Math.abs(limitTilt(t, 15))).toBeLessThanOrEqual(15)
    expect(limitTilt(0, 15)).toBeCloseTo(0)
    expect(limitTilt(180, 15)).toBeCloseTo(0)
    expect(limitTilt(-90, 15)).toBeCloseTo(-15)
    for (let t = -360; t < 360; t += 0.5) expect(Math.abs(limitTilt(t + 0.5, 15) - limitTilt(t, 15))).toBeLessThan(0.14)
  })
})

describe('composeRamp with a dragged line', () => {
  it('keeps every param in range for starts, directions and lengths in every format', () => {
    for (const packId of PACK_IDS) {
      const pack = getPack(packId)
      for (let seed = 1; seed <= 9; seed++) {
        for (const aspect of ASPECTS) {
          for (const from of [[0.5, 0.55], [-0.25, 1.25], [1.25, -0.25], [0.1, 0.9]] as [number, number][]) {
            for (let angle = -180; angle < 180; angle += 45) {
              for (const length of [0.05, 0.5, 1.5]) {
                const drag = lineAt(from, angle, length, aspect)
                const composition = composeRamp(packHexes(packId), { intensity: 0.5, softness: 0.5, mood: 0.5, drag }, seed, aspect)
                expect(compositionProblems(sunsetRamp, pack, composition), `${packId} ${seed} ${rampStructure(seed)} ${aspect} ${from} ${angle} ${length}`).toEqual([])
              }
            }
          }
        }
      }
    }
  })

  it('puts the glow at the line start over open sky', () => {
    for (let seed = 1; seed <= 9; seed++) {
      if (['water', 'land'].includes(rampStructure(seed))) continue
      const drag = lineAt([0.4, 0.6], -70, 0.5, 16 / 9)
      const { params } = composeRamp(packHexes('bold'), { intensity: 0.5, softness: 0.5, mood: 0.5, drag }, seed, 16 / 9)
      const [ax, ay] = params.anchor as number[]
      const turn = ((params.angle as number) * Math.PI) / 180
      const dx = (0.4 - ax) * (16 / 9)
      const dy = 0.6 - ay
      const across = dx * Math.cos(turn) - dy * Math.sin(turn)
      const along = dx * Math.sin(turn) + dy * Math.cos(turn) - ((params.drop as number) * across * across) / ((8 / 9) * (8 / 9))
      expect(along, `seed ${seed}`).toBeCloseTo(params.glowOffset as number, 3)
    }
  })
})
