import { describe, expect, it } from 'vitest'
import { EMPTY_SEED_HISTORY, recordShuffle, SEED_HISTORY_LIMIT, stepBack, stepForward, type SeedHistory } from './seedHistory'

describe('seed history', () => {
  it('has nothing to go back or forward to at first', () => {
    expect(stepBack(EMPTY_SEED_HISTORY, 1)).toBeNull()
    expect(stepForward(EMPTY_SEED_HISTORY, 1)).toBeNull()
  })

  it('goes back through shuffles in order and forward again', () => {
    let history: SeedHistory = EMPTY_SEED_HISTORY
    let seed = 1
    for (const next of [10, 20, 30]) {
      history = recordShuffle(history, seed)
      seed = next
    }
    const seen: number[] = []
    for (let step = stepBack(history, seed); step; step = stepBack(history, seed)) {
      ;({ history, seed } = step)
      seen.push(seed)
    }
    expect(seen).toEqual([20, 10, 1])
    const again: number[] = []
    for (let step = stepForward(history, seed); step; step = stepForward(history, seed)) {
      ;({ history, seed } = step)
      again.push(seed)
    }
    expect(again).toEqual([10, 20, 30])
  })

  it('drops the forward steps when shuffling after Back', () => {
    let history = recordShuffle(recordShuffle(EMPTY_SEED_HISTORY, 1), 2)
    const back = stepBack(history, 3)
    expect(back?.seed).toBe(2)
    history = recordShuffle(back!.history, 2)
    expect(history.forward).toEqual([])
    expect(stepForward(history, 7)).toBeNull()
  })

  it(`keeps the last ${SEED_HISTORY_LIMIT} steps`, () => {
    let history: SeedHistory = EMPTY_SEED_HISTORY
    for (let seed = 1; seed <= SEED_HISTORY_LIMIT + 10; seed++) history = recordShuffle(history, seed)
    expect(history.back).toHaveLength(SEED_HISTORY_LIMIT)
    expect(history.back[0]).toBe(11)
  })
})
