import { describe, expect, it } from 'vitest'
import { atLimit, nudged, NUDGES, verdictChanges } from '../scripts/light/lib/edge-limit.mjs'

const W = 6
const H = 4
const frame = (value: number) => new Uint8Array(W * H * 3).fill(value)
// A stand-in for the check's verdict: fails when any channel reaches `limit`.
const failsAt = (limit: number) => (rgb: Uint8Array) => Math.max(...rgb) >= limit
const row = (seed: number, fails: boolean, limit = false) => ({ look: 'contour.merged', pack: 'bold', seed, format: '16x9', view: 'default', reasons: fails ? ['firm color edge'] : [], atLimit: limit })

describe('nudged', () => {
  it('moves every channel by one level, up and down in a checkerboard, the other way in the other phase', () => {
    const [a, b] = NUDGES.map((phase) => nudged(frame(100), W, phase))
    for (let p = 0; p < W * H; p++) {
      const x = p % W
      const y = Math.floor(p / W)
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(a[3 * p + c] - 100)).toBe(1)
        expect(a[3 * p + c] + b[3 * p + c]).toBe(200)
      }
      if (x + 1 < W) expect(a[3 * p]).not.toBe(a[3 * (p + 1)])
      if (y + 1 < H) expect(a[3 * p]).not.toBe(a[3 * (p + W)])
    }
  })

  it('keeps black and white in range', () => {
    expect(Math.min(...nudged(frame(0), W, 0))).toBe(0)
    expect(Math.max(...nudged(frame(255), W, 1))).toBe(255)
  })
})

describe('atLimit', () => {
  it('marks a frame whose verdict flips within one level', () => {
    expect(failsAt(101)(frame(100))).toBe(false)
    expect(atLimit(frame(100), W, false, failsAt(101))).toBe(true)
  })

  it('leaves a frame clear of its limit unmarked, failing or passing', () => {
    expect(atLimit(frame(120), W, true, failsAt(101))).toBe(false)
    expect(atLimit(frame(80), W, false, failsAt(101))).toBe(false)
  })
})

describe('verdictChanges', () => {
  it('counts a changed verdict only when the frame is at the limit in neither run', () => {
    const before = [row(1, false), row(2, false), row(3, true, true), row(4, true), row(5, true)]
    const now = [row(1, true), row(2, false, true), row(3, false), row(4, false, true), row(5, true, true)]
    const { changed, atLimit: limit } = verdictChanges(now, before)
    expect(changed.map((c) => c.frame)).toEqual(['contour.merged bold s1 16x9 default'])
    expect(changed[0]).toMatchObject({ before: 'passes', now: 'fails' })
    expect(limit.map((c) => c.frame)).toEqual(['contour.merged bold s3 16x9 default', 'contour.merged bold s4 16x9 default'])
  })

  it('reads a run made before atLimit existed as having no frame at the limit', () => {
    const before = [{ ...row(1, false), atLimit: undefined }]
    expect(verdictChanges([row(1, true)], before).changed).toHaveLength(1)
  })
})
