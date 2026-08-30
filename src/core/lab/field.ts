import { chan } from '@/core/organic/random'
import { sampleMap } from './analysis'

// The Field primitive — the abstraction hypothesis this lab exists to
// test. A Field is a scalar control surface over OUTPUT space:
// sample(x, y) -> 0..1. Image analysis, generated noise, the Lissajous
// distance field, and user masks all become Fields, and studies are
// compositions of them. Kept deliberately tiny: constructors + a few
// combinators, all pure closures, all unit-testable.

export type Field = (x: number, y: number) => number

// where the source sits inside the output rect
export type FitRect = { x: number; y: number; w: number; h: number }

export function fitRect(
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  fit: 'contain' | 'cover',
): FitRect {
  const s =
    fit === 'contain'
      ? Math.min(outW / srcW, outH / srcH)
      : Math.max(outW / srcW, outH / srcH)
  const w = srcW * s
  const h = srcH * s
  return { x: (outW - w) / 2, y: (outH - h) / 2, w, h }
}

// output coords -> map pixel coords through the fit rect; outside the
// rect the field is `outside` — 0 by default (no evidence, no marks),
// overridable for planes whose empty value is not 0 (depth reads 1 in
// empty space, packed normals read 0.5)
export function fieldFromMap(
  data: Float32Array,
  mw: number,
  mh: number,
  rect: FitRect,
  outside = 0,
): Field {
  return (x, y) => {
    const u = (x - rect.x) / rect.w
    const v = (y - rect.y) / rect.h
    if (u < 0 || u > 1 || v < 0 || v > 1) return outside
    return sampleMap(data, mw, mh, u * mw - 0.5, v * mh - 0.5)
  }
}

export function constantField(v: number): Field {
  return () => v
}

// The brief's "blurred low-resolution random field": a seeded value
// lattice smoothly interpolated over the rect. `cells` is the lattice
// resolution across the longer side — few cells = broad regions, many =
// near-independent. Deterministic per (seed, channel).
export function coherenceField(
  seed: number,
  rect: FitRect,
  cells: number,
  channel: string,
): Field {
  const cols = Math.max(2, Math.round(cells))
  const rows = Math.max(2, Math.round((cols * rect.h) / Math.max(1, rect.w)))
  const value = (i: number, j: number) =>
    chan(
      seed,
      Math.max(0, Math.min(rows - 1, j)) * 4096 + Math.max(0, Math.min(cols - 1, i)),
      channel,
    )
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return (x, y) => {
    const u = Math.max(0, Math.min(1, (x - rect.x) / rect.w)) * (cols - 1)
    const v = Math.max(0, Math.min(1, (y - rect.y) / rect.h)) * (rows - 1)
    const i0 = Math.floor(u)
    const j0 = Math.floor(v)
    const fu = smooth(u - i0)
    const fv = smooth(v - j0)
    const top = value(i0, j0) * (1 - fu) + value(i0 + 1, j0) * fu
    const bot = value(i0, j0 + 1) * (1 - fu) + value(i0 + 1, j0 + 1) * fu
    return top * (1 - fv) + bot * fv
  }
}

export function mulFields(a: Field, b: Field): Field {
  return (x, y) => a(x, y) * b(x, y)
}

export function lerpFields(a: Field, b: Field, t: number): Field {
  return (x, y) => a(x, y) * (1 - t) + b(x, y) * t
}

export function remapField(f: Field, lo: number, hi: number): Field {
  const span = hi - lo || 1
  return (x, y) => Math.max(0, Math.min(1, (f(x, y) - lo) / span))
}

export function invertField(f: Field): Field {
  return (x, y) => 1 - f(x, y)
}
