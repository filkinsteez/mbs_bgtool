import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, ControlValues, ParamValue } from '../../scene'
import { colorAt, rushColors, STAND_IN_WHITE, standInLuminance } from './colors'
import { MAX_LIGHTS, MAX_TONGUES, SOFT_TURN, bendAt, softClamp } from './split-shader'

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
 * mix), cool (the second color), warm (Yellow's place in Bold, so a warm streak's core is Yellow and it dims into
 * Orange-red; the third color, Tan or Steel, in a pack of three light colors) and deep (the last color); white is all
 * of the spectrum. The color stage gives a warm streak the same color (parts.ts).
 */
type Role = 'lead' | 'cool' | 'warm' | 'deep' | 'white'
const PLACE: Record<Exclude<Role, 'white'>, number> = { lead: 0.25, cool: 0.58, warm: 0.79, deep: 0.92 }

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
  /** A white streak's color order across it: 1 puts its cool edge on its low side, -1 on its high side. */
  fringeDir?: number
  /** A seam where two streaks touch: their overlap on the line where their edges meet, with the two streaks' roles. */
  seam?: [Role, Role]
  /** The dim skirt on the low and the high side, as shares of the streak's light, and its length in half-widths. */
  skirt?: [number, number]
  skirtLength?: number
  /** A lead band's hottest place along the run (where its core is brightest). */
  hotAt?: number
  /** Which sides fall steeply, facing the frame's edge or the dark room: 1 the low side, 2 the high side, 3 both. */
  steep?: number
}

/** Streaks across the frame at most, before accents and seams. */
const MAX_BANDS = 5

export interface RushLayout {
  from: [number, number]
  angle: number
  reach: number
  hook: [number, number]
  stack: [number, number, number, number]
  /** A broad swell across the stack, centered on its bright place: center, half-width, how far the ceiling drops. */
  swell: [number, number, number, number]
  bands: Band[]
  tongues: number[]
  tongueLook: [number, number, number, number]
  tongueCount: number
}

const frameHalves = (aspect: number): [number, number] => (aspect >= 1 ? [aspect / 2, 0.5] : [0.5, 0.5 / aspect])

/** How far out, in half-widths, a body with this falloff is down to a share of its peak (0.12: 12%). */
/** A lead band's share of its stand-in luminance: a navy swell under its bright core, overlapping its neighbours. */
const SWELL_SHARE = 0.3
const reachTo = (share: number, falloff: number) => Math.sqrt(Math.log(1 / share) / falloff)

/**
 * The layout from the seed, the dragged line and the format only. The line runs from where the light is strongest and
 * still together (`from`) toward where it has split into its colors (`to`); without a line the seed lays it along one
 * side of the frame, tilted, starting just past an edge. Bands fill the frame across the line, 3 to 6 of them, each
 * a broad soft peak of light 15-35% of the short side wide; neighbours meet in white seams, and in a quarter of the
 * seeds one pair stands apart with black between. They drift, bow and taper each their own way, fan out in some seeds
 * and cross in others. Half the seeds add one or two thin bright streaks as accents. Every streak's luminance comes
 * from the layout, so the light and dark layout is the same whatever the colors.
 */
export function rushLayout(seed: number, aspect: number, drag?: ControlValues['drag']): RushLayout {
  const random = seededRandom(seed, 0x52a9)
  const [hx, hy] = frameHalves(aspect)
  const longAxis = aspect >= 1 ? 0 : Math.PI / 2
  // The flow runs along the frame, tilted up to about 43 degrees, or across it in about a third of the seeds, so seeds
  // don't share one gentle diagonal.
  const acrossShort = random() < 0.3
  const theta = longAxis + (acrossShort ? Math.PI / 2 : 0) + (random() * 2 - 1) * (acrossShort ? 0.6 : 0.75) + (random() < 0.5 ? Math.PI : 0)
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
  // Every flow bends in a wide arc: a big sweep in about half of the seeds, a gentle one in the others, never straight.
  const curvy = random() < 0.55
  const hook: [number, number] = [either(random) * (curvy ? lerp(0.35, 0.7, random()) : lerp(0.18, 0.32, random())), curvy ? either(random) * lerp(0.05, 0.25, random()) : 0]
  // How far the seed's own stack runs down a tall frame (a flat flow there), where its bands would read as horizontal
  // stripes. From the seed's direction, not the line's, so moving the line never adds or drops a streak.
  const downTall = hy > hx ? Math.min(Math.max((Math.abs(seedRun.nrm[1]) - 0.5) / 0.4, 0), 1) : 0
  // How much of the stack is lit and where, from the seed (a stream of its own). Half of the seeds have a white bridge
  // and soft streaks that fill the stack edge to edge; most others have no bridge and a band of streaks that fills
  // 67-80% of it along one side with dark room beyond, which the arc turns into a broad bright curve with a dark side.
  // One frame-wide feature per seed, so no seed reads as another one moved.
  const coverRandom = seededRandom(seed, 0x5f17)
  const hasBridge = coverRandom() < 0.5
  const edgeToEdge = hasBridge || coverRandom() < 0.3
  const coverShare = edgeToEdge ? 1 : lerp(0.67, 0.8, coverRandom())
  const brightAt = lerp(0.25, 0.75, coverRandom())
  const coverFrom = coverRandom() < 0.5 ? 0 : 1 - coverShare
  // Where the stack runs down a tall frame, its streaks keep to the middle 80% of it, so no streak sits half off the
  // frame's edge.
  const cover = downTall > 0.5 ? { share: Math.min(coverShare, 0.8), from: 0.1, at: brightAt } : { share: coverShare, from: coverFrom, at: brightAt }
  // Half of the seeds fan out strongly, as from a point behind the start, off the frame; in the others the stack
  // narrows a little or widens mildly along the flow.
  const fan = random() < 0.5 ? lerp(0.8, 1.6, random()) : lerp(-0.15, 0.4, random())
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
        const v = (x - f[0]) * nr[0] + (y - f[1]) * nr[1] - bendAt(u / r, hook[0], hook[1]) * r
        acrossAt.push(v / Math.max(1 + fan * softClamp(u / r, -0.3, 1.5, SOFT_TURN), 0.25))
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
  // Where the stack runs down a tall frame, at most four streaks with one lead among them, so they never read as
  // evenly spaced horizontal stripes and every accent still has its streak.
  const tallStack = downTall > 0.5
  const roomFor = Math.max(3, Math.min(MAX_BANDS, Math.round((seedFrame.hi - seedFrame.lo) / spacing)))
  const n = tallStack ? Math.min(roomFor, 4) : roomFor
  const whiteDraw = random()
  const drawnLeads = Math.max(1, Math.round(n * lerp(0.3, 0.42, random())))
  const leads = tallStack ? 1 : drawnLeads
  const hasWhite = whiteDraw < 0.4 && n - leads >= (tallStack ? 4 : 3)
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
  // across its width: a broad soft peak, leaning to one side, with no core line. Two different roles would mix to a
  // hue outside the pack in some pack (Meta Blue and Orange-red to mauve, Meta Blue and Lime to teal, Lime and Tan to
  // khaki), so different neighbours meet through a white seam rather than by overlapping.
  const clashes = (a: Role, b: Role) => a !== b
  // Widths by the seed's kind. A deep band (Orange-red in Bold, Tan in Elemental) is about as wide as the cool and
  // warm bands and falls off a little faster than them.
  const scale = kind === 'broad' ? 1.25 : kind === 'narrow' ? 0.7 : 0.85
  const dominantAt = kind === 'dominant' ? roles.indexOf('lead') : -1
  const baseWidths = roles.map((r, i) =>
    i === dominantAt
      ? lerp(0.45, 0.6, random())
      : scale * (r === 'lead' ? lerp(0.22, 0.32, random()) : r === 'white' ? lerp(0.16, 0.24, random()) : r === 'deep' ? lerp(0.16, 0.24, random()) : lerp(0.16, 0.26, random())),
  )
  // Widths vary a lot within a frame: in a broad seed one band is much wider than the rest (not where the stack runs
  // down a tall frame, whose four streaks share it), and every other band is narrower by its own amount, a light
  // color's band (Cyan, Yellow, Orange-red, Lime, Tan) less so, so it keeps a wide stretch of its own hue. These draws
  // come from a separate random stream, so the draws above and below stay as they were.
  const extra = seededRandom(seed, 0x3c7d)
  // The wide band is a lead band, so Meta Blue leads the frame and a light color (Lime, Tan) never spreads its mid
  // light over a wide area, where it reads olive or grey-brown.
  const leadAt = roles.flatMap((r, i) => (r === 'lead' ? [i] : []))
  const wideDraw = kind === 'broad' ? (leadAt[Math.floor(extra() * leadAt.length)] ?? -1) : -1
  const wideAt = dominantAt >= 0 ? dominantAt : tallStack ? -1 : wideDraw
  const widths = baseWidths.map((w, i) => w * (i === wideAt ? (dominantAt >= 0 ? 1 : lerp(1.5, 2.1, extra())) : roles[i] === 'lead' || roles[i] === 'white' ? lerp(0.45, 1, extra()) : lerp(0.6, 1.05, extra())))
  // Neighbours are spaced at uneven distances, and their swells overlap across the gaps, dipping between them to a
  // dim light where colors hand over, never to black. Two draws per gap as before.
  const gapDraws = roles.slice(1).map(() => [random(), random()])
  // One bridge per frame, where the light is strongest: the differently colored pair nearest a point inside the lit
  // part, by where each pair meets across the stack (from the widths). More than one, or a brighter one, would be the
  // frame's main shape, so two seeds would differ only by where it sits.
  const widthTotal = widths.reduce((a, w) => a + w, 0)
  const pairAt = (i: number) => extent[0] + (cover.from + (cover.share * widths.slice(0, i + 1).reduce((a, w) => a + w, 0)) / widthTotal) * across
  const brightest = extent[0] + (cover.from + cover.at * cover.share) * across
  const candidates = roles
    .slice(1)
    .flatMap((r, i) => (r !== roles[i] && r !== 'white' && roles[i] !== 'white' ? [i] : []))
    .sort((a, b) => Math.abs(pairAt(a) - brightest) - Math.abs(pairAt(b) - brightest))
  const bridgeAt = new Set(candidates.slice(0, hasBridge ? 1 : 0))
  // One wide dark band per frame between two colors, where the dark colors live (Near-black, Forest, Plum and Slate,
  // and Meta Blue's navy), with edges that fade over a long distance. A second one only in a frame with no dark room
  // at its side and five bands or more, so the dark colors still have room there. Every other pair of neighbours
  // overlaps, so their light adds and the meeting is lighter than either side.
  // The dark band sits beside a lead band, where Meta Blue dims into navy, best with another lead or a white band on
  // its other side, and beside a warm or deep band (Orange-red, Tan) only when nothing else is open, since their
  // dim ends read as a red or brown rim against the dark. The second one keeps away from the cool band (Cyan, Lime,
  // Ice), which reads grey or olive as soon as it dims.
  const beside = (i: number, role: Role) => roles[i] === role || roles[i + 1] === role
  const open = gapDraws.map((_, i) => i).filter((i) => !bridgeAt.has(i))
  const besideLead = (i: number) => (roles[i] === 'lead' ? roles[i + 1] : roles[i])
  const leadRank = (i: number) => ['lead', 'white', 'cool', 'warm', 'deep'].indexOf(besideLead(i)) + gapDraws[i][0]
  const byLead = open.filter((i) => beside(i, 'lead')).sort((a, b) => leadRank(a) - leadRank(b))
  const dimRank = (i: number) => (beside(i, 'cool') ? 2 : 0) + (beside(i, 'deep') ? 0 : 1) + gapDraws[i][0]
  const byDim = open.filter((i) => i !== byLead[0]).sort((a, b) => dimRank(a) - dimRank(b))
  const firstDark = byLead[0] ?? byDim[0]
  const secondDark = cover.share >= 1 && roles.length >= 5 ? byDim.find((i) => firstDark !== undefined && Math.abs(i - firstDark) > 1) : undefined
  const darkAt = new Set([firstDark, secondDark].filter((i): i is number => i !== undefined))
  const gaps = gapDraws.map((d, i) => (bridgeAt.has(i) ? lerp(0.14, 0.26, d[1]) : darkAt.has(i) ? lerp(0.6, 0.9, d[1]) : lerp(-0.05, 0.15, d[1])))
  const total = widths.reduce((a, w) => a + w, 0) + gaps.reduce((a, g) => a + g, 0)
  // The bands fill the lit share of the stack; the rest, on the dark side, is room lit only by the outer band's skirt.
  const unit = (cover.share * across) / total
  const bands: Band[] = []
  let at = extent[0] + cover.from * across
  // Neighbours taper opposite ways: one widens along the flow as the next narrows.
  const taperSign = either(random)
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    const width = widths[i] * unit
    const center = at + 0.5 * width
    at += width + (gaps[i] ?? 0) * unit
    const white = role === 'white'
    const falloff = role === 'deep' ? lerp(1.1, 1.5, random()) : lerp(0.75, 1.1, random())
    // Each band's light is a soft glow 1.5 to 1.9 times as wide as its place in the stack, falling off through its own
    // color into the dark gap beside it, where it meets its neighbour's glow and adds up. A white streak is a little
    // narrower and dimmer than white, so it never reads as a flat white field.
    const half = ((white ? 0.8 : 1) * lerp(1.7, 2.1, extra()) * 0.5 * width) / reachTo(0.3, falloff)
    // A white band stays near-white across, with its cool and warm colors only at its edges.
    const split1 = white ? half * lerp(0.6, 0.9, random()) : 0
    bands.push({
      role,
      center,
      half,
      // Each band pinches and widens along its length, so neighbouring edges converge and spread.
      widthVary: lerp(0.12, 0.22, random()),
      // A lead band (Meta Blue) carries its own light: a bright core on one side of its swell, hottest at one place
      // along it, going toward a lighter blue and white only at the hottest point, with a dim navy side.
      coreWidth: role === 'lead' ? lerp(0.85, 1.05, random()) : 0.5,
      asym: either(random) * lerp(0, 0.25, random()),
      rag: lerp(0.02, 0.06, random()),
      split0: split1 * lerp(0.4, 0.7, random()),
      split1,
      luminance: white
        ? STAND_IN_WHITE * lerp(0.7, 0.82, random())
        : // Cool and warm bands near their color's own lightness (Lime, Ice), so they never read dim (olive, grey); deep
          // bands at about their own (Orange-red, Tan, Steel). Meta Blue's wide swell adds onto its neighbours'.
          standInLuminance(PLACE[role]) * (role === 'lead' ? SWELL_SHARE * lerp(0.95, 1.8, random()) : role === 'cool' ? lerp(0.95, 1.25, random()) : role === 'warm' ? lerp(0.9, 1.15, random()) : lerp(0.8, 1.05, random())),
      // Each band's light rises and falls along its length in its own way, so no seed reads as another one moved.
      brightVary: lerp(0.55, 0.8, random()),
      coreGain: role === 'lead' ? lerp(2.5, 3.5, random()) : white ? 0.15 : 0,
      // Every swell is brighter on one side than the other, so no area of a color is flat: Meta Blue's strongly (its
      // navy side), the others gently and light colors least, since a light color's dim side would read olive (Lime)
      // or grey-brown (Tan).
      gradient: either(random) * (role === 'lead' ? lerp(0.06, 0.18, random()) : role === 'cool' || role === 'warm' ? lerp(0.05, 0.15, random()) : lerp(0.15, 0.35, random())),
      wander: lerp(0.004, 0.012, random()),
      // Fine streaks along the motion, visible but soft.
      texture: lerp(0.03, 0.06, random()),
      textureFreq: lerp(8, 16, random()),
      fadeIn: lerp(-0.3, 0.05, random()) * reach,
      fadeLen: lerp(0.1, 0.25, random()) * reach,
      // A short dragged line still has its streaks cross the whole frame.
      fadeOut: Math.max(lerp(1, 1.6, random()) * reach, drag ? uFar + 0.15 : 0),
      drift: either(random) * lerp(0.02, 0.09, random()),
      bow: (either(random) * lerp(0.02, 0.1, random())) / Math.max(reach, 1),
      corePlace: role === 'lead' ? (random() * 2 - 1) * 0.12 : 0,
      hotAt: role === 'lead' ? lerp(uNear, uFar, lerp(0.25, 0.75, extra())) : 0,
      taper: (i % 2 === 0 ? taperSign : -taperSign) * lerp(0.3, 0.8, random()),
      falloff,
    })
  }
  // A side that faces darkness (the outermost bands' outer sides: the frame's edge or the dark room) falls steeply, so
  // a light color there doesn't sit at mid lightness. Between neighbours the sides fall softly, since their light adds
  // up and stays bright where one color hands over to the next.
  bands.forEach((b, i) => {
    // A warm band's side facing the dark band also asks the color stage for a dark color there (Forest, Plum, Slate,
    // Near-black; Meta Blue's navy in Bold), so the dark colors have their room in every frame that has a warm band
    // beside the dark band.
    const asksDark = b.role === 'warm'
    const darkLow = darkAt.has(i - 1) && asksDark
    const darkHigh = darkAt.has(i) && asksDark
    b.steep = (i === 0 || darkLow ? 1 : 0) + (i === bands.length - 1 || darkHigh ? 2 : 0)
  })
  // Where two colors would mix outside the pack, one band's light fills the trough (a lead band's, else the one before)
  // and the other falls off steeply on that side, so the trough reads as one color dimming (navy, deep red), not a mix.
  const steepLeft = bands.map(() => false)
  const steepRight = bands.map(() => false)
  for (let i = 0; i + 1 < bands.length; i++) {
    if (!clashes(bands[i].role, bands[i + 1].role)) continue
    if (bands[i + 1].role === 'lead') steepRight[i] = true
    else steepLeft[i + 1] = true
  }
  // A white streak turns its cool edge (Cyan in Bold) toward a blue neighbour and its warm edge (Yellow) toward a warm
  // one, so each side meets a related color.
  const bluer = (r: Role | undefined) => r === 'lead' || r === 'cool'
  const warmer = (r: Role | undefined) => r === 'warm' || r === 'deep'
  bands.forEach((b, i) => {
    if (b.role === 'white') b.fringeDir = bluer(bands[i + 1]?.role) || warmer(bands[i - 1]?.role) ? -1 : 1
  })
  bands.forEach((b, i) => {
    if (steepLeft[i] && steepRight[i]) b.asym = 0
    else if (steepLeft[i]) b.asym = -0.1
    else if (steepRight[i]) b.asym = 0.1
    // A band beside a dark band reaches further into it, so the dark band's edges fade over a long distance.
    if (darkAt.has(i - 1)) b.asym += 0.25
    if (darkAt.has(i)) b.asym -= 0.25
  })
  // Each band drifts and bows its own way, so no two run as one family of parallel curves. A band never closes in on
  // its neighbour to less than 75% of their distance and no two cross, so bands never squeeze into a wedge or a pinch.
  for (let i = 0; i + 1 < bands.length; i++) {
    const a = bands[i]
    const b = bands[i + 1]
    const apart = b.center - a.center
    let closest = 0
    for (let k = 0; k <= 8; k++) {
      const u = lerp(uNear, uFar, k / 8)
      closest = Math.min(closest, u * (b.drift - a.drift) + u * u * (b.bow - a.bow))
    }
    const f = closest < -0.25 * apart ? (0.25 * apart) / -closest : 1
    b.drift = a.drift + f * (b.drift - a.drift)
    b.bow = a.bow + f * (b.bow - a.bow)
  }
  // The outermost bands light the room beyond them, toward the frame's edges, with a long dim skirt, and the band
  // that fills a trough (the one that doesn't fall off steeply there) lights it dimly in its own dim color (navy for
  // Meta Blue); a bridge lights its own gap. The band beside the dim room on the dark side lights it far enough that it
  // reads dim, not black.
  bands.forEach((b, i) => {
    const roomBelow = i === 0 && cover.from > 0
    const roomAbove = i === bands.length - 1 && cover.from === 0 && cover.share < 1
    // The band beside the dark room fades into it over a long distance, longer in some seeds than in others, so the
    // room's edge is soft and the room stays dark further out.
    const roomEdge = lerp(0.3, 0.7, extra())
    if (roomBelow) b.asym = 0.5 * roomEdge - 0.05
    if (roomAbove) b.asym = 0.05 - 0.5 * roomEdge
    const drawnLevel = lerp(0.005, 0.04, extra())
    const drawnLength = lerp(1, 2.5, extra())
    const level = roomBelow || roomAbove ? 0.5 * drawnLevel : drawnLevel
    const length = roomBelow || roomAbove ? 0.5 * drawnLength : drawnLength
    if (b.role === 'white') return
    const fills = (pair: number, steep: boolean) => !bridgeAt.has(pair) && steep
    const low = i === 0 ? level : fills(i - 1, steepRight[i - 1]) ? 0.2 * level : 0
    const high = i === bands.length - 1 ? level : fills(i, steepLeft[i + 1]) ? 0.2 * level : 0
    if (low === 0 && high === 0) return
    b.skirt = [low, high]
    b.skirtLength = length
  })
  // Where a pair meets in a bridge: their overlap, wide and soft, hot enough that its middle goes white, so they meet
  // lighter than both sides in every pack. It runs along the line where their edges (at 30% of their light) meet,
  // fitted at three places, and spans most of the gap between them.
  const edgeAt = (b: Band, side: 1 | -1, u: number) => {
    const t = softClamp(u / reach, -0.3, 1.3, SOFT_TURN)
    return b.center + u * (b.drift + u * b.bow) + side * b.half * Math.exp(b.taper * (t - 0.5) - side * b.asym) * reachTo(0.3, b.falloff)
  }
  const seams: Band[] = []
  for (let i = 0; i + 1 < bands.length; i++) {
    if (!bridgeAt.has(i)) continue
    const a = bands[i]
    const b = bands[i + 1]
    const [u0, u1, u2] = [uNear, 0.5 * (uNear + uFar), uFar]
    const [j0, j1, j2] = [u0, u1, u2].map((u) => 0.5 * (edgeAt(a, 1, u) + edgeAt(b, -1, u)))
    const bow = ((j2 - j0) / (u2 - u0) - (j1 - j0) / (u1 - u0)) / (u2 - u1)
    const drift = (j1 - j0) / (u1 - u0) - bow * (u0 + u1)
    const trough = Math.max(0, edgeAt(b, -1, u1) - edgeAt(a, 1, u1))
    seams.push({
      role: 'white',
      seam: [a.role, b.role],
      center: j0 - drift * u0 - bow * u0 * u0,
      half: Math.min(0.08, Math.max(0.03, lerp(0.25, 0.5, extra()) * trough)),
      widthVary: lerp(0.2, 0.4, extra()),
      coreWidth: 0.5,
      asym: 0,
      rag: 0.05,
      split0: 0,
      split1: 0,
      luminance: lerp(0.6, 0.85, extra()),
      brightVary: lerp(0.2, 0.4, extra()),
      coreGain: 0,
      gradient: 0,
      wander: lerp(0.002, 0.006, extra()),
      texture: 0.05,
      textureFreq: 40,
      fadeIn: Math.max(a.fadeIn, b.fadeIn),
      fadeLen: Math.max(a.fadeLen, b.fadeLen),
      fadeOut: Math.min(a.fadeOut, b.fadeOut),
      drift,
      bow,
      corePlace: 0,
      taper: 0,
      falloff: lerp(0.9, 1.3, extra()),
    })
  }
  // Neighbours overlap and their light adds, so each band carries three quarters of its light, and the overlaps stay
  // below flat white.
  for (const b of bands) b.luminance *= 0.75
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
  // Every other seed carries one or two thin hot streaks too, over its widest lead band on the side away from the
  // nearest band of another color (beside it a thin blue line turns a deep red mauve, or cuts a sharp line through
  // pale Ice), so a few thin streaks run among the broad bands as in a long exposure of moving light. From a stream
  // of their own, so the draws above stay as they were.
  const host = dominantAt < 0 ? [...bands].filter((b) => b.role === 'lead').sort((a, b) => b.half - a.half)[0] : undefined
  if (host) {
    const thin = seededRandom(seed, 0x71a5)
    const count = Math.min(1 + Math.floor(thin() * 2), MAX_LIGHTS - bands.length - seams.length)
    const others = bands.filter((b) => b.role !== 'lead')
    const nearest = others.sort((a, b) => Math.abs(a.center - host.center) - Math.abs(b.center - host.center))[0]
    const away = nearest ? Math.sign(host.center - nearest.center) || 1 : either(thin)
    for (let k = 0; k < count; k++) {
      bands.push({
        role: 'lead',
        center: host.center + away * (k === 0 ? lerp(0.05, 0.3, thin()) : lerp(0.35, 0.55, thin())) * host.half,
        half: lerp(0.01, 0.018, thin()),
        widthVary: 0.1,
        coreWidth: 0.6,
        asym: 0,
        rag: 0.03,
        split0: 0,
        split1: 0,
        luminance: standInLuminance(PLACE.lead) * lerp(1.3, 1.7, thin()),
        brightVary: lerp(0.2, 0.4, thin()),
        coreGain: lerp(1.5, 2.5, thin()),
        gradient: 0,
        wander: lerp(0.003, 0.008, thin()),
        texture: 0.05,
        textureFreq: 40,
        fadeIn: lerp(-0.3, 0.05, thin()) * reach,
        fadeLen: lerp(0.1, 0.25, thin()) * reach,
        fadeOut: Math.max(lerp(1, 1.6, thin()) * reach, drag ? uFar + 0.15 : 0),
        drift: host.drift,
        bow: host.bow,
        corePlace: 0,
        taper: 0,
        falloff: 1.6,
      })
    }
  }
  bands.push(...seams)
  // No shadow tongues: on a lit frame they read as smudges.
  return {
    from,
    angle: Math.atan2(dir[1], dir[0]),
    reach,
    hook,
    stack,
    swell: [brightest, 0.4 * across, 0.35, 0],
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
  const power = 1.4 * (0.7 + 0.6 * controls.intensity)
  const B = layout.bands
  // The color a role takes, as an index into the list; -1 for a white streak.
  const colorOf = (role: Role) => (role === 'white' ? -1 : colorAt(colors, PLACE[role]))
  const params: Record<string, ParamValue> = {
    run: [round4(layout.from[0]), round4(layout.from[1]), round4(layout.angle), round4(layout.reach)],
    hook: layout.hook.map(round4),
    stack: layout.stack.map(round4),
    swell: layout.swell.map(round4),
    la: pad(B.flatMap((b) => [b.center, b.half, b.widthVary, b.coreWidth]), 4 * MAX_LIGHTS),
    lb: pad(B.flatMap((b) => [b.asym, b.rag, b.split0, b.split1]), 4 * MAX_LIGHTS),
    lc: pad(B.flatMap((b) => [b.luminance * power, b.brightVary, b.coreGain, b.seam ? 2 : b.role === 'white' ? 1 : 0]), 4 * MAX_LIGHTS),
    ld: pad(B.flatMap((b) => [b.gradient, b.wander, b.texture, b.textureFreq]), 4 * MAX_LIGHTS),
    le: pad(B.flatMap((b) => [b.fadeIn, b.fadeLen, b.fadeOut, b.seam ? colorOf(b.seam[0]) : b.role === 'white' ? 0 : colorOf(b.role)]), 4 * MAX_LIGHTS),
    lf: pad(B.flatMap((b) => [b.drift, b.bow, b.corePlace, b.seam ? -2 : b.role === 'white' ? -1 : PLACE[b.role]]), 4 * MAX_LIGHTS),
    lg: pad(B.flatMap((b) => [b.taper, b.falloff, b.fringeDir ?? 1, b.seam ? colorOf(b.seam[1]) : (b.steep ?? 0)]), 4 * MAX_LIGHTS),
    lh: pad(B.flatMap((b) => [b.skirt?.[0] ?? 0, b.skirt?.[1] ?? 0, b.skirtLength ?? 1, b.hotAt ?? 0]), 4 * MAX_LIGHTS),
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
