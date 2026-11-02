export const SEED_HISTORY_LIMIT = 50

/** Seeds Shuffle replaced, so Back and forward can return to them. Only the seed: Shuffle changes nothing else. */
export interface SeedHistory {
  /** The seed before each shuffle, oldest first. */
  back: readonly number[]
  /** Seeds left by Back, the most recent last. */
  forward: readonly number[]
}

export const EMPTY_SEED_HISTORY: SeedHistory = { back: [], forward: [] }

export interface SeedStep {
  history: SeedHistory
  seed: number
}

const keepLast = (seeds: readonly number[]) => seeds.slice(-SEED_HISTORY_LIMIT)

/** History after a shuffle away from `from`; a new shuffle drops the steps Back had left. */
export function recordShuffle(history: SeedHistory, from: number): SeedHistory {
  return { back: keepLast([...history.back, from]), forward: [] }
}

/** The seed before the last shuffle, or null when there is none. */
export function stepBack(history: SeedHistory, current: number): SeedStep | null {
  const seed = history.back.at(-1)
  if (seed === undefined) return null
  return { history: { back: history.back.slice(0, -1), forward: keepLast([...history.forward, current]) }, seed }
}

/** The seed the last Back left, or null when there is none. */
export function stepForward(history: SeedHistory, current: number): SeedStep | null {
  const seed = history.forward.at(-1)
  if (seed === undefined) return null
  return { history: { back: keepLast([...history.back, current]), forward: history.forward.slice(0, -1) }, seed }
}
