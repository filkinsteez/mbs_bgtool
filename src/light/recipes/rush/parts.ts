import type { FieldWant, StagePart } from '../../color/stageFields'
import type { ParamValue } from '../../scene'
import { hash1 } from '../sunset/boundary'
import { MAX_LIGHTS, SOFT_TURN, bendAt, softClamp } from './split-shader'

/** Line pieces per streak, across the part of the run the frame sees. */
const PIECES = 6
/** Where a streak's dim flank parts run: half-widths out from its middle. */
const FLANK = 1.6

type Params = Readonly<Record<string, ParamValue>>

const vec = (params: Params, key: string): number[] => (Array.isArray(params[key]) ? (params[key] as number[]) : [])
const num = (params: Params, key: string): number => (typeof params[key] === 'number' ? (params[key] as number) : 0)

/**
 * What a streak asks of the stage: the color the look draws it in, from its role (its place in the spectrum; -1 for a
 * white streak), the same in every pack. A lead streak is the lead color (Meta Blue). A cool streak takes the list's
 * second light color (Cyan, Lime, Ice), which only `pale` gives in every pack. A warm or deep streak takes a later one
 * (Yellow or Orange-red, Tan, Steel), which `warm` gives: Yellow, which dims into Orange-red; Tan; and in Atmospheric,
 * with no warm color, Steel, since Ice is asked as pale. A white streak goes toward white with the second color at its
 * edges, so it asks `pale` too.
 */
function wantOf(place: number): { line?: FieldWant; core?: FieldWant } {
  if (place < 0) return { line: 'pale', core: 'pale' }
  if (place < 0.5) return {}
  if (place < 0.66) return { line: 'pale' }
  return { line: 'warm' }
}

/**
 * Rush's parts for the color stage, from its params and the frame's aspect: each streak's center as line pieces with
 * its width (edge to edge where its light is down to about 15%), and its hot core, at the brightest place along it the
 * frame sees, as a spot stretched along the flow. Each part counts by how much of it the frame sees. The stack's small
 * warp and each streak's wander are left out.
 */
export function rushParts(params: Params, aspect: number): StagePart[] {
  const [hx, hy] = aspect >= 1 ? [aspect / 2, 0.5] : [0.5, 0.5 / aspect]
  const [fx, fy, angle, reach] = vec(params, 'run')
  const [hookSquare, hookCube] = vec(params, 'hook')
  const fan = vec(params, 'stack')[0] ?? 0
  const la = vec(params, 'la')
  const le = vec(params, 'le')
  const lf = vec(params, 'lf')
  const lg = vec(params, 'lg')
  const lights = Math.min(MAX_LIGHTS, Math.round(num(params, 'lights')))
  if (!reach) return []
  const dir = [Math.cos(angle), Math.sin(angle)]
  const nrm = [-dir[1], dir[0]]
  // The run's stretch the frame sees.
  const us = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => (x - fx) * dir[0] + (y - fy) * dir[1])
  const u0 = Math.max(Math.min(...us), -0.5 * reach)
  const u1 = Math.min(Math.max(...us), 1.6 * reach)
  const toFrame = (u: number, across: number): [number, number] => {
    const v = across + bendAt(u / reach, hookSquare, hookCube) * reach
    const x = fx + u * dir[0] + v * nrm[0]
    const y = fy + u * dir[1] + v * nrm[1]
    return [Math.round((x / (2 * hx) + 0.5) * 1e4) / 1e4, Math.round((y / (2 * hy) + 0.5) * 1e4) / 1e4]
  }
  // One group per streak (its pieces and its core are one light with one color), lead streaks first, so the first
  // group, which the stage gives the lead color, is a lead streak.
  // A bridge (place -2), where two streaks meet in wide soft white, asks for the pale color along its middle (Lime in
  // Elemental, at about Lime's own lightness) and has no core spot. Bridges come after the streaks' groups.
  const isBridge = (i: number) => lf[4 * i + 3] < -1.5
  const isLead = (i: number) => lf[4 * i + 3] >= 0 && lf[4 * i + 3] < 0.5
  const order = [...Array(lights).keys()].sort((a, b) => Number(isBridge(a)) - Number(isBridge(b)) || Number(isLead(b)) - Number(isLead(a)) || a - b)
  const groupOf = new Map(order.map((i, rank) => [i, rank]))
  // How much of a part the frame sees: all of it while its band (width across, short-side units) overlaps the frame,
  // fading to none as the band leaves it, so a streak the look draws outside the frame gives the stage no color to
  // spread over its neighbours.
  const seen = (at: readonly [number, number], width: number) => {
    const out = Math.max(Math.abs(at[0] - 0.5) * 2 * hx - hx, Math.abs(at[1] - 0.5) * 2 * hy - hy, 0)
    return Math.round(Math.min(1, Math.max(0, 1 - out / Math.max(0.5 * width, 1e-4))) * 1e4) / 1e4
  }
  const line = (from: [number, number], to: [number, number], width: number, group: number, want?: FieldWant): StagePart => ({
    kind: 'line',
    from,
    to,
    width,
    group,
    ...(want ? { want } : {}),
    ...(want && want !== 'dark' ? { strength: seen([0.5 * (from[0] + to[0]), 0.5 * (from[1] + to[1])], width) } : {}),
  })
  const parts: StagePart[] = []
  for (let i = 0; i < lights; i++) {
    const group = groupOf.get(i) ?? i
    const [center, half, , coreWidth] = la.slice(4 * i, 4 * i + 4)
    const [fadeIn, fadeLen] = le.slice(4 * i, 4 * i + 2)
    const [drift, bow, corePlace, place] = lf.slice(4 * i, 4 * i + 4)
    const taper = lg[4 * i] ?? 0
    const taperAt = (u: number) => Math.exp(taper * (softClamp(u / reach, -0.3, 1.3, SOFT_TURN) - 0.5))
    const want: { line?: FieldWant; core?: FieldWant } = isBridge(i) ? { line: 'pale' } : wantOf(place)
    const acrossAt = (u: number, offset = 0) => {
      const scale = Math.max(1 + fan * softClamp(u / reach, -0.3, 1.5, SOFT_TURN), 0.25)
      return { across: (center + offset * half + u * (drift + u * bow)) * scale, scale }
    }
    for (let k = 0; k < PIECES; k++) {
      const ua = u0 + ((u1 - u0) * k) / PIECES
      const ub = u0 + ((u1 - u0) * (k + 1)) / PIECES
      const a = acrossAt(ua)
      const b = acrossAt(ub)
      const width = Math.round(2 * half * taperAt(0.5 * (ua + ub)) * 0.5 * (a.scale + b.scale) * 1e4) / 1e4
      parts.push(line(toFrame(ua, a.across), toFrame(ub, b.across), width, group, want.line))
    }
    if (isBridge(i)) continue
    // The hottest place along the streak the frame sees: where it has fully faded in, or the frame's near edge.
    const uHot = Math.min(u1, Math.max(u0 + 0.1 * (u1 - u0), fadeIn + fadeLen))
    const hot = acrossAt(uHot, corePlace)
    const ahead = acrossAt(uHot + 0.05 * reach, corePlace)
    const p = toFrame(uHot, hot.across)
    const q = toFrame(uHot + 0.05 * reach, ahead.across)
    const radius = Math.round(Math.max(2.5 * coreWidth * half * hot.scale * taperAt(uHot), 0.02) * 1e4) / 1e4
    parts.push({
      kind: 'spot',
      at: p,
      radius,
      stretch: 3,
      angle: Math.round(((Math.atan2((q[1] - p[1]) * 2 * hy, (q[0] - p[0]) * 2 * hx) * 180) / Math.PI) * 100) / 100,
      group,
      ...(want.core ? { want: want.core } : {}),
      ...(want.line ? { strength: seen(p, 2 * radius) } : {}),
    })
    // Where a colored streak's light falls off into darkness (a side facing the frame's edge or the dark room, lg's
    // fourth number: 1 the low side, 2 the high side; 1.2 to 2 half-widths out, at about 25% down to 5%), its dim end
    // asks for a dark color (Forest, Plum, Slate, Near-black), in a group of its own after the streaks' and bridges'
    // groups, so a dark color is the dim end of this light, never a slab or a blob in the black. A side facing a
    // neighbour hands over to the neighbour's light instead.
    const steep = place < 0 ? 0 : (lg[4 * i + 3] ?? 0)
    const darkSides = [...(steep % 2 >= 1 ? [-1] : []), ...(steep >= 2 ? [1] : [])]
    for (const side of darkSides) {
      for (let k = 0; k < PIECES; k++) {
        const ua = u0 + ((u1 - u0) * k) / PIECES
        const ub = u0 + ((u1 - u0) * (k + 1)) / PIECES
        const a = acrossAt(ua, side * FLANK)
        const b = acrossAt(ub, side * FLANK)
        const width = Math.round(0.8 * half * taperAt(0.5 * (ua + ub)) * 0.5 * (a.scale + b.scale) * 1e4) / 1e4
        parts.push(line(toFrame(ua, a.across), toFrame(ub, b.across), width, lights + i, 'dark'))
      }
    }
  }
  return parts
}

const quintic = (f: number) => f * f * f * (f * (f * 6 - 15) + 10)

/** The engine's `valueNoise(vec2 p, int seed)`, in [-1, 1]. */
function valueNoise(px: number, py: number, seed: number): number {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const ux = quintic(px - ix)
  const uy = quintic(py - iy)
  const a = hash1(ix, iy, seed)
  const b = hash1(ix + 1, iy, seed)
  const d = hash1(ix, iy + 1, seed)
  const e = hash1(ix + 1, iy + 1, seed)
  return ((a + (b - a) * ux) * (1 - uy) + (d + (e - d) * ux) * uy) * 2 - 1
}

/** Where a frame point lies across Rush's flow and along it: `place` and `along`, both in short sides. */
export interface RushAcross {
  place: number
  along: number
}

/**
 * Rush's place across its flow, for the color stage, as the shader's `lookAcross(uv, p)` gives it: a function of a frame
 * point (x from the left edge, y from the top, 0..1), or null when the params have no run.
 * - `place` is the same all along each streak's middle: the run's bend and fan, the stack's warp and each streak's
 *   drift, bow and wander are taken out. Between two neighbouring middles it runs evenly from one to the other (the
 *   k-th lowest middle at a point along the run keeps the place the k-th lowest has at the run's start), and beyond the
 *   outer streaks it follows the outer one. It rises toward the right-hand side of the line's direction.
 * - `along` is the distance along the run from the line's start, negative behind it.
 * Both depend on the seed, the line and the format only, and move continuously with the line.
 */
export function rushAcrossAt(params: Params, aspect: number, seed: number): ((x: number, y: number) => RushAcross) | null {
  const [hx, hy] = aspect >= 1 ? [aspect / 2, 0.5] : [0.5, 0.5 / aspect]
  const [fx, fy, angle, reach] = vec(params, 'run')
  const [hookSquare = 0, hookCube = 0] = vec(params, 'hook')
  const [fan = 0, warp = 0, warpAlong = 0, warpAcross = 0] = vec(params, 'stack')
  const la = vec(params, 'la')
  const ld = vec(params, 'ld')
  const lf = vec(params, 'lf')
  const lights = Math.min(MAX_LIGHTS, Math.round(num(params, 'lights')))
  if (!reach) return null
  const run = Math.max(reach, 1e-3)
  const dir = [Math.cos(angle), Math.sin(angle)]
  const nrm = [-dir[1], dir[0]]
  const middles = (u: number) =>
    Array.from({ length: lights }, (_, i) => (la[4 * i] ?? 0) + u * ((lf[4 * i] ?? 0) + u * (lf[4 * i + 1] ?? 0)) + (ld[4 * i + 1] ?? 0) * valueNoise(u * 1.3, i * 4.7, seed + 31 + i)).sort((a, b) => a - b)
  const rest = middles(0)
  return (x, y) => {
    const qx = (x - 0.5) * 2 * hx - fx
    const qy = (y - 0.5) * 2 * hy - fy
    const u = qx * dir[0] + qy * dir[1]
    const t = u / run
    const v = qx * nrm[0] + qy * nrm[1] - bendAt(t, hookSquare, hookCube) * run
    const vs = v / Math.max(1 + fan * softClamp(t, -0.3, 1.5, SOFT_TURN), 0.25)
    const vw = vs + warp * valueNoise(u * warpAlong, vs * warpAcross, seed + 7)
    if (!lights) return { place: vw, along: u }
    const at = middles(u)
    if (vw <= at[0]) return { place: rest[0] + vw - at[0], along: u }
    for (let k = 0; k + 1 < lights; k++)
      if (vw <= at[k + 1]) return { place: rest[k] + ((vw - at[k]) / Math.max(at[k + 1] - at[k], 1e-6)) * (rest[k + 1] - rest[k]), along: u }
    return { place: rest[lights - 1] + vw - at[lights - 1], along: u }
  }
}

/**
 * `rushAcrossAt` at the middle of each cell of a w x h grid, row 0 at the top, as on the color stage's grid
 * (`gridSize(aspect)`); all zeros when the params have no run.
 */
export function rushAcross(params: Params, aspect: number, seed: number, w: number, h: number): { place: Float32Array; along: Float32Array } {
  const place = new Float32Array(w * h)
  const along = new Float32Array(w * h)
  const at = rushAcrossAt(params, aspect, seed)
  if (at)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const r = at((x + 0.5) / w, (y + 0.5) / h)
        place[y * w + x] = r.place
        along[y * w + x] = r.along
      }
  return { place, along }
}
