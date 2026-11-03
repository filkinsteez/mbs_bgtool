/**
 * The horizon every Sunset look shares (docs/light/research/horizon-placement.md): how high the
 * line sits for the Horizon control and a seed, what fills the frame below it, and how much it
 * tilts.
 */

/** What fills the frame below the line: more sky (no line in the frame), water or land. */
export type HorizonBelow = 'open' | 'water' | 'land'
export const HORIZON_BELOW: readonly HorizonBelow[] = ['open', 'water', 'land']

export interface HorizonPlacement {
  /**
   * Height of the line at the frame's center column, from 0 at the top edge to 1 at the bottom
   * edge; above 1 is below the frame. For open sky no line is drawn and this is where the look
   * puts its weight (the brightest band).
   */
  y: number
  below: HorizonBelow
  /** Degrees; positive lowers the line toward the right. Water stays within 0.5. */
  tilt: number
}

/** Line height at Horizon 0 (below the frame) and at Horizon 1 (a quarter of the way down). */
const Y_LOW = 1.06
const Y_HIGH = 0.27
/** Largest seeded shift of the line, frame heights; it shrinks to 0 at both ends of the control. */
const SHIFT = 0.05
/** Largest tilt in degrees: water, then land and open sky. */
const WATER_TILT = 0.5
const TILT = 12
/** Largest rise of a tilted line across the whole frame width, frame heights. */
const RISE = 0.35

/** Deterministic random numbers in [0, 1) for one stream. */
function seeded(state: number): () => number {
  let s = state >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Seeds come in runs of three, and each run holds every scene once in a seeded order. */
export function horizonScene(seed: number): HorizonBelow {
  const n = Math.round(seed) - 1
  const run = Math.floor(n / 3)
  const random = seeded(Math.imul(run, 0x9e3779b1) ^ 0x2545f491)
  const order = [...HORIZON_BELOW]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = order[i]
    order[i] = order[j]
    order[j] = swap
  }
  return order[((n % 3) + 3) % 3]
}

/**
 * Where the horizon sits for the Horizon control (0..1), a seed and the frame's width over height.
 * Horizon 0 puts the line below the frame, 0.25 at 86% down, 0.5 at 67%, 0.75 at 47% and 1 at 27%;
 * the seed moves it up to 0.05 either way, less near both ends. A tilted line rises at most a third
 * of the frame height across a wide frame, and a water or land line comes in level from Horizon 0,
 * so there it stays below the whole bottom edge.
 */
export function placeHorizon(control: number, seed: number, aspect: number): HorizonPlacement {
  const t = clamp01(Number.isFinite(control) ? control : 0.5)
  const below = horizonScene(seed)
  const random = seeded(Math.imul(Math.round(seed) | 0, 0x85ebca6b) ^ 0x68b1d)
  const room = Math.min(1, t / 0.25, (1 - t) / 0.25)
  const y = lerp(Y_LOW, Y_HIGH, t) + SHIFT * (2 * random() - 1) * room
  const sign = random() < 0.5 ? -1 : 1
  const most = Math.min(TILT, (Math.atan(RISE / Math.max(aspect, 1e-3)) * 180) / Math.PI)
  let tilt = below === 'water' ? sign * WATER_TILT * random() : sign * lerp(2, most, random())
  if (below !== 'open') tilt *= Math.min(1, t / 0.25)
  return { y, below, tilt }
}
