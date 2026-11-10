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
  /** A white streak's color order across it: 1 puts the first color (the lead) on its low side, -1 on its high side. */
  fringeDir?: number
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

/** How far out, in half-widths, a body with this falloff is down to a share of its peak (0.12: 12%). */
const reachTo = (share: number, falloff: number) => Math.sqrt(Math.log(1 / share) / falloff)

/**
 * The layout from the seed, the dragged line and the format only. The line runs from where the light is strongest and
 * still together (`from`) toward where it has split into its colors (`to`); without a line the seed lays it along one
 * side of the frame, tilted, starting just past an edge. Bands fill the frame across the line, 3 to 6 of them, each
 * a broad soft peak of light 15-35% of the short side wide, meeting through soft lit troughs; they drift, bow and taper
 * each their own way, fan out in some seeds and cross in others. Half the seeds add one or two thin bright streaks as
 * accents. Every streak's luminance comes from the layout, so the light and dark layout is the same whatever the colors.
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
  // A third of the seeds fan out strongly, as from a point behind the start, off the frame.
  const fan = random() < 0.35 ? lerp(0.8, 1.5, random()) : lerp(-0.2, 0.6, random())
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
  // Each seed is one of three kinds, so seeds stay distinct: a few broad bands, more and narrower ones, or one dominant
  // lead band with narrower ones beside it and thin white accents over it.
  const kindDraw = random()
  const kind = kindDraw < 0.35 ? 'broad' : kindDraw < 0.7 ? 'narrow' : 'dominant'
  const spacing = kind === 'broad' ? lerp(0.34, 0.44, random()) : kind === 'narrow' ? lerp(0.17, 0.24, random()) : lerp(0.24, 0.32, random())
  const n = Math.max(3, Math.min(MAX_LIGHTS - 2, Math.round((seedFrame.hi - seedFrame.lo) / spacing)))
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
  // Bands, each 15-35% of the short side wide (where its light is at 30% of its peak), each carrying its own light
  // across its width: a broad soft peak, leaning to one side, with no core line. Neighbours meet through soft troughs
  // that stay lit, reaching black only in a few places; where two colors would add to a hue outside the pack (Meta
  // Blue and Orange-red to mauve, Lime and Tan to khaki) the trough is a little deeper.
  // Any two different roles: a lead and a cool band are Meta Blue and Lime in Elemental, which mix teal-olive.
  const clashes = (a: Role, b: Role) => a !== b
  // Widths by the seed's kind. A deep band (Tan in Elemental, which reads brown at half its light) is narrower and
  // firmer than the others.
  const scale = kind === 'broad' ? 1.25 : kind === 'narrow' ? 0.7 : 0.85
  const dominantAt = kind === 'dominant' ? roles.indexOf('lead') : -1
  const widths = roles.map((r, i) =>
    i === dominantAt
      ? lerp(0.45, 0.6, random())
      : scale * (r === 'lead' ? lerp(0.22, 0.32, random()) : r === 'white' ? lerp(0.16, 0.24, random()) : r === 'deep' ? lerp(0.09, 0.14, random()) : lerp(0.16, 0.26, random())),
  )
  const gaps = roles.slice(1).map((r, i) => (random() < 0.15 ? lerp(0.18, 0.3, random()) : clashes(roles[i], r) ? lerp(0.04, 0.1, random()) : lerp(-0.02, 0.05, random())))
  const total = widths.reduce((a, w) => a + w, 0) + gaps.reduce((a, g) => a + g, 0)
  const unit = across / total
  const bands: Band[] = []
  let at = extent[0]
  // Neighbours taper opposite ways: one widens along the flow as the next narrows.
  const taperSign = either(random)
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    const width = widths[i] * unit
    const center = at + 0.5 * width
    at += width + (gaps[i] ?? 0) * unit
    const white = role === 'white'
    const falloff = role === 'deep' ? lerp(2, 2.8, random()) : lerp(0.75, 1.1, random())
    const half = (0.5 * width) / reachTo(0.3, falloff)
    const split1 = white ? half * lerp(1, 1.3, random()) : 0
    bands.push({
      role,
      center,
      half,
      widthVary: lerp(0.08, 0.2, random()),
      // A lead band's light is its own: the hottest core in its area, broad, whitening at its peak.
      coreWidth: role === 'lead' ? lerp(0.35, 0.5, random()) : 0.5,
      asym: either(random) * lerp(0, 0.25, random()),
      rag: lerp(0.02, 0.06, random()),
      split0: split1 * lerp(0.4, 0.7, random()),
      split1,
      luminance: white
        ? STAND_IN_WHITE * lerp(0.7, 0.9, random())
        : // Cool and warm bands near their color's own lightness (Lime, Ice), so they never read dim (olive, grey).
          standInLuminance(PLACE[role]) * (role === 'lead' ? lerp(1.1, 1.5, random()) : role === 'cool' ? lerp(1.2, 1.5, random()) : role === 'warm' ? lerp(1, 1.2, random()) : lerp(1.4, 1.8, random())),
      brightVary: lerp(0.15, 0.35, random()),
      coreGain: role === 'lead' ? lerp(1.2, 2.2, random()) : 0,
      gradient: either(random) * lerp(0.15, 0.5, random()),
      wander: lerp(0.004, 0.012, random()),
      texture: lerp(0.05, 0.1, random()),
      textureFreq: lerp(25, 50, random()),
      fadeIn: lerp(-0.3, 0.05, random()) * reach,
      fadeLen: lerp(0.1, 0.25, random()) * reach,
      // A short dragged line still has its streaks cross the whole frame.
      fadeOut: Math.max(lerp(1, 1.6, random()) * reach, drag ? uFar + 0.15 : 0),
      drift: either(random) * lerp(0.02, 0.09, random()),
      bow: (either(random) * lerp(0.02, 0.1, random())) / Math.max(reach, 1),
      corePlace: role === 'lead' ? (random() * 2 - 1) * 0.25 : 0,
      taper: (i % 2 === 0 ? taperSign : -taperSign) * lerp(0.3, 0.8, random()),
      falloff,
    })
  }
  // Where two colors would mix outside the pack, one band's light fills the trough (a lead band's, else the one before)
  // and the other falls off steeply on that side, so the trough reads as one color dimming (navy, deep red), not a mix.
  const steepLeft = bands.map(() => false)
  const steepRight = bands.map(() => false)
  for (let i = 0; i + 1 < bands.length; i++) {
    if (!clashes(bands[i].role, bands[i + 1].role)) continue
    if (bands[i + 1].role === 'lead') steepRight[i] = true
    else steepLeft[i + 1] = true
  }
  // A white streak turns its lead-color side toward a lead neighbour, so its last color's fringe (Orange-red in Bold)
  // never meets Meta Blue.
  bands.forEach((b, i) => {
    if (b.role === 'white') b.fringeDir = bands[i + 1]?.role === 'lead' && bands[i - 1]?.role !== 'lead' ? -1 : 1
  })
  bands.forEach((b, i) => {
    if (steepLeft[i] && steepRight[i]) {
      b.half *= 0.72
      b.asym = 0
    } else if (steepLeft[i]) b.asym = -1.2
    else if (steepRight[i]) b.asym = 1.2
  })
  // Each band drifts and bows its own way, so no two run as one family of parallel curves. A band never closes in on
  // its neighbour to less than 60% of their distance (they would merge into one), except in a quarter of the seeds,
  // where one pair that blends cleanly crosses within the frame.
  const clean = bands.slice(1).flatMap((b, i) => (clashes(bands[i].role, b.role) ? [] : [i]))
  const crossAt = clean.length > 0 && random() < 0.25 ? clean[Math.floor(random() * clean.length)] : -1
  for (let i = 0; i + 1 < bands.length; i++) {
    const a = bands[i]
    const b = bands[i + 1]
    const apart = b.center - a.center
    if (i === crossAt) {
      b.drift = a.drift - (1.6 * apart) / Math.max(uFar - Math.max(uNear, 0), 0.5)
      b.bow = a.bow
      continue
    }
    let closest = 0
    for (let k = 0; k <= 8; k++) {
      const u = lerp(uNear, uFar, k / 8)
      closest = Math.min(closest, u * (b.drift - a.drift) + u * u * (b.bow - a.bow))
    }
    const f = closest < -0.4 * apart ? (0.4 * apart) / -closest : 1
    b.drift = a.drift + f * (b.drift - a.drift)
    b.bow = a.bow + f * (b.bow - a.bow)
  }
  // Where a band that dims through blue (lead, cool) meets one that dims through red (warm, deep, a white streak's
  // last fringe), their light would add to pink or mauve: the trough between them reaches black, as their edges meet
  // only where each is down to 3% of its light. Where they would meet sooner, both get narrower.
  const blueSide = (r: Role) => r === 'lead' || r === 'cool'
  const edge3 = (b: Band, side: 1 | -1, t: number) =>
    b.half * Math.exp(b.taper * t - side * b.asym) * (1 + 0.5 * b.widthVary) * reachTo(0.03, b.falloff) + 0.45 * Math.max(b.split0, b.split1) + b.wander
  for (let i = 0; i + 1 < bands.length; i++) {
    const a = bands[i]
    const b = bands[i + 1]
    if (i === crossAt || blueSide(a.role) === blueSide(b.role)) continue
    let worst = 0
    for (let k = 0; k <= 8; k++) {
      const u = lerp(uNear, uFar, k / 8)
      const t = Math.min(1.3, Math.max(-0.3, u / reach)) - 0.5
      const apart = b.center + u * (b.drift + u * b.bow) - (a.center + u * (a.drift + u * a.bow))
      worst = Math.max(worst, (edge3(a, 1, t) + edge3(b, -1, t)) / Math.max(apart, 1e-6))
    }
    if (worst > 1) {
      const k = Math.max(0.5, 1 / worst)
      for (const c of [a, b]) {
        c.half *= k
        c.split0 *= k
        c.split1 *= k
      }
    }
  }
  // A dominant band carries one or two thin hot streaks of its own lead color as accents, over it near its edges,
  // drifting with it, whitening at their peak (a white streak's colored fringes read pink over Meta Blue in Bold).
  if (dominantAt >= 0) {
    const d = bands[dominantAt]
    const count = Math.min(1 + Math.floor(random() * 2), MAX_LIGHTS - bands.length)
    const side = either(random)
    for (let k = 0; k < count; k++) {
      const half = lerp(0.012, 0.02, random())
      bands.push({
        role: 'lead',
        center: d.center + (k === 0 ? side : -side) * lerp(0.35, 0.65, random()) * d.half,
        half,
        widthVary: 0.1,
        coreWidth: 0.6,
        asym: 0,
        rag: 0.03,
        split0: 0,
        split1: 0,
        luminance: standInLuminance(PLACE.lead) * lerp(1.3, 1.7, random()),
        brightVary: lerp(0.2, 0.4, random()),
        coreGain: lerp(1.5, 2.5, random()),
        gradient: 0,
        wander: lerp(0.003, 0.008, random()),
        texture: 0.05,
        textureFreq: 40,
        fadeIn: lerp(-0.3, 0.05, random()) * reach,
        fadeLen: lerp(0.1, 0.25, random()) * reach,
        fadeOut: Math.max(lerp(1, 1.6, random()) * reach, drag ? uFar + 0.15 : 0),
        drift: d.drift,
        bow: d.bow,
        corePlace: 0,
        taper: 0,
        falloff: 1.6,
      })
    }
  }
  // No shadow tongues: on a lit frame they read as smudges.
  return {
    from,
    angle: Math.atan2(dir[1], dir[0]),
    reach,
    hook,
    stack,
    bands,
    tongues: new Array(4 * MAX_TONGUES).fill(0),
    tongueLook: [0, 0, 0, 0],
    tongueCount: 0,
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
    lg: pad(B.flatMap((b) => [b.taper, b.falloff, b.fringeDir ?? 1, 0]), 4 * MAX_LIGHTS),
    lights: B.length,
    spectrum: colors.spectrum,
    fringe: colors.fringe,
    ramp: colors.ramp,
    comps: colors.count,
    groundLevel: colors.groundLevel,
    tongue: pad(layout.tongues, 4 * MAX_TONGUES),
    tongueLook: layout.tongueLook.map(round4),
    tongues: layout.tongueCount,
  }
  return {
    colors: colors.slots,
    params,
    // Little bloom and glare: in a frame that is mostly lit, their haze carries warm light into blue troughs (mauve).
    lens: { bloom: 0.04, bloomLevels: [1, 0.7, 0.45, 0.25, 0.12, 0.05, 0, 0], halation: 0, glare: 0.01 },
    output: { grain: 0 },
  }
}

export function composeRush({ pack, controls, seed, aspect }: ComposeInput): Composition {
  return composeRushSplit(pack.colors.map((c) => c.hex), controls, seed, aspect)
}

export const rushSlotsFromPack = (pack: ColorPack) => rushColors(pack.colors.map((c) => c.hex)).slots
