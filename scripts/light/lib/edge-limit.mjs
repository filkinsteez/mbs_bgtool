// "At the limit" for the color edges check (color-edges.mjs): a frame whose verdict flips when its picture moves by one
// 8-bit level. In compare round 35 a +-1 checkerboard over the picture flipped 6 of 288 frames with the stage on, all by
// the longest firm color edge, whose one-pixel middle line broke at a pixel and split the run in two. Such a frame is
// listed apart, and a change in its verdict between two runs doesn't count as a change.

// The two nudges: each channel one level up on one color of a checkerboard and one level down on the other, and the
// other way round.
export const NUDGES = [0, 1]

// The picture (RGB bytes, 3 per pixel, `w` pixels a row) nudged by one level in a checkerboard; `phase` (0 or 1) picks
// which squares go up. Channels at 0 or 255 stay there when the nudge would take them out of range.
export function nudged(rgb, w, phase) {
  const out = new Uint8Array(rgb.length)
  for (let p = 0; p < rgb.length / 3; p++) {
    const x = p % w
    const y = (p - x) / w
    const step = (x + y + phase) % 2 === 0 ? 1 : -1
    for (let c = 0; c < 3; c++) out[3 * p + c] = Math.min(255, Math.max(0, rgb[3 * p + c] + step))
  }
  return out
}

// Whether the frame is at the limit: `fails(picture)` gives the verdict for a picture, `failsNow` the verdict for the
// frame as drawn.
export function atLimit(rgb, w, failsNow, fails) {
  return NUDGES.some((phase) => fails(nudged(rgb, w, phase)) !== failsNow)
}

const frameKey = (f) => `${f.look} ${f.pack} s${f.seed} ${f.format} ${f.view}`

// Frames whose verdict differs between two runs of the check (`now` and `before`: frames with look, pack, seed, format,
// view, reasons and atLimit; a run made before atLimit existed counts none at the limit). `changed`: the frames that
// changed, at the limit in neither run; `atLimit`: those that changed but are at the limit in one run or both.
export function verdictChanges(now, before) {
  const old = new Map(before.map((f) => [frameKey(f), f]))
  const changed = []
  const limit = []
  for (const f of now) {
    const b = old.get(frameKey(f))
    if (!b || f.reasons.length > 0 === b.reasons.length > 0) continue
    const row = { frame: frameKey(f), now: f.reasons.length > 0 ? 'fails' : 'passes', before: b.reasons.length > 0 ? 'fails' : 'passes' }
    if (f.atLimit || b.atLimit) limit.push(row)
    else changed.push(row)
  }
  return { changed, atLimit: limit }
}
