// Drag colors (scripts/light/drag-colors.mjs): which pack colors a frame shows at the default view and under a drag.
// The owner, 2026-11-11 7:26 AM: "dragging control to change color often overrides all original colors to just meta
// blue it should retain its original". A drag moves the light and keeps the picture's colors.

// A pack color is shown when its exact share (lib/exact-read.mjs) is this share of the frame or more.
export const SHOWN = 0.01

// The palette check's test drags (palette-check.mjs DRAGS), in frame units as in the URL.
export const TEST_DRAGS = [
  { name: 'owner', from: [1.011, 1.224], to: [-0.078, -0.067] },
  { name: 'mirror', from: [-0.011, 1.224], to: [1.078, -0.067] },
  { name: 'above', from: [0.5, -0.3], to: [0.5, -0.5] },
  { name: 'side', from: [0.9, 0.5], to: [0.1, 0.5] },
]

// How long a grid drag's line is (frame units).
export const GRID_LINE = 0.4

const round3 = (v) => Math.round(v * 1000) / 1000 || 0

// Light positions on an n by n grid across the frame: each line starts at the middle of a cell and points toward the
// frame's middle, GRID_LINE long; the middle cell's line points down.
export function gridDrags(n) {
  const drags = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const from = [(i + 0.5) / n, (j + 0.5) / n]
      const d = [0.5 - from[0], 0.5 - from[1]]
      const length = Math.hypot(d[0], d[1])
      const dir = length > 1e-9 ? [d[0] / length, d[1] / length] : [0, 1]
      drags.push({ name: `grid ${i + 1},${j + 1}`, from: from.map(round3), to: [from[0] + GRID_LINE * dir[0], from[1] + GRID_LINE * dir[1]].map(round3) })
    }
  return drags
}

// The colors shown (exact share per color name, as exactRead gives it) at the default view and under a drag. `lost`:
// each color shown at the default view and not under the drag, with both shares; `oneColor`: the default view shows
// two colors or more and the drag one or none; `loss`: the share the lost colors gave up.
export function compareDrag(before, after, shown = SHOWN) {
  const names = Object.keys(before)
  const shownBefore = names.filter((n) => before[n] >= shown)
  const shownAfter = names.filter((n) => (after[n] ?? 0) >= shown)
  const lost = shownBefore.filter((n) => (after[n] ?? 0) < shown).map((n) => ({ name: n, before: before[n], after: after[n] ?? 0 }))
  return {
    shownAfter,
    lost,
    oneColor: shownBefore.length >= 2 && shownAfter.length <= 1,
    loss: lost.reduce((s, c) => s + c.before - c.after, 0),
  }
}

const caseKey = (f) => `${f.look} ${f.pack} s${f.seed} ${f.format} ${f.stage}`

// The worst drags, one per frame, at most n: a drag that makes the frame one color first, then by the share lost.
export function worstCases(frames, n) {
  const cases = frames.flatMap((f) => f.drags.filter((d) => d.lost.length || d.oneColor).map((d) => ({ frame: f, drag: d })))
  cases.sort((a, b) => Number(b.drag.oneColor) - Number(a.drag.oneColor) || b.drag.loss - a.drag.loss)
  const seen = new Set()
  const out = []
  for (const c of cases) {
    if (seen.has(caseKey(c.frame))) continue
    seen.add(caseKey(c.frame))
    out.push(c)
    if (out.length === n) break
  }
  return out
}
