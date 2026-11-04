import type { ControlValues } from '../../scene'

/** The dragged line as Ramp reads it, in short-side units. */
export interface RampLine {
  /** Start, from the frame's center, y down. */
  from: [number, number]
  /** End, from the frame's center, y down. */
  to: [number, number]
  length: number
  /**
   * Tilt of the ramp's axis in degrees, as the shader's angle: 0 when the line points straight up,
   * positive when it leans left, 180 when it points down.
   */
  tilt: number
}

export function rampLine(drag: NonNullable<ControlValues['drag']>, aspect: number): RampLine {
  const width = Math.max(1, aspect)
  const tall = Math.max(1, 1 / aspect)
  const from: [number, number] = [(drag.from[0] - 0.5) * width, (drag.from[1] - 0.5) * tall]
  const to: [number, number] = [(drag.to[0] - 0.5) * width, (drag.to[1] - 0.5) * tall]
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  return { from, to, length: Math.hypot(dx, dy), tilt: (Math.atan2(-dx, -dy) * 180) / Math.PI }
}

/**
 * A tilt limited to `most` degrees either way: a line pointing sideways gives the most, and one
 * pointing straight up or down gives none. Turning the line changes the tilt at an even rate, so
 * no part of the turn moves the image much faster than the parts around it.
 */
export function limitTilt(tilt: number, most: number): number {
  return most * Math.sin((tilt * Math.PI) / 180)
}
