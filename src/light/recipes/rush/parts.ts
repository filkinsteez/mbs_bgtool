import type { FieldWant, StagePart } from '../../color/stageFields'
import type { ParamValue } from '../../scene'
import { MAX_LIGHTS } from './split-shader'

/** Line pieces per streak, across the part of the run the frame sees. */
const PIECES = 6

type Params = Readonly<Record<string, ParamValue>>

const vec = (params: Params, key: string): number[] => (Array.isArray(params[key]) ? (params[key] as number[]) : [])
const num = (params: Params, key: string): number => (typeof params[key] === 'number' ? (params[key] as number) : 0)

/** What a streak asks of the stage, from its role (its place in the spectrum; -1 for a white streak). */
function wantOf(place: number): { line?: FieldWant; core?: FieldWant } {
  if (place < 0) return { line: 'bright', core: 'bright' }
  if (place < 0.5) return {}
  if (place < 0.66) return { line: 'cool' }
  if (place < 0.85) return { line: 'warm', core: 'bright' }
  return { line: 'warm' }
}

/**
 * Rush's parts for the color stage, from its params and the frame's aspect: each streak's center as line pieces with
 * its width (edge to edge where its light is down to about 15%), and its hot core, at the brightest place along it the
 * frame sees, as a spot stretched along the flow. The stack's small warp and each streak's wander are left out.
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
    const t = Math.min(1.6, Math.max(-0.5, u / reach))
    const v = across + (hookSquare * t * t + hookCube * t * t * t) * reach
    const x = fx + u * dir[0] + v * nrm[0]
    const y = fy + u * dir[1] + v * nrm[1]
    return [Math.round((x / (2 * hx) + 0.5) * 1e4) / 1e4, Math.round((y / (2 * hy) + 0.5) * 1e4) / 1e4]
  }
  // One group per streak (its pieces and its core are one light with one color), lead streaks first, so the first
  // group, which the stage gives the lead color, is a lead streak.
  const isLead = (i: number) => lf[4 * i + 3] >= 0 && lf[4 * i + 3] < 0.5
  const order = [...Array(lights).keys()].sort((a, b) => Number(isLead(b)) - Number(isLead(a)) || a - b)
  const groupOf = new Map(order.map((i, rank) => [i, rank]))
  const parts: StagePart[] = []
  for (let i = 0; i < lights; i++) {
    const group = groupOf.get(i) ?? i
    const [center, half, , coreWidth] = la.slice(4 * i, 4 * i + 4)
    const [fadeIn, fadeLen] = le.slice(4 * i, 4 * i + 2)
    const [drift, bow, corePlace, place] = lf.slice(4 * i, 4 * i + 4)
    const taper = lg[4 * i] ?? 0
    const taperAt = (u: number) => Math.exp(taper * (Math.min(1.3, Math.max(-0.3, u / reach)) - 0.5))
    const want = wantOf(place)
    const acrossAt = (u: number, offset = 0) => {
      const scale = Math.max(1 + fan * Math.min(1.5, Math.max(-0.3, u / reach)), 0.25)
      return { across: (center + offset * half + u * (drift + u * bow)) * scale, scale }
    }
    for (let k = 0; k < PIECES; k++) {
      const ua = u0 + ((u1 - u0) * k) / PIECES
      const ub = u0 + ((u1 - u0) * (k + 1)) / PIECES
      const a = acrossAt(ua)
      const b = acrossAt(ub)
      const width = Math.round(2 * half * taperAt(0.5 * (ua + ub)) * 0.5 * (a.scale + b.scale) * 1e4) / 1e4
      parts.push({ kind: 'line', from: toFrame(ua, a.across), to: toFrame(ub, b.across), width, group, ...(want.line ? { want: want.line } : {}) })
    }
    // The hottest place along the streak the frame sees: where it has fully faded in, or the frame's near edge.
    const uHot = Math.min(u1, Math.max(u0 + 0.1 * (u1 - u0), fadeIn + fadeLen))
    const hot = acrossAt(uHot, corePlace)
    const ahead = acrossAt(uHot + 0.05 * reach, corePlace)
    const p = toFrame(uHot, hot.across)
    const q = toFrame(uHot + 0.05 * reach, ahead.across)
    parts.push({
      kind: 'spot',
      at: p,
      radius: Math.round(Math.max(2.5 * coreWidth * half * hot.scale * taperAt(uHot), 0.02) * 1e4) / 1e4,
      stretch: 3,
      angle: Math.round(((Math.atan2((q[1] - p[1]) * 2 * hy, (q[0] - p[0]) * 2 * hx) * 180) / Math.PI) * 100) / 100,
      group,
      ...(want.core ? { want: want.core } : {}),
    })
  }
  return parts
}
