import { linearToOklch } from '../../color/oklab'
import type { Rgb } from '../../color/srgb'
import { placeHorizon } from './horizon'

/** Color slots of sunset.blooms. `deep1` and `deep2` are the colors the sky deepens toward, `light1` and `light2` the glow colors. */
export const SLOT = { sky: 0, deep1: 1, deep2: 2, light1: 3, light2: 4 } as const
export const SLOT_COUNT = 5
export const GLOW_COUNT = 4

/** One glow. Positions are frame fractions (outside 0..1 is off-frame); sizes are in units of sqrt(width * height). */
export interface GlowSpec {
  color: number
  at: [number, number]
  radius: number
  /** Width over height. */
  aniso: number
  /** Tilt of the long axis in degrees; positive descends to the right. */
  angle: number
  /** 1 gives the slot color at the glow's center. */
  gain: number
  /** Falloff exponent; lower gives a longer tail. */
  beta: number
  /** How much this glow's haze hides the sky near its center. A glow with none sits behind the others' haze. */
  haze: number
  /** How far the glow's lobes spread and how much its falloff and length change along its edge, 0..1. */
  vary: number
  /** How much the long axis bows: positive lowers both ends, so the light is highest above its source. */
  bend: number
}

/** Where and how strongly the sky deepens toward a deep color. Its radius is in units of the frame's short side. */
export interface ZenithSpec {
  color: number
  at: [number, number]
  radius: number
  aniso: number
  angle: number
  /** Share of the deep color at the center of the darkening, 0..2; above 1 the middle is all deep color. */
  amount: number
  /** Falloff exponent; lower spreads the darkening further. */
  falloff: number
  /** 1: the deep color keeps its hex under the darker top (a pack's dark ground); 0: it darkens with the sky. */
  hold: number
  /** Share of the blue's light taken away where the deep color comes in, so the two meet where both are dark. */
  meet: number
}

/**
 * The sky above mid-sky. It is its exact hex at frame height `mid` and gets
 * `top` stops darker toward the top edge, without changing hue; `tilt` (frame
 * heights per frame width) lowers that line on one side, so the side away
 * from the light is deeper. `vary` is slow light variation over the whole sky
 * (one standard deviation, a share of luminance) with the hex at its mean.
 * `turn` (degrees) turns that whole ramp about the frame's middle, so a
 * dragged line can point the darkening in any direction.
 */
export interface SkySpec {
  top: number
  mid: number
  tilt: number
  vary: number
  turn: number
  /** Pale light over the sky toward the light, in units of the sky luminance. */
  veil: number
  /**
   * A dragged line (frame units): the sky darkens from its start, where it is palest, to its end, where it
   * reaches the far sky, and behind the start it deepens slowly with distance, as the sky does all round a
   * light. Without one the darkening runs across the frame, turned by `turn`.
   */
  line?: { from: readonly [number, number]; to: readonly [number, number] }
}

export interface BloomsLayout {
  glows: GlowSpec[]
  zenith: ZenithSpec
  sky: SkySpec
  /** Extra light in a narrower core at each light's source, over its peak. */
  core: number
  /** Domain warp: amount in units of sqrt(width * height), and frequency in cycles per unit. */
  warp: number
  warpScale: number
  /** Multiplies the solved bridge light between each glow and the sky. */
  bridge: number
  /** Lowest Oklab L each bridge aims for (0: the lighter side's L only). */
  bridgeFloor: number
  /** 1: the glows' haze hides at most as much sky light as they add, so no glow has a ring darker than the sky. */
  hazeFloor: number
  /** 1: on the sky side a bridge is pale light of the sky's own hue, on the light side the light's tint. */
  bridgeSky: number
}

/**
 * The pack's bridge floor. A warm light and a blue sky are nearly opposite hues, so where they weigh the
 * same the blend loses its color; below this L it reads as mauve-grey, above it as pale light.
 */
const BRIDGE_FLOOR = 0.86

/** The tool's three controls, 0..1. `rise` is the mood control (Horizon): how high the light rises. */
export interface BloomsControls {
  intensity: number
  softness: number
  rise: number
  /** The line dragged on the image, in frame units (`ControlValues.drag`). */
  drag?: { from: readonly [number, number]; to: readonly [number, number] }
}

/** The Horizon value the layout uses while a line is set. */
const DRAG_RISE = 0.5

/** Where the lead's light has faded to about a tenth along its long axis, in long radii: the end of a dragged line. */
const DRAG_REACH = 1.25
/** The lead's long radius a dragged line can give it, in units of sqrt(width * height). */
const DRAG_RADIUS: readonly [number, number] = [0.1, 1.6]

/** How far past the frame edge a dark area sits, in units of sqrt(width * height). */
const DARK_PAST_EDGE = 0.04
/**
 * How far above the frame's middle (below it for a light from an upper corner) the sky's direction aims, in short
 * sides, so it never jumps as a lead nears the middle.
 */
const AWAY_UP = 0.12
/**
 * How far the sky pales toward the light, from a seed's own draw: pale light over the sky at the light's side
 * (units of the sky luminance), and the shift of the line where the sky is its exact hex (frame heights,
 * positive toward the light). The low end keeps more of the blue, the high end is pale over most of the frame.
 */
const SKY_VEIL: readonly [number, number] = [0.8, 2.6]
const SKY_MID_SHIFT: readonly [number, number] = [0.16, -0.05]

/**
 * Where a ray from `start` (short-side units from the frame's middle, held inside the frame) in direction
 * `angle` leaves the frame, `past` beyond the edge, in frame units. It moves smoothly as the angle turns,
 * corners included.
 */
function farEdge(start: readonly number[], angle: number, frame: readonly number[], past = DARK_PAST_EDGE): [number, number] {
  const origin = insideFrame(start, frame)
  const exit = toEdge(start, angle, frame) + past
  return [(origin[0] + Math.cos(angle) * exit) / frame[0] + 0.5, (origin[1] + Math.sin(angle) * exit) / frame[1] + 0.5]
}

/** `start` (short-side units from the frame's middle) held inside the frame. */
function insideFrame(start: readonly number[], frame: readonly number[]): [number, number] {
  return [clamp(start[0], -frame[0] / 2, frame[0] / 2), clamp(start[1], -frame[1] / 2, frame[1] / 2)]
}

/** Length of the ray from `start` (held inside the frame) in direction `angle` to the frame's edge, short-side units. */
function toEdge(start: readonly number[], angle: number, frame: readonly number[]): number {
  const origin = insideFrame(start, frame)
  const dir = [Math.cos(angle), Math.sin(angle)]
  const reach = (o: number, d: number, h: number) => (d > 1e-9 ? (h - o) / d : d < -1e-9 ? (-h - o) / d : Infinity)
  return Math.min(reach(origin[0], dir[0], frame[0] / 2), reach(origin[1], dir[1], frame[1] / 2))
}

/**
 * The turn (degrees) that points the sky ramp's darkening, which with no turn runs where
 * uv.y + tilt (uv.x - 0.5) falls, along `angle` (radians, short-side units, y down).
 */
function rampTurn(tilt: number, angle: number, frame: readonly number[]): number {
  const unturned = Math.atan2(-1 / frame[1], -tilt / frame[0])
  const turn = unturned - angle
  return (Math.atan2(Math.sin(turn), Math.cos(turn)) * 180) / Math.PI
}

/**
 * The layout for a dragged line. The lead sits at `from` with its long axis along the line and reaches
 * `to`; the sky darkens along the line from its start (SkySpec.line); the other blooms keep their places
 * relative to the lead, turned by the angle between the seed's light direction (`seedAngle`) and the line,
 * and stay inside the frame, so the seed still shows in which colors come in, how much of each and where.
 * The dark area goes to the frame edge the line runs toward, lying along it, so it stays at an edge or a
 * corner and never lands mid-frame; `sizeDark` gives it the seed's share of the frame there. Where that
 * edge lies behind the light (a line pointing away from the frame) it would sit beside the light, so it
 * goes to the frame's far side from the light instead. Everything moves smoothly with the line, and
 * nothing is added, removed or swapped.
 */
function followDrag(
  layout: BloomsLayout,
  drag: NonNullable<BloomsControls['drag']>,
  aspect: number,
  sizeDark: (zenith: ZenithSpec) => number,
  seedAngle: number,
  leadAniso: number,
  leadScale: number,
  spots: readonly (readonly [number, number])[],
  darkTurn: number,
  warm: (slot: number) => boolean,
  cyan: (slot: number) => boolean,
): BloomsLayout {
  const frame = [Math.sqrt(aspect), 1 / Math.sqrt(aspect)]
  const toP = (p: readonly number[]): [number, number] => [(p[0] - 0.5) * frame[0], (p[1] - 0.5) * frame[1]]
  const fromP = (q: readonly number[]): [number, number] => [q[0] / frame[0] + 0.5, q[1] / frame[1] + 0.5]
  const line = [(drag.to[0] - drag.from[0]) * frame[0], (drag.to[1] - drag.from[1]) * frame[1]]
  const length = Math.hypot(line[0], line[1])
  if (length < 1e-6) return layout
  const lineAngle = Math.atan2(line[1], line[0])
  // The turn is kept within half a turn either way; where it wraps, everything turns by a whole turn,
  // which looks the same.
  const turn = Math.atan2(Math.sin(lineAngle - seedAngle), Math.cos(lineAngle - seedAngle))
  const [c, s] = [Math.cos(turn), Math.sin(turn)]
  const lead = toP(layout.glows[0].at)
  const start = toP(drag.from)
  const place = (at: readonly number[]): [number, number] => {
    const [dx, dy] = [toP(at)[0] - lead[0], toP(at)[1] - lead[1]]
    return fromP([start[0] + c * dx - s * dy, start[1] + s * dx + c * dy])
  }
  const degrees = (turn * 180) / Math.PI
  // A light outside the frame still lights the air near it, so the nearest edge glows in its color: its
  // reach is at least enough to come in that far.
  const outside = Math.hypot(Math.max(0, Math.abs(drag.from[0] - 0.5) - 0.5) * frame[0], Math.max(0, Math.abs(drag.from[1] - 0.5) - 0.5) * frame[1])
  const reach = clamp(Math.max(length / DRAG_REACH, DRAG_OUTSIDE_REACH * outside), DRAG_RADIUS[0], DRAG_RADIUS[1]) * leadScale
  // The other blooms sit at their seed's own places inside the frame, so the seed still shows in which colors
  // come in, how much of each and where, whatever the line leaves in the frame. A warm one is drawn out of the
  // deep end, where its dim light reads olive: toward the frame's point nearest the light beside a warm lead,
  // toward the middle beside a cool one (on it, cyan and yellow light make mint).
  const target = warm(layout.glows[0].color) ? insideFrame01(drag.from) : [0.5, 0.5]
  const placed = layout.glows.map((glow, i) => {
    if (i === 0) return { ...glow, at: [drag.from[0], drag.from[1]] as [number, number], angle: (lineAngle * 180) / Math.PI, aniso: leadAniso, radius: reach / Math.sqrt(leadAniso) }
    const [x, y] = spots[(i - 1) % spots.length]
    const pull = warm(glow.color) ? DRAG_WARM_TOWARD_LIGHT : 0
    return { ...glow, at: [lerp(x, target[0], pull), lerp(y, target[1], pull)] as [number, number], angle: glow.angle + degrees }
  })
  // A bloom moves out of a warm lead's bright body, so the body keeps the light's own color: on it a second bloom
  // or a cyan one adds up to cream or white. A bloom at e (the body's size is 1) moves straight away from the
  // light's middle to 2e - e^2: one at the body's edge stays, and none moves faster than twice the line, so as the
  // light passes over a bloom it is pushed aside and comes back, and never jumps across.
  const pushOut = (at: [number, number], c: readonly number[], d: readonly number[], e: number): [number, number] =>
    e >= 1 ? at : insideFrame01(fromP([c[0] + d[0] * (2 - e), c[1] + d[1] * (2 - e)]))
  const clearOfLead = (at: [number, number], light: GlowSpec): [number, number] => {
    const a = (light.angle * Math.PI) / 180
    const clear = Math.min(DRAG_BODY_CLEAR * light.radius * Math.sqrt(light.aniso), DRAG_BODY_CLEAR_MAX)
    const c = toP(light.at)
    const q = toP(at)
    const d = [q[0] - c[0], q[1] - c[1]]
    return pushOut(at, c, d, Math.hypot((d[0] * Math.cos(a) + d[1] * Math.sin(a)) / clear, ((-d[0] * Math.sin(a) + d[1] * Math.cos(a)) * light.aniso) / clear))
  }
  // A cyan bloom and a warm one keep their bodies apart the same way (together they make mint, then white), the
  // body here being DRAG_APART of their summed sizes around the warm one's middle; where they still overlap, the
  // cyan one is dimmer.
  const nearness = (at: readonly number[], size: number, other: GlowSpec) => {
    const [c, q] = [toP(other.at), toP(at)]
    return Math.hypot(q[0] - c[0], q[1] - c[1]) / (DRAG_APART * (size + other.radius))
  }
  const apart = (at: [number, number], size: number, other: GlowSpec): [number, number] => {
    const c = toP(other.at)
    const q = toP(at)
    return pushOut(at, c, [q[0] - c[0], q[1] - c[1]], nearness(at, size, other))
  }
  const cyanGlow = (g: GlowSpec) => g.color !== SLOT.sky && cyan(g.color)
  const keptOut = placed.map((glow, i) => {
    const lead = placed[0]
    return i > 0 && (warm(lead.color) || (cyanGlow(lead) && warm(glow.color))) ? { ...glow, at: clearOfLead(glow.at, lead) } : glow
  })
  const glows = keptOut.map((glow, i) => {
    if (i === 0 || !cyanGlow(glow)) return glow
    let at = glow.at
    const warmOnes = keptOut.filter((other, j) => j > 0 && other !== glow && warm(other.color))
    for (const other of warmOnes) at = apart(at, glow.radius, other)
    const near = Math.min(1, ...warmOnes.map((other) => nearness(at, glow.radius, other)))
    return { ...glow, at, gain: glow.gain * lerp(DRAG_OVERLAP_GAIN, 1, smoothstep(0.5, 1, near)) }
  })
  // The dark area slides along the frame's edge from where the line meets it, by the seed's share of the way.
  const slide = DRAG_DARK_SLIDE * darkTurn * Math.min(frame[0], frame[1])
  const darkAt = (angle: number, along: number): ZenithSpec => {
    const z: ZenithSpec = { ...layout.zenith, at: fromP(alongEdge(toP(farEdge(start, angle, frame)), along, frame)), angle: (lineAngle * 180) / Math.PI + 90 }
    z.radius = sizeDark(z)
    return z
  }
  // The sky darkens along the line, leaning a little toward where the seed puts the dark area.
  const skyAngle = lineAngle + 0.6 * darkTurn
  const front = darkAt(lineAngle, slide)
  const dark = toP(farEdge(start, lineAngle, frame))
  const ahead = ((dark[0] - start[0]) * line[0] + (dark[1] - start[1]) * line[1]) / (length * length)
  // Ahead of the light the dark area lies at the edge the line runs toward. When that edge falls behind the
  // light it fades out there, and past DARK_TURN it fades in at the frame's far side from the light instead;
  // it moves while it is invisible, so the picture never jumps.
  const back = ahead > DARK_TURN ? null : darkAt(lineAngle + Math.PI, -slide)
  const zenith: ZenithSpec = back
    ? { ...back, amount: back.amount * smoothstep(DARK_TURN, DARK_TURN - DARK_FADE, ahead) }
    : { ...front, amount: front.amount * smoothstep(DARK_TURN, DARK_TURN + DARK_FADE, ahead) }
  return {
    ...layout,
    glows,
    zenith,
    sky: { ...layout.sky, turn: rampTurn(layout.sky.tilt, lineAngle, frame), line: { from: [drag.from[0], drag.from[1]], to: fromP([start[0] + Math.cos(skyAngle) * length, start[1] + Math.sin(skyAngle) * length]) } },
  }
}

/** How far inside the frame's edges a bloom's middle stays under a dragged line, in frame fractions. */
const DRAG_INSIDE = 0.1
/**
 * A dragged light's reach against its distance outside the frame, so its body comes in over the near edge and
 * the edge glows in the light's own color, not only its pale outer light.
 */
const DRAG_OUTSIDE_REACH = 4
/** How far from a warm dragged lead the other blooms keep, in its reach, and at most in units of sqrt(width * height). */
const DRAG_BODY_CLEAR = 0.6
const DRAG_BODY_CLEAR_MAX = 0.45
/** How far apart a cyan bloom's and a warm bloom's middles stay under a dragged line, in their summed radii. */
const DRAG_APART = 0.6
/** A cyan bloom's strength where it still lies on a warm one under a dragged line. */
const DRAG_OVERLAP_GAIN = 0.45
/** A dragged lead's width / length, from a seed's own draw (narrow beam to round wash). */
const DRAG_ANISO: readonly [number, number] = [1.2, 2.2]
/** How far a dragged line draws a warm bloom toward the frame's point nearest the light. */
const DRAG_WARM_TOWARD_LIGHT = 0.45
/** A dragged cyan lead's reach against the line's: a medium bloom, as without a line, so the warm light shows beside it. */
const CYAN_DRAG_REACH = 0.8
/** How far (degrees) a seed turns the sky's darkening off a dragged line's way, either side. */
const DRAG_DARK_TURN = 25
/** How far along the frame's edge the dark area slides for that turn, in short sides per radian. */
const DRAG_DARK_SLIDE = 2
/** How far behind the light (in line lengths) the edge a line runs toward lies when the dark area moves to the far side. */
const DARK_TURN = -0.05
/** Over how many line lengths of that edge's distance the dark area fades, so it changes slowly as the line moves. */
const DARK_FADE = 0.85

/**
 * A point just past the frame's edge (frame units from its middle, as farEdge gives), moved `along` that
 * edge (positive clockwise, the same units), round corners onto the next edge, and kept as far past it.
 */
function alongEdge(p: readonly number[], along: number, frame: readonly number[]): [number, number] {
  const [hx, hy] = [frame[0] / 2, frame[1] / 2]
  const q = [clamp(p[0], -hx, hx), clamp(p[1], -hy, hy)]
  const past = Math.hypot(p[0] - q[0], p[1] - q[1])
  const perimeter = 4 * (hx + hy)
  // Where q lies on the edge, clockwise from the top-left corner.
  const at =
    q[1] <= -hy + 1e-9 ? q[0] + hx : q[0] >= hx - 1e-9 ? 2 * hx + (q[1] + hy) : q[1] >= hy - 1e-9 ? 2 * hx + 2 * hy + (hx - q[0]) : 4 * hx + 2 * hy + (hy - q[1])
  const s = (((at + along) % perimeter) + perimeter) % perimeter
  const e =
    s < 2 * hx ? [s - hx, -hy] : s < 2 * hx + 2 * hy ? [hx, s - 2 * hx - hy] : s < 4 * hx + 2 * hy ? [hx - (s - 2 * hx - 2 * hy), hy] : [-hx, hy - (s - 4 * hx - 2 * hy)]
  const out = Math.max(Math.hypot(e[0], e[1]), 1e-6)
  return [e[0] + (e[0] / out) * past, e[1] + (e[1] / out) * past]
}

function insideFrame01(at: readonly number[]): [number, number] {
  return [clamp(at[0], DRAG_INSIDE, 1 - DRAG_INSIDE), clamp(at[1], DRAG_INSIDE, 1 - DRAG_INSIDE)]
}

const LUMA: Rgb = [0.2126, 0.7152, 0.0722]
const luminance = (c: readonly number[]) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Warm light: oranges through yellows with real chroma (Yellow, Tan, Orange-red; not Lime, Cyan or Ice). */
export function isWarm(c: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(c)
  return chroma > 0.04 && hue >= 25 && hue <= 105
}

/**
 * A light's body stays near its own hex (Tan reads as Tan, not a pale tint), and its brightness comes from
 * its size and from the core at its source, which rolls toward white (perception-additive-light.md 7.4).
 */
const MIN_LIGHT_GAIN = 0.75
const MAX_LIGHT_GAIN = 1.35
/** Largest linear channel a light's body reaches at its full gain. */
const MAX_BODY = 0.95

/**
 * Gain that puts every light color's body near the same luminance, within its
 * own hex and MAX_LIGHT_GAIN. Green-yellow light has no match in a sky, so the
 * composer keeps it smaller.
 */
export function lightGain(c: Rgb): number {
  const y = luminance(c)
  if (y <= 1e-6) return 0
  // A warm light's body is at least its own hex: below it Yellow reads dark gold.
  const gain = clamp((isGreen(c) ? 0.8 : 0.62) / y, isWarm(c) ? 1 : MIN_LIGHT_GAIN, MAX_LIGHT_GAIN)
  // A saturated light's body also stays below clipping (Orange-red), so it keeps its hue; its core whitens it.
  return Math.min(gain, MAX_BODY / Math.max(c[0], c[1], c[2]))
}

/**
 * Haze for a warm light that should show its own color at its middle. Warm light over blue turns grey-pink
 * where the blue shows through (Tan); red-orange light, which has no green to balance the blue, turns
 * pink, so it hides the sky behind its whole body.
 */
function warmHaze(c: Rgb, u: number): number {
  return linearToOklch(c)[2] < 50 ? lerp(4.8, 5.8, u) : lerp(2.8, 3.6, u)
}

/** Lime-like light: chroma with a hue between yellow and cyan. */
export function isGreen(c: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(c)
  return chroma > 0.04 && hue > 105 && hue < 200
}

/** Cyan-like light; along the bottom edge it reads as a horizon, so it comes from a side. */
function isCyan(c: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(c)
  return chroma > 0.04 && hue >= 200 && hue < 250
}

/** A mid grey of the pack such as Steel: no light of its own, but a color the sky can take on. */
function isGrey(c: Rgb): boolean {
  const [lightness, chroma] = linearToOklch(c)
  return chroma < 0.05 && lightness < 0.8
}

/** A glow that is a light (a light slot whose color is not a pack grey such as Steel), so it has a source. */
export function isSourceLight(slot: number, c: Rgb): boolean {
  return (slot === SLOT.light1 || slot === SLOT.light2) && !isGrey(c)
}

/** A dark color the sky blends into without a third hue between: a grey, or one within 40 degrees of the sky's hue. */
function blendsWithSky(dark: Rgb, sky: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(dark)
  const skyHue = linearToOklch(sky)[2]
  return chroma < 0.05 || Math.abs(((hue - skyHue + 540) % 360) - 180) < 40
}

function hashSeed(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x5bd1e995, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

/** mulberry32; consecutive seeds are hashed first so their first draws are unrelated. */
export function random(seed: number): () => number {
  let t = hashSeed(seed)
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(options: readonly (readonly [T, number])[], u: number): T {
  let acc = 0
  for (const [value, weight] of options) {
    acc += weight
    if (u < acc) return value
  }
  return options[options.length - 1][0]
}

/** Longest half-length of the lead glow, in units of sqrt(width * height) (a 16:9 frame is 1.33 wide). */
const LEAD_MAX_LONG_RADIUS = 1.7

/** 0 at `from`, 1 at `to` (either may be the larger), with no kink at either end. */
function smoothstep(from: number, to: number, t: number): number {
  const x = clamp((t - from) / (to - from), 0, 1)
  return x * x * (3 - 2 * x)
}

export const LOBES = 3
const LOBE_FALLOFF = 2.2
/** Where a bloom's tail has faded out, in radii (the shader's TAIL_END). */
export const TAIL_END = 4.5

export interface Lobes {
  shape: number[]
  falloff: number[]
}

/**
 * The lobes of one extended source, spread along its long axis at different
 * heights across it, each with its own size and falloff. Per lobe: offsets in
 * units of the long and short radius, 1 / size and weight (`shape`), and a
 * falloff factor (`falloff`). With vary 0 they sit on top of each other and
 * make one ellipse. The weights are scaled so the brightest point is about 1.
 */
export function lobes(vary: number, seed: number, index: number): Lobes {
  const r = random(seed * 7919 + index * 131 + 17)
  const raw = Array.from({ length: LOBES }, (_, j) => ({
    along: (j - 1) * 0.55 * vary * lerp(0.7, 1.3, r()),
    across: (r() - 0.5) * 0.9 * vary,
    size: 1 - vary * lerp(0, 0.4, r()),
    weight: j === 1 ? 1 : lerp(0.45, 0.9, r()),
    falloff: 1 + vary * lerp(-0.25, 0.25, r()),
  }))
  const at = (a: number, c: number) =>
    raw.reduce((sum, l) => sum + l.weight * (1 + ((a - l.along) / l.size) ** 2 + ((c - l.across) / l.size) ** 2) ** (-LOBE_FALLOFF * l.falloff), 0)
  const peak = Math.max(at(0, 0), ...raw.map((l) => at(l.along, l.across)))
  return {
    shape: raw.flatMap((l) => [l.along, l.across, 1 / l.size, l.weight / peak]),
    falloff: raw.map((l) => l.falloff),
  }
}

/** Lobe variation of the dark corner, and its index in the lobe seeds (after the glows'). */
export const ZENITH_VARY = 0.8
export const ZENITH_LOBE_INDEX = GLOW_COUNT

/**
 * Share of the frame a dark corner covers at nearly its full color: enough to show as an area, never a
 * blob. One of another hue (Plum, Forest) stays smaller: its blend with the blue is not a clean one.
 */
const CORNER_SHARE: readonly [number, number] = [0.08, 0.15]
/** Under a dragged line a grey or blue dark ground covers a seeded share in this range, from a sliver to a large ground. */
const DRAG_DARK_SHARE: readonly [number, number] = [0.06, 0.38]
const OTHER_HUE_CORNER_SHARE: readonly [number, number] = [0.07, 0.11]

/**
 * About how much of the frame a dark corner covers at 90 % or more of its color: its lobes as the
 * shader adds them (in short-side units), on a coarse grid with a soft threshold, so it changes
 * smoothly with the radius; the warp and the edge's drift are left out.
 */
function cornerCoverage(z: ZenithSpec, aspect: number, radius: number, lobe: Lobes): number {
  const frame = [Math.sqrt(aspect), 1 / Math.sqrt(aspect)]
  const shortUnit = 1 / Math.min(frame[0], frame[1])
  const a = (z.angle * Math.PI) / 180
  const stretch = Math.sqrt(z.aniso)
  const amount = clamp(z.amount, 0, 2)
  const cols = 32
  const rows = 18
  let inside = 0
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const dx = ((i + 0.5) / cols - z.at[0]) * frame[0] * shortUnit
      const dy = ((j + 0.5) / rows - z.at[1]) * frame[1] * shortUnit
      const along = (dx * Math.cos(a) + dy * Math.sin(a)) / (radius * stretch)
      const across = ((-dx * Math.sin(a) + dy * Math.cos(a)) * stretch) / radius
      let k = 0
      for (let n = 0; n < LOBES; n++) {
        const qa = (along - lobe.shape[4 * n]) * lobe.shape[4 * n + 2]
        const qc = (across - lobe.shape[4 * n + 1]) * lobe.shape[4 * n + 2]
        const d2 = qa * qa + qc * qc
        k += lobe.shape[4 * n + 3] * (1 + d2) ** (-z.falloff * lobe.falloff[n]) * Math.exp(-(d2 * d2) / (TAIL_END * TAIL_END))
      }
      inside += smoothstep(0.8, 0.95, Math.min(1, amount * k))
    }
  }
  return inside / (cols * rows)
}

/** The corner's radius scaled so its coverage falls within `share`. */
function sizeCorner(z: ZenithSpec, aspect: number, share: readonly [number, number], lobe: Lobes): number {
  let radius = z.radius
  for (let step = 0; step < 3; step++) {
    const now = cornerCoverage(z, aspect, radius, lobe)
    const goal = clamp(now, share[0], share[1])
    radius *= now <= 1e-4 ? 1.5 : clamp(Math.sqrt(goal / now), 0.7, 1.5)
  }
  return radius
}

/**
 * Height of the lead light, in frame heights from the top, for the shared
 * horizon height (horizon.ts: 1.06 at Horizon 0, 0.27 at Horizon 1): just
 * below the frame at 0 and about 55% down at 1, as the horizon study proposes
 * for Blooms (docs/light/research/horizon-placement.md). Blooms draws no line.
 */
function lightHeight(horizonY: number): number {
  return 0.55 + (horizonY - 0.27) * ((1.04 - 0.55) / (1.06 - 0.27))
}

/**
 * Which light slot leads: the warm light more often than not; with no warm
 * light, the lighter one, since a dark color brightened is not a light (Steel
 * never reaches a light color, so Ice leads in every Atmospheric seed).
 * Green-yellow light leads less often (it has no match in a sky). Cyan is sky
 * light: it leads when the light comes from a side edge or from above, and the
 * warm light leads from below, as a low sun does. Under a cool lead the warm
 * light comes in as a small bloom across the frame, apart from it: cyan and
 * yellow light on top of each other make mint.
 */
function pickLead(colors: readonly Rgb[], u: number, arrangement: Arrangement): { lead: number; other: number } {
  const a = SLOT.light1
  const b = SLOT.light2
  const warmA = isWarm(colors[a])
  const warmB = isWarm(colors[b])
  if (warmA !== warmB) {
    const warm = warmA ? a : b
    const cool = warmA ? b : a
    // Red-orange light (Orange-red) comes in only as the warm bloom beside a cyan lead: as the lead, its
    // large body and second bloom let the blue through and turn pink.
    const redWarm = linearToOklch(colors[warm])[2] < 50
    const coolLeads = redWarm || (isCyan(colors[cool]) ? arrangement === 'side' || arrangement === 'high' : u >= 1 - (isGreen(colors[cool]) ? 0.25 : 0.35))
    return coolLeads ? { lead: cool, other: warm } : { lead: warm, other: cool }
  }
  const lighter = luminance(colors[a]) >= luminance(colors[b]) ? a : b
  const darker = lighter === a ? b : a
  // A grey light (Steel) leads some seeds as an overcast glow, with the paler light (Ice) as the bright bloom
  // beside it, so seeds differ in how much of each the frame shows.
  if (isGrey(colors[darker]) && u < GREY_LEAD_SHARE) return { lead: darker, other: lighter }
  return { lead: lighter, other: darker }
}

/** Share of seeds a grey light (Steel) leads, where the other light is a paler one (Ice). */
const GREY_LEAD_SHARE = 0.5

/**
 * How a seed arranges the light. Every arrangement is one large field of pack light on a sky, from a lead
 * at or beyond an edge or a corner, with the sky darkening away from it across the whole frame; they differ
 * in which edge or corner the light comes from and whether a second light shares the frame.
 */
type Arrangement = 'low' | 'diagonal' | 'side' | 'high' | 'pair'
const ARRANGEMENTS: readonly Arrangement[] = ['low', 'diagonal', 'side', 'high', 'pair']

interface Plan {
  /** The lead's distance from the middle toward its side, in frame widths (low and high end). */
  offset: readonly [number, number]
  /** Added to the shared light height, in frame heights. */
  lift: readonly [number, number]
  /** Shift of the line where the sky is its exact hex, along the sky's direction (frame heights). */
  mid: number
  /** Chance of a second bloom of the lead's color, and its size and strength against the lead. */
  pair: number
  balance: readonly [number, number]
  /** The soft inner bloom sits below the lead instead of above it. */
  innerBelow: boolean
  /**
   * The sky darkens from the lead toward a point at this height, in short sides from the frame's middle
   * (negative is up), and `across` of the lead's own distance from the middle line to its side (0: on the middle
   * line, 1: straight above or below the lead). The lead never comes near it, so the way the light runs never jumps.
   */
  toward: number
  across: number
  /** The share of the frame a grey or blue dark ground covers, against a corner's (CORNER_SHARE): along an edge it is wider. */
  darkScale: number
}

function planFor(arrangement: Arrangement): Plan {
  switch (arrangement) {
    case 'low':
      // The light from the bottom edge, the sky darkening straight up to the top edge.
      return { offset: [0, 0.18], lift: [0.12, 0.24], mid: 0.1, pair: 0.3, balance: [0, 0.6], innerBelow: false, toward: -0.6, across: 1, darkScale: 1.5 }
    case 'diagonal':
      // The light from a lower corner, the sky darkening toward the opposite upper corner.
      return { offset: [0.42, 0.6], lift: [0.1, 0.22], mid: 0.04, pair: 0.2, balance: [0, 0.5], innerBelow: false, toward: -AWAY_UP, across: 0, darkScale: 1 }
    case 'side':
      // The light from a side edge at mid height, the sky darkening toward the other side.
      return { offset: [0.58, 0.7], lift: [-0.3, -0.12], mid: 0.06, pair: 0.25, balance: [0, 0.6], innerBelow: true, toward: -AWAY_UP, across: 0, darkScale: 1.5 }
    case 'high':
      // The light from an upper corner, the sky darkening toward the opposite lower corner.
      return { offset: [0.35, 0.6], lift: [-0.9, -0.72], mid: 0, pair: 0.3, balance: [0, 0.6], innerBelow: true, toward: AWAY_UP, across: 0, darkScale: 1 }
    case 'pair':
      // Two lights from the two lower corners, one a little stronger, the sky darkening straight above the stronger
      // one, so it ends dark in another corner than the diagonal's.
      return { offset: [0.4, 0.58], lift: [0.06, 0.18], mid: 0, pair: 1, balance: [0.6, 0.85], innerBelow: false, toward: -AWAY_UP, across: 1, darkScale: 1 }
    default: {
      const unknown: never = arrangement
      throw new Error(`Unknown arrangement: ${String(unknown)}`)
    }
  }
}

/**
 * The side each arrangement's light comes from in the first run of five seeds; the next run takes the other
 * side, and so on, so a run spreads its lights over both sides and an arrangement that comes back is mirrored.
 */
const ARRANGEMENT_SIDE: Readonly<Record<Arrangement, -1 | 1>> = { low: 1, diagonal: -1, side: 1, high: -1, pair: 1 }

function sideFor(seed: number): -1 | 1 {
  const run = Math.floor((Math.round(seed) - 1) / ARRANGEMENTS.length)
  const side = ARRANGEMENT_SIDE[arrangementFor(seed)]
  return run % 2 === 0 ? side : side === 1 ? -1 : 1
}

/** Seeds come in runs of five; each run takes every arrangement once, in a seeded order, so neighbours differ. */
function arrangementFor(seed: number): Arrangement {
  const n = Math.round(seed) - 1
  const count = ARRANGEMENTS.length
  const r = random(Math.floor(n / count) * 31 + 11)
  const order = ARRANGEMENTS.map((_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return ARRANGEMENTS[order[((n % count) + count) % count]]
}

/** Highest a second bloom's center sits, in frame heights from the top, so it never sits on the top edge. */
const MIN_LEAD_Y = 0.22
/** The inner and far blooms against the lead's radius: small accents beside its large field. */
const ACCENT_SCALE = 0.5
const CYAN_ACCENT_SCALE = 0.7
/** Nearest a cyan lead's middle comes to a side edge from outside, in frame widths. */
const CYAN_EDGE = 0.02

/**
 * The pack composition: one dominant bloom at the shared light height, from
 * the middle of the frame to near a side edge (cyan always higher), a fainter,
 * wider and much softer bloom higher on the same side (cyan light, the pack's
 * grey such as Steel, or a paler patch of sky), and sometimes a second bloom of
 * the same color, a weaker light of the other color or a paler patch of sky on
 * the far side. Under a cool lead the pack's warm light always comes in on the
 * far side. The sky is its exact hex in mid-sky and deepens toward the top
 * edge, all the way to the pack's dark color (Plum, Forest, Slate, Near-black)
 * in the corner away from the light, or only darker in a pack without one.
 * Seeds pick the arrangement, which sets the side and the way the sky darkens,
 * then the place, height, sizes, glow count and which light leads; Softness
 * widens and softens; Rise lifts the light and moves the others with it.
 */
export function composeLayout(colors: readonly Rgb[], seed: number, controls: BloomsControls, aspect: number): BloomsLayout {
  const r = random(seed)
  const soft = clamp(controls.softness, 0, 1)
  // With a dragged line the line alone places the blooms: the tool still sets Horizon from the line's start
  // for the slider's sake, so Horizon is read at its default here and moves nothing.
  const rise = controls.drag ? DRAG_RISE : clamp(controls.rise, 0, 1)
  const arrangement = arrangementFor(seed)
  const plan = planFor(arrangement)
  const { lead, other } = pickLead(colors, r(), arrangement)
  // A cyan light along the bottom edge reads as a horizon (a sea), so it sits higher and comes in level. From
  // an upper corner it is clear of that edge already.
  const cyanLead = isCyan(colors[lead])
  const cyanRaise = cyanLead ? lerp(0.24, 0.32, r()) : 0
  const height = lightHeight(placeHorizon(rise, seed, aspect).y) - (arrangement === 'high' ? 0 : cyanRaise)
  // An unused draw: without it every later choice of each seed would change.
  r()
  const side = sideFor(seed)

  // Softness changes how the light falls off, not how far it reaches: the radius is scaled so the
  // half-brightness extent stays put while the tail gets longer. Rise lifts and widens the light.
  const beta = lerp(3.0, 1.6, soft)
  const sameHalfWidth = Math.sqrt(2 ** (1 / 2.2) - 1) / Math.sqrt(2 ** (1 / beta) - 1)
  // A darker light (Tan, Orange-red) keeps its body near its hex and gets its weight in the frame from a
  // larger glow instead.
  const darkerLight = clamp(Math.sqrt(0.6 / Math.max(luminance(colors[lead]), 1e-4)), 1, 1.35)
  const size = lerp(0.8, 1.2, r()) * lerp(0.95, 1.08, soft) * sameHalfWidth * lerp(0.88, 1.16, rise) * (isGreen(colors[lead]) ? 0.95 : darkerLight)
  const bend = () => lerp(0.04, 0.2, r())

  // Every seed is the same kind of image: one large field of pack light from a lead at or beyond an edge or
  // a corner, filling much of the frame, with the sky darkening away from it. The seed's arrangement
  // (planFor) sets which edge or corner, relative to the shared light height. The Horizon control only
  // moves it: low, it sinks toward the bottom edge as a setting light does. A cyan light stays well clear
  // of the bottom edge, where a warm light may sit.
  const [ux, uy] = [r(), r()]
  const at: [number, number] = [0.5 + side * lerp(plan.offset[0], plan.offset[1], ux), height + lerp(plan.lift[0], plan.lift[1], uy)]
  // A cyan lead is a medium bloom, so its middle stays on or inside a side edge, where the frame shows it.
  if (cyanLead) at[0] = clamp(at[0], CYAN_EDGE, 1 - CYAN_EDGE)
  // The way the light runs: from the lead toward its arrangement's point (Plan.toward). The sky darkens along it.
  const frameP: [number, number] = [Math.sqrt(aspect), 1 / Math.sqrt(aspect)]
  const leadP: [number, number] = [(at[0] - 0.5) * frameP[0], (at[1] - 0.5) * frameP[1]]
  // Over a dark ground (Plum, Forest, Slate) the pair keeps the corner across from the light, which seeds share
  // less there; only a sky that just deepens (Bold) darkens above the pair's stronger light.
  const groundPack = luminance(colors[SLOT.deep1]) > 1e-4
  const across = arrangement === 'pair' && groundPack ? 0 : plan.across
  const awayAngle = Math.atan2(plan.toward - leadP[1], (across - 1) * leadP[0])
  const tilt = lerp(-8, 8, r())
  // How much of the frame the lead takes against the inner bloom: a smaller lead gets a larger cyan or grey
  // bloom and the other way round, so seeds differ in how much of each pack color shows.
  const leadShare = r()
  // A cyan lead stays a medium bloom: as a large field its pale cyan light lies under the warm light beside
  // it, turning Yellow pale and olive and Orange-red pink. In a tall frame it is smaller still, or it would
  // cross the frame and lie under the warm light there (cyan and yellow light together make mint).
  const fieldRadius = lerp(0.5, 0.88, leadShare) * size
  let radius = fieldRadius * (cyanLead ? 0.65 * lerp(0.72, 1, smoothstep(0.5, 1, aspect)) : 1)
  const aniso = lerp(1.6, 2.8, r())
  // The lead stays narrower than the frame, so there is sky beside it for the other blooms.
  radius *= Math.min(1, LEAD_MAX_LONG_RADIUS / (radius * Math.sqrt(aniso)))
  const angle = -side * tilt
  // A grey lead (Steel) is haze at its own hex; brightened, it reads as the paler light (Ice).
  const leadGain = (isGrey(colors[lead]) ? 1 : lightGain(colors[lead])) * lerp(isWarm(colors[lead]) ? 1 : 0.94, 1.06, r())

  const glows: GlowSpec[] = [
    // A warm light hides the sky where it comes from (warmHaze). White or cool light over blue only pales it,
    // so it needs less haze and leaves more of the blue.
    { color: lead, at, radius, aniso, angle, gain: leadGain, beta, haze: isWarm(colors[lead]) ? warmHaze(colors[lead], r()) : lerp(1.8, 2.6, r()), vary: lerp(0.45, 0.85, r()), bend: bend() },
  ]

  // Some seeds get a second bloom of the same light across the frame and higher, with sky between the two
  // (near each other they would merge into one wide pale mass or a band), from much smaller and weaker than
  // the lead to nearly its equal (planFor), so seeds differ in how many blooms there are and how they
  // compare as well as where. Under a cool lead the warm light takes that place across the frame.
  const coolLeadWarmOther = !isWarm(colors[lead]) && isWarm(colors[other])
  if (r() < plan.pair && !coolLeadWarmOther) {
    // In the pair arrangement a second light comes from the other lower corner. Otherwise it is a small
    // accent across the frame and higher; a very light color (Lime, Ice) keeps it clearly the smaller one,
    // as two near-equal pale blooms read as one wide pale mass.
    const nearEqual = plan.balance[0] > 0.5
    const balance = lerp(plan.balance[0], plan.balance[1], r()) * (!nearEqual && linearToOklch(colors[lead])[0] > 0.88 ? 0.45 : 1)
    glows.push({
      color: lead,
      at: nearEqual
        ? [0.5 - side * lerp(plan.offset[0], plan.offset[1], r()), at[1] + lerp(-0.08, 0.04, r())]
        : [clamp(at[0] - side * lerp(0.4, 0.62, r()), 0.06, 0.94), Math.max(MIN_LEAD_Y, Math.min(at[1], 0.8) - lerp(0.06, 0.22, r()))],
      // A light: at its middle at least its own hex, like the lead, so it is the weaker one by its size alone.
      radius: radius * (nearEqual ? lerp(0.6, 0.9, balance) : lerp(0.25, 0.45, balance)) * Math.sqrt(lerp(0.45, 0.9, balance)),
      aniso: lerp(1.6, 2.6, r()),
      angle: -angle * lerp(0.3, 1.0, r()),
      gain: leadGain,
      beta,
      haze: isWarm(colors[lead]) ? warmHaze(colors[lead], r()) * 0.8 : lerp(0.9, 1.4, r()),
      vary: lerp(0.45, 0.85, r()),
      bend: bend(),
    })
  }

  // Higher on the same side, a fainter and wider bloom with its center inside the frame, so the
  // light is a few blooms at different heights and sizes, not one glow on an edge. It changes the
  // sky's color more than its brightness where a light can do that faintly: the other light when
  // it is cyan. Otherwise it is a slightly paler patch of sky: faint green or grey light over blue
  // turns grey-teal or grey, a warm bloom above a cool light would be a second light direction,
  // and a second cyan bloom above a cyan lead would turn the whole sky cyan.
  // Its edge is much softer than the lead's, so the frame has one firm and one very soft edge.
  // A grey of the pack (Steel) takes this place as a patch of haze at its own hex, smaller than the
  // light and partly see-through, so the blue still holds the mid sky around it.
  // A cyan bloom is a bloom, not the sky: rounder and about the lead's size, with blue around it, and
  // smaller in a tall frame, which it would otherwise cross. Under a warm lead it sits on the far side,
  // apart from it: cyan and yellow light on top of each other make mint. Beside a grey lead (Steel) the paler
  // light (Ice) takes this place at full strength, as the bright light in the haze.
  const greyOther = isGrey(colors[other])
  const greyLead = isGrey(colors[lead])
  const innerColor = !isCyan(colors[lead]) && (isCyan(colors[other]) || greyOther || greyLead) ? other : SLOT.sky
  const innerGrey = innerColor === other && greyOther
  const innerCyan = innerColor !== SLOT.sky && isCyan(colors[innerColor])
  const innerSide = innerColor === other && isCyan(colors[other]) && isWarm(colors[lead]) ? -side : side
  const [uSize, uAniso, uGain, uBeta, uHaze] = [r(), r(), r(), r(), r()]
  glows.push({
    color: innerColor,
    // Below a lead that sits high or at a side edge, above it otherwise.
    at: [0.5 + innerSide * lerp(0.05, 0.3, r()), (plan.innerBelow ? lerp(0.86, 0.72, rise) : lerp(0.42, 0.28, rise)) + lerp(-0.05, 0.05, r())],
    // A small accent beside the lead's large field; a cyan one a little larger, so the pack's Cyan shows.
    radius:
      radius *
      (innerCyan ? CYAN_ACCENT_SCALE : ACCENT_SCALE) *
      (innerGrey
        ? lerp(0.6, 0.8, uSize) * lerp(1.3, 0.8, leadShare)
        : innerCyan
          ? lerp(1.0, 1.25, uSize) * lerp(1.45, 0.7, leadShare) * (aspect < 1 ? 0.62 : 1)
          : lerp(1.15, 1.4, uSize)),
    aniso: innerCyan || innerGrey ? lerp(1.7, 2.5, uAniso) : lerp(2.8, 3.8, uAniso),
    angle: -side * lerp(-4, 12, r()),
    gain:
      innerColor === SLOT.sky
        ? lerp(0.25, 0.4, uGain)
        : innerGrey
          ? lerp(1.0, 1.2, uGain)
          : lightGain(colors[innerColor]) * (greyLead ? lerp(1.0, 1.06, uGain) : lerp(0.65, 0.85, uGain)),
    beta: beta * (innerCyan ? lerp(0.75, 0.9, uBeta) : lerp(0.5, 0.6, uBeta)),
    // Enough haze that a light bloom's middle is its own color, not a blend with the blue behind it; the
    // grey patch is thinner, so blue shows through its edges.
    haze: innerGrey ? lerp(1.4, 1.9, uHaze) : innerColor === SLOT.sky ? 0 : lerp(0.9, 1.3, uHaze),
    vary: lerp(0.4, 0.8, r()),
    bend: bend(),
  })

  // The far edge: a smaller light of the other color, or a paler patch of sky, with blue sky
  // between it and the lead. It sits on the opposite side, clearly higher than the lead; when the
  // lead is already high, it sits in the opposite bottom corner instead.
  // A dim green light over the blue turns grey-teal, so a green far light is smaller, rounder and at nearly
  // full strength. Under a cool lead the pack's warm light always comes in here, so the frame still shows it.
  const far = pick<'none' | 'other' | 'sky'>(
    coolLeadWarmOther ? [['other', 1]] : [['none', 0.4], ['other', 0.4], ['sky', 0.2]],
    r(),
  )
  if (far !== 'none' && glows.length < GLOW_COUNT) {
    const farHeight = Math.min(lerp(0.5, 0.72, rise) + lerp(-0.06, 0.06, r()), at[1] - 0.25)
    // It moves from the side edge to the bottom corner as its height drops from 0.48 to 0.36, over a wide
    // part of the Horizon range, so the control moves it and never swaps one place for the other.
    const corner = smoothstep(0.48, 0.36, farHeight)
    // The warm light under a cool lead comes in from the opposite side, below the lead's height but
    // clear of the bottom edge, weaker than the lead and apart from it (cyan and yellow light on top
    // of each other make mint, and its pale halo along the bottom would read as a cyan horizon).
    const warmUnderCool = far === 'other' && coolLeadWarmOther
    const ux = r()
    // The warm light under a cool lead sits in the middle of the sky, about halfway along the way the light
    // runs and off to one side: in the dark end a dim warm light reads olive, and on the cyan it makes mint.
    // A cyan lead is a medium bloom held at a side edge, so under it the warm light sits a third of the way
    // from the lead to the far edge, in every format.
    const midWay = cyanLead ? toEdge(leadP, awayAngle, frameP) * lerp(0.28, 0.42, ux) : lerp(0.5, 0.7, ux)
    const aside = lerp(-0.28, 0.28, r())
    const from = cyanLead ? insideFrame(leadP, frameP) : leadP
    const warmP = [
      from[0] + Math.cos(awayAngle) * midWay - Math.sin(awayAngle) * aside,
      from[1] + Math.sin(awayAngle) * midWay + Math.cos(awayAngle) * aside,
    ]
    const farAt: [number, number] = warmUnderCool
      ? [clamp(warmP[0] / frameP[0] + 0.5, 0.1, 0.9), clamp(warmP[1] / frameP[1] + 0.5, 0.15, 0.88)]
      : [0.5 - side * lerp(lerp(0.6, 0.7, ux), lerp(0.5, 0.62, ux), corner), lerp(farHeight, lerp(1.0, 1.06, ux), corner)]
    const ua = r()
    const farAngle = side * lerp(lerp(-4, 8, ua), lerp(10, 22, ua), corner)
    // From a side edge a very wide shape reads as a streak, so it is rounder there.
    const un = r()
    const farAniso = lerp(lerp(2.6, 3.4, un), lerp(3.6, 4.6, un), corner)
    // The warm light under a cool lead keeps enough of the frame to show as the pack's warm color.
    const farRadius = warmUnderCool ? fieldRadius * lerp(0.5, 0.65, r()) : radius * ACCENT_SCALE * lerp(0.55, 0.72, r())
    // A color the inner bloom already shows (cyan) gets no second bloom; two of them make it the sky.
    const green = isGreen(colors[other])
    if (far === 'other' && innerColor !== other) {
      glows.push({
        color: other,
        at: farAt,
        radius: farRadius * (green ? 0.85 : 1),
        aniso: warmUnderCool ? lerp(2.2, 3.0, r()) : green ? lerp(1.8, 2.4, r()) : farAniso,
        angle: farAngle,
        // A light never sits below its own hex at its middle, however small: dimmed, Yellow reads dark gold, Tan
        // brown and Lime olive.
        gain: lightGain(colors[other]) * lerp(1.0, 1.06, r()),
        beta: beta * lerp(0.85, 0.95, r()),
        // Little haze: a dim light that hides the blue behind it turns grey. The warm bloom under a cool lead
        // and a green far light are lights of their own, so they show their color at their middle.
        haze: warmUnderCool ? warmHaze(colors[other], r()) : green ? lerp(1.2, 1.6, r()) : lerp(0.1, 0.35, r()),
        vary: lerp(0.4, 0.8, r()),
        bend: bend(),
      })
    } else {
      glows.push({
        color: SLOT.sky,
        at: farAt,
        radius: farRadius * lerp(1.05, 1.25, r()),
        aniso: farAniso * lerp(1, 1.1, r()),
        angle: farAngle,
        gain: lerp(0.6, 0.9, r()),
        beta: beta * lerp(0.85, 0.95, r()),
        haze: 0,
        vary: lerp(0.4, 0.8, r()),
        bend: bend(),
      })
    }
  }

  // The sky darkens away from the lead across the whole frame, so the frame runs from the light to the deep
  // sky in one direction: its exact hex sits partway along, beyond it Meta Blue dims 1.2 to 2.3 stops along
  // its own falloff toward deep navy, and it varies slowly by about 4 % everywhere. A small seeded skew keeps
  // the darkening off a straight line.
  // How far the pale light reaches differs by seed, so some frames keep more of the blue and others are pale
  // over most of the frame. It is a draw of its own, so the seed's other choices stay as they were.
  const skew = lerp(-0.2, 0.2, r())
  const paleReach = random(seed * 6151 + 29)()
  const sky: SkySpec = {
    top: lerp(1.2, 2.3, r()),
    mid: lerp(0.52, 0.38, rise) + plan.mid + lerp(-0.08, 0.08, r()) + lerp(SKY_MID_SHIFT[0], SKY_MID_SHIFT[1], paleReach),
    tilt: skew,
    vary: lerp(0.03, 0.05, r()),
    turn: rampTurn(skew, awayAngle, frameP),
    veil: lerp(SKY_VEIL[0], SKY_VEIL[1], paleReach),
  }
  // With dark colors in the pack (Plum and Forest, Slate and Near-black), the corner away from the
  // light deepens all the way to one of them, so the pack's ground shows as an area of its own. A grey
  // or blue dark color (Slate, Near-black) blends with the blue cleanly at any lightness, so it can
  // reach well into the frame; one of another hue (Plum, Forest) stays in a corner that is already
  // dark, so the two meet where both are dark and no lighter purple or teal band runs between them.
  // Where both dark colors blend with the blue (Slate and Near-black), neighbouring seeds take turns at them, so a
  // run of seeds shows both; Plum and Forest stay a seeded draw.
  const firstDark = r() < 0.5
  const bothBlend = [SLOT.deep1, SLOT.deep2].every((d) => luminance(colors[d]) > 1e-4 && blendsWithSky(colors[d], colors[SLOT.sky]))
  const deep = (bothBlend ? Math.round(seed) % 2 === 0 : firstDark) ? SLOT.deep1 : SLOT.deep2
  const darkGround = luminance(colors[deep]) > 1e-4
  const skyFamily = darkGround && blendsWithSky(colors[deep], colors[SLOT.sky])
  // The dark area sits at the frame edge the sky darkens toward, lying along it, as the frame's anchor; its
  // size is set by the share of the frame it covers (sizeCorner).
  // The dark color keeps its own hex under the darker sky, so it shows the pack's ground at its hex over a
  // real share of the frame, not a darker mix that reads as night sky. One of another hue reaches into the
  // frame with the blue darkening where it comes in, so the two still meet dark.
  const darkAt = farEdge(leadP, awayAngle, frameP)
  const darkAngle = (awayAngle * 180) / Math.PI + 90 + lerp(-8, 8, r())
  const zenith: ZenithSpec = darkGround
    ? {
        color: deep,
        at: darkAt,
        radius: lerp(0.62, 0.85, r()) * lerp(0.92, 1.12, soft),
        aniso: lerp(1.6, 2.4, r()),
        angle: darkAngle,
        amount: skyFamily ? lerp(1.6, 2.0, r()) : lerp(1.7, 2.0, r()),
        // One of another hue ends faster, so there is little of the blend between it and the blue.
        falloff: skyFamily ? 1.7 : 2.2,
        hold: 1,
        meet: skyFamily ? 0 : 0.6,
      }
    : {
        color: deep,
        at: farEdge(leadP, awayAngle, frameP, 0.2),
        radius: lerp(0.48, 0.64, r()) * lerp(0.92, 1.12, soft),
        aniso: lerp(1.5, 2.1, r()),
        angle: darkAngle,
        // Seeds differ in how deep the far sky gets, from a slightly darker blue to deep navy.
        amount: lerp(0.12, 0.45, r()),
        falloff: 2.2,
        hold: 0,
        meet: 0,
      }
  const zenithLobes = lobes(ZENITH_VARY, seed, ZENITH_LOBE_INDEX)
  // One of another hue keeps a corner's share along an edge too: wider, its meeting with the blue reads indigo.
  const darkShare: readonly [number, number] = skyFamily ? [CORNER_SHARE[0] * plan.darkScale, CORNER_SHARE[1] * plan.darkScale] : OTHER_HUE_CORNER_SHARE
  const sizeDark = (z: ZenithSpec) => (darkGround ? sizeCorner(z, aspect, darkShare, zenithLobes) : z.radius)
  zenith.radius = sizeDark(zenith)

  const layout: BloomsLayout = {
    glows: glows.slice(0, GLOW_COUNT),
    zenith,
    sky,
    // More daylight is more exposure at the source: the core takes more of the light as Intensity rises.
    core: lerp(0.5, 1.6, Math.max(0, 2 * clamp(controls.intensity, 0, 1) - 1)),
    warp: lerp(0.05, 0.085, r()),
    warpScale: lerp(0.9, 1.35, r()),
    bridge: lerp(0.85, 1.2, soft),
    bridgeFloor: BRIDGE_FLOOR,
    hazeFloor: 1,
    bridgeSky: 1,
  }
  // Under a dragged line the dark area's share of the frame is the seed's own draw, so seeds differ in it there
  // too; one of another hue stays within a corner's share.
  const dragShare = random(seed * 4421 + 7)()
  const dragTarget = skyFamily ? lerp(DRAG_DARK_SHARE[0], DRAG_DARK_SHARE[1], dragShare) : lerp(OTHER_HUE_CORNER_SHARE[0], OTHER_HUE_CORNER_SHARE[1], dragShare)
  const sizeDragDark = (z: ZenithSpec) => (darkGround ? sizeCorner(z, aspect, [dragTarget, dragTarget], zenithLobes) : z.radius * lerp(0.7, 1.6, dragShare))
  const rd = random(seed * 2903 + 5)
  const leadAniso = lerp(DRAG_ANISO[0], DRAG_ANISO[1], rd())
  // Where the other blooms sit under a dragged line: each seed's own places, spread over the frame.
  const spots = Array.from({ length: GLOW_COUNT - 1 }, (): [number, number] => [lerp(0.18, 0.82, rd()), lerp(0.2, 0.8, rd())])
  // Where along the far side the deep sky gathers under a dragged line: the seed turns it off the line's way.
  const darkTurn = (lerp(-DRAG_DARK_TURN, DRAG_DARK_TURN, rd()) * Math.PI) / 180
  const warmSlot = (slot: number) => isWarm(colors[slot])
  const cyanSlot = (slot: number) => isCyan(colors[slot])
  return controls.drag
    ? followDrag(layout, controls.drag, aspect, sizeDragDark, awayAngle, leadAniso, cyanLead ? CYAN_DRAG_REACH : 1, spots, darkTurn, warmSlot, cyanSlot)
    : layout
}
