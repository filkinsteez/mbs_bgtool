import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, ControlValues, ParamValue } from '../../scene'
import { colorAt, rushColors, STAND_IN_WHITE, standInLuminance } from './colors'
import { MAX_LIGHTS, MAX_TONGUES } from './split-shader'

const round4 = (v: number) => Math.round(v * 1e4) / 1e4
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const either = (random: () => number) => (random() < 0.5 ? -1 : 1)

/** Neighbouring seeds start apart: the seed goes through an integer hash, and the first draws are dropped. */
function seededRandom(seed: number, salt: number): () => number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  let a = h | 0
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next()
  next()
  return next
}

/** Uneven positions in [0, 1], sorted, at least `gap` apart where possible. */
function spread(random: () => number, n: number, gap: number): number[] {
  const out: number[] = []
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    const v = random()
    if (out.every((p) => Math.abs(p - v) >= gap)) out.push(v)
  }
  while (out.length < n) out.push(random())
  return out.sort((a, b) => a - b)
}

/**
 * A streak's role, as a place in the spectrum the color list fills: lead (the first color; Meta Blue at the default
 * mix), cool, warm (Yellow's place in Bold, so a warm streak's core is Yellow and it dims into Orange-red) and deep
 * (the last color); white is all of the spectrum.
 */
type Role = 'lead' | 'cool' | 'warm' | 'deep' | 'white'
const PLACE: Record<Exclude<Role, 'white'>, number> = { lead: 0.25, cool: 0.58, warm: 0.74, deep: 0.92 }

interface Band {
  role: Role
  center: number
  half: number
  widthVary: number
  coreWidth: number
  asym: number
  rag: number
  split0: number
  split1: number
  luminance: number
  brightVary: number
  coreGain: number
  gradient: number
  wander: number
  texture: number
  textureFreq: number
  fadeIn: number
  fadeLen: number
  fadeOut: number
  drift: number
  bow: number
  corePlace: number
  /** Log of the streak's width at the reach over its width at the start. */
  taper: number
  /** Exponent of the body's falloff across: low for a wide soft band, higher for a thin streak. */
  falloff: number
}

export interface RushLayout {
  from: [number, number]
  angle: number
  reach: number
  hook: [number, number]
  stack: [number, number, number, number]
  bands: Band[]
  tongues: number[]
  tongueLook: [number, number, number, number]
  tongueCount: number
}

const frameHalves = (aspect: number): [number, number] => (aspect >= 1 ? [aspect / 2, 0.5] : [0.5, 0.5 / aspect])

/** Widest half-width (short sides, halfway along the run) of a wide band and of a thin streak. */
const MAX_WIDE_HALF = 0.26
const MAX_THIN_HALF = 0.1

/** How far out, in half-widths, a body with this falloff is down to a share of its peak (0.12: 12%). */
const reachTo = (share: number, falloff: number) => Math.sqrt(Math.log(1 / share) / falloff)

/**
 * The layout from the seed, the dragged line and the format only. The line runs from where the light is strongest and
 * still together (`from`) toward where it has split into its colors (`to`); without a line the seed lays it along one
 * side of the frame, tilted, starting just past an edge. Streaks fill the frame across the line, 3 to 7 of them: one or
 * two wide soft bands (one of them in the lead color) and thinner streaks, most of them nearly meeting, with dark as
 * narrow gaps and, in some seeds, a wide black gap or two. Every streak's luminance comes from the layout, so the light
 * and dark layout is the same whatever the colors.
 */
export function rushLayout(seed: number, aspect: number, drag?: ControlValues['drag']): RushLayout {
  const random = seededRandom(seed, 0x52a9)
  const [hx, hy] = frameHalves(aspect)
  const longAxis = aspect >= 1 ? 0 : Math.PI / 2
  const acrossShort = random() < 0.18
  const theta = longAxis + (acrossShort ? Math.PI / 2 : 0) + (random() * 2 - 1) * (acrossShort ? 0.6 : 0.4) + (random() < 0.5 ? Math.PI : 0)
  let dir = [Math.cos(theta), Math.sin(theta)]
  let nrm = [-dir[1], dir[0]]
  const alongHalf = Math.abs(dir[0]) * hx + Math.abs(dir[1]) * hy
  const back = alongHalf + lerp(0.02, 0.25, random())
  const off = (random() * 2 - 1) * 0.15 * (Math.abs(nrm[0]) * hx + Math.abs(nrm[1]) * hy)
  let from: [number, number] = [-dir[0] * back + nrm[0] * off, -dir[1] * back + nrm[1] * off]
  let reach = back + alongHalf + lerp(0.05, 0.3, random())
  const seedRun = { from, dir, nrm, reach }
  if (drag) {
    const f: [number, number] = [(drag.from[0] - 0.5) * 2 * hx, (drag.from[1] - 0.5) * 2 * hy]
    const t = [(drag.to[0] - 0.5) * 2 * hx, (drag.to[1] - 0.5) * 2 * hy]
    const length = Math.hypot(t[0] - f[0], t[1] - f[1])
    if (length > 1e-3) {
      from = f
      dir = [(t[0] - f[0]) / length, (t[1] - f[1]) / length]
      nrm = [-dir[1], dir[0]]
      reach = Math.max(0.25, length)
    }
  }
  // A big sweep that bends more and more toward the far end in some seeds, a near-straight flow in others.
  const curvy = random() < 0.4
  const hook: [number, number] = [either(random) * (curvy ? lerp(0.2, 0.45, random()) : lerp(0, 0.08, random())), curvy ? either(random) * lerp(0.05, 0.2, random()) : 0]
  const fan = lerp(-0.25, 0.8, random())
  // Where the frame lies across a flow (with the bend and the fan) and along it, over a grid of points. The stack
  // spans most of it, not the far corners, so no streak sits only in a corner.
  const measure = (f: readonly number[], d: readonly number[], nr: readonly number[], r: number) => {
    const acrossAt: number[] = []
    let near = Infinity
    let far = -Infinity
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const x = lerp(-hx, hx, i / 10)
        const y = lerp(-hy, hy, j / 10)
        const u = (x - f[0]) * d[0] + (y - f[1]) * d[1]
        near = Math.min(near, u)
        far = Math.max(far, u)
        const t = Math.min(1.6, Math.max(-0.5, u / r))
        const v = (x - f[0]) * nr[0] + (y - f[1]) * nr[1] - (hook[0] * t * t + hook[1] * t * t * t) * r
        acrossAt.push(v / Math.max(1 + fan * Math.min(1.5, Math.max(-0.3, u / r)), 0.25))
      }
    acrossAt.sort((a, b) => a - b)
    return { lo: acrossAt[Math.floor(0.03 * (acrossAt.length - 1))], hi: acrossAt[Math.ceil(0.97 * (acrossAt.length - 1))], near, far }
  }
  const frame = measure(from, dir, nrm, reach)
  const extent = [frame.lo, frame.hi]
  const across = frame.hi - frame.lo
  const uNear = frame.near
  const uFar = frame.far
  // The streak count (and with it the roles) comes from the seed's own flow, so dragging never adds or drops a streak.
  const seedFrame = drag ? measure(seedRun.from, seedRun.dir, seedRun.nrm, seedRun.reach) : frame
  const warp = lerp(0.03, 0.1, random()) * across * 0.5
  const stack: [number, number, number, number] = [fan, warp, lerp(0.5, 1.3, random()), Math.min(lerp(1, 3, random()) / (0.5 * across), 0.35 / Math.max(warp, 1e-3))]

  // As many streaks as the frame has room for across. About 40% are lead streaks, never two side by side; the others
  // are accents that between them take every other role, and a white streak in some seeds when at least two accents
  // are left (white looks alike in every pack, so the accents carry the pack).
  const n = Math.max(3, Math.min(MAX_LIGHTS, Math.round((seedFrame.hi - seedFrame.lo) / lerp(0.2, 0.34, random()))))
  const whiteDraw = random()
  const leads = Math.max(1, Math.round(n * lerp(0.3, 0.42, random())))
  const hasWhite = whiteDraw < 0.4 && n - leads >= 3
  const accentRoles: Role[] = ['cool', 'warm', 'deep']
  for (let k = accentRoles.length - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1))
    ;[accentRoles[k], accentRoles[j]] = [accentRoles[j], accentRoles[k]]
  }
  const others: Role[] = Array.from({ length: n - leads - (hasWhite ? 1 : 0) }, (_, k) => accentRoles[k % 3])
  if (hasWhite) others.splice(Math.floor(random() * (others.length + 1)), 0, 'white')
  const slots = [...Array(others.length + 1).keys()]
  for (let k = slots.length - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1))
    ;[slots[k], slots[j]] = [slots[j], slots[k]]
  }
  const leadSlots = new Set(slots.slice(0, leads))
  const roles: Role[] = []
  others.forEach((r, k) => roles.push(...(leadSlots.has(k) ? (['lead', r] as Role[]) : [r])))
  if (leadSlots.has(others.length)) roles.push('lead')
  // One or two wide soft bands, one of them a lead streak (so the lead color carries a broad light with its own
  // gradient and core) and the other a cool or warm accent (a wide deep band is Tan in Elemental, which reads
  // grey-brown when it covers that much); the rest are thin streaks.
  const leadAt = roles.flatMap((r, i) => (r === 'lead' ? [i] : []))
  const accentAt = roles.flatMap((r, i) => (r === 'cool' || r === 'warm' ? [i] : []))
  const wideAt = new Set([leadAt[Math.floor(random() * leadAt.length)]])
  if (n >= 4 && accentAt.length > 0 && random() < 0.5) wideAt.add(accentAt[Math.floor(random() * accentAt.length)])
  const widths = roles.map((r, i) => (wideAt.has(i) ? lerp(2.2, 3.4, random()) : r === 'white' ? lerp(1.2, 1.8, random()) : lerp(0.9, 1.7, random())))
  // Most neighbours nearly meet across a narrow dark gap; a quarter of the seeds open one or two wide black gaps.
  const darkSeed = random() < 0.25
  const gaps = roles.slice(1).map(() => 0.03 + 0.45 * random() ** 2)
  if (darkSeed && gaps.length > 0) for (let k = 0; k < 1 + Math.floor(random() * 2); k++) gaps[Math.floor(random() * gaps.length)] = lerp(0.8, 1.8, random())
  const total = widths.reduce((a, w) => a + w, 0) + gaps.reduce((a, g) => a + g, 0)
  const unit = across / total
  const bands: Band[] = []
  let at = extent[0]
  // Neighbours taper opposite ways: one widens along the flow as the next narrows, so the edge between them moves
  // across the flow and no two neighbouring edges run parallel, while the two still nearly meet.
  const taperSign = either(random)
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    const room = 0.5 * widths[i] * unit
    const center = at + room
    at += widths[i] * unit + (gaps[i] ?? 0) * unit
    const lead = role === 'lead'
    const white = role === 'white'
    const wide = wideAt.has(i)
    const falloff = wide ? lerp(0.8, 1.2, random()) : lerp(1.2, 1.7, random())
    const taper = (i % 2 === 0 ? taperSign : -taperSign) * lerp(0.4, 1, random())
    // A streak's edge, where its light is down to 12% (with a white streak's fringes), reaches about to its room's
    // edge halfway along, so neighbours nearly meet.
    const half = Math.min(room / (reachTo(0.12, falloff) * Math.exp(0.25 * Math.abs(taper)) * (white ? 1.2 : 1)), wide ? MAX_WIDE_HALF : MAX_THIN_HALF)
    const split1 = white ? half * lerp(1, 1.3, random()) : 0
    bands.push({
      role,
      center,
      half,
      widthVary: lerp(0.1, 0.25, random()),
      // No razor-thin cores: a core is at least 0.02 of the short side wide.
      coreWidth: Math.max(wide ? lerp(0.22, 0.38, random()) : lerp(0.25, 0.4, random()), 0.02 / Math.max(half, 1e-3)),
      asym: either(random) * lerp(0, 0.3, random()),
      rag: lerp(0.03, 0.08, random()),
      split0: split1 * lerp(0.4, 0.7, random()),
      split1,
      luminance: white
        ? STAND_IN_WHITE * lerp(0.7, 0.95, random())
        : standInLuminance(PLACE[role]) * (lead ? lerp(1, 1.4, random()) : role === 'cool' ? lerp(0.7, 1, random()) : role === 'warm' ? lerp(0.7, 0.95, random()) : lerp(0.9, 1.3, random())),
      brightVary: lerp(0.2, 0.4, random()),
      // Pale roles (Ice in Atmospheric) get smaller cores, so no core clips to a flat white band.
      coreGain: white ? 0.3 : wide ? (lead ? lerp(0.9, 1.6, random()) : lerp(0.6, 1.1, random())) : lead ? lerp(0.8, 1.6, random()) : role === 'deep' ? lerp(0.6, 1.2, random()) : lerp(0.4, 0.9, random()),
      gradient: wide ? either(random) * lerp(0.4, 0.9, random()) : (random() * 2 - 1) * 0.3,
      wander: lerp(0.005, 0.015, random()),
      texture: lerp(0.08, 0.18, random()),
      textureFreq: lerp(30, 60, random()),
      fadeIn: lerp(-0.3, 0.05, random()) * reach,
      fadeLen: lerp(0.1, 0.25, random()) * reach,
      // A short dragged line still has its streaks cross the whole frame.
      fadeOut: Math.max(lerp(1, 1.6, random()) * reach, drag ? uFar + 0.15 : 0),
      drift: either(random) * lerp(0.005, 0.035, random()),
      bow: (either(random) * lerp(0, 0.04, random())) / Math.max(reach, 1),
      corePlace: (random() * 2 - 1) * 0.35,
      taper,
      falloff,
    })
  }
  // Neighbouring streaks of different roles keep a narrow dark gap everywhere in the frame, since their colors would
  // add to a hue outside the pack (Meta Blue and Orange-red to pink or, dim, mauve; Lime and Tan to khaki): their edges
  // meet where each is down to 4% of its light. A lead and a cool streak (Meta Blue and Cyan or Ice) blend cleanly and
  // meet at 10%; streaks of one role may touch. Where they would meet sooner, both get narrower.
  const edge = (b: Band, side: 1 | -1, t: number, share: number) =>
    b.half * Math.exp(b.taper * t - side * b.asym) * (1 + 0.5 * b.widthVary) * reachTo(share, b.falloff) + 0.45 * Math.max(b.split0, b.split1) + b.wander
  for (let i = 0; i + 1 < bands.length; i++) {
    const a = bands[i]
    const b = bands[i + 1]
    const pair = new Set([a.role, b.role])
    const share = pair.size === 1 || (pair.has('lead') && pair.has('cool')) ? 0.1 : 0.04
    let worst = 0
    for (let k = 0; k <= 8; k++) {
      const u = lerp(uNear, uFar, k / 8)
      const t = Math.min(1.3, Math.max(-0.3, u / reach)) - 0.5
      const apart = b.center + u * (b.drift + u * b.bow) - (a.center + u * (a.drift + u * a.bow))
      worst = Math.max(worst, (edge(a, 1, t, share) + edge(b, -1, t, share)) / Math.max(apart * (a.role === b.role ? 1.25 : 1), 1e-6))
    }
    if (worst > 1) {
      const k = Math.max(0.4, 1 / worst)
      for (const c of [a, b]) {
        c.half *= k
        c.split0 *= k
        c.split1 *= k
      }
    }
  }
  // Soft tongues of shadow rising from the frame's bottom edge, as a seed amount (its own stream).
  const flame = seededRandom(seed, 0x52a8)
  const amount = flame() < 0.35 ? 0 : lerp(0.3, 1, flame())
  // One to three, each its own size, height and lean, so they never read as a row of teeth.
  const tongueCount = amount > 0 ? Math.min(MAX_TONGUES, 1 + Math.round(amount * 2)) : 0
  const places = spread(flame, tongueCount, 0.6 / Math.max(tongueCount, 1))
  const tongues: number[] = []
  for (let j = 0; j < tongueCount; j++) {
    tongues.push((places[j] - 0.5) * 1.7 * hx, lerp(0.03, 0.12, flame()) * (0.6 + amount), lerp(0.15, 0.6, flame()) * 2 * hy * (0.6 + 0.4 * amount), either(flame) * lerp(0.05, 0.35, flame()))
  }
  while (tongues.length < 4 * MAX_TONGUES) tongues.push(0)
  return {
    from,
    angle: Math.atan2(dir[1], dir[0]),
    reach,
    hook,
    stack,
    bands,
    tongues,
    tongueLook: [lerp(0.025, 0.05, flame()), lerp(0.6, 0.85, flame()), lerp(0.01, 0.03, flame()), 0],
    tongueCount,
  }
}

const pad = (values: number[], length: number) => [...values.map(round4), ...new Array(Math.max(0, length - values.length)).fill(0)]

/** The scene for a color list (any 2-5 hexes in order), the controls, a seed and the frame's aspect. */
export function composeRushSplit(hexes: readonly string[], controls: ControlValues, seed: number, aspect: number): Composition {
  const layout = rushLayout(seed, aspect, controls.drag)
  const colors = rushColors(hexes)
  const power = 0.7 + 0.6 * controls.intensity
  const B = layout.bands
  const params: Record<string, ParamValue> = {
    run: [round4(layout.from[0]), round4(layout.from[1]), round4(layout.angle), round4(layout.reach)],
    hook: layout.hook.map(round4),
    stack: layout.stack.map(round4),
    la: pad(B.flatMap((b) => [b.center, b.half, b.widthVary, b.coreWidth]), 4 * MAX_LIGHTS),
    lb: pad(B.flatMap((b) => [b.asym, b.rag, b.split0, b.split1]), 4 * MAX_LIGHTS),
    lc: pad(B.flatMap((b) => [b.luminance * power, b.brightVary, b.coreGain, b.role === 'white' ? 1 : 0]), 4 * MAX_LIGHTS),
    ld: pad(B.flatMap((b) => [b.gradient, b.wander, b.texture, b.textureFreq]), 4 * MAX_LIGHTS),
    le: pad(B.flatMap((b) => [b.fadeIn, b.fadeLen, b.fadeOut, b.role === 'white' ? 0 : colorAt(colors, PLACE[b.role as Exclude<Role, 'white'>])]), 4 * MAX_LIGHTS),
    lf: pad(B.flatMap((b) => [b.drift, b.bow, b.corePlace, b.role === 'white' ? -1 : PLACE[b.role]]), 4 * MAX_LIGHTS),
    lg: pad(B.flatMap((b) => [b.taper, b.falloff, 0, 0]), 4 * MAX_LIGHTS),
    lights: B.length,
    spectrum: colors.spectrum,
    fringe: colors.fringe,
    dim: colors.dim,
    comps: colors.count,
    groundLevel: colors.groundLevel,
    tongue: pad(layout.tongues, 4 * MAX_TONGUES),
    tongueLook: layout.tongueLook.map(round4),
    tongues: layout.tongueCount,
  }
  return {
    colors: colors.slots,
    params,
    // A third of the default glare: its haze mixes every light in the frame, and Meta Blue with Orange-red reads mauve.
    lens: { bloom: 0.08, bloomLevels: [1, 0.7, 0.45, 0.25, 0.12, 0.05, 0, 0], halation: 0, glare: 0.02 },
    output: { grain: 0 },
  }
}

export function composeRush({ pack, controls, seed, aspect }: ComposeInput): Composition {
  return composeRushSplit(pack.colors.map((c) => c.hex), controls, seed, aspect)
}

export const rushSlotsFromPack = (pack: ColorPack) => rushColors(pack.colors.map((c) => c.hex)).slots
