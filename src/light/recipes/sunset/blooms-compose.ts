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
   * light, reaching the far sky `behind` short sides away (BEHIND_REACH without it). Without one the darkening runs
   * across the frame, turned by `turn`.
   */
  line?: { from: readonly [number, number]; to: readonly [number, number]; behind?: number }
  /**
   * The deep part of the far sky: past an edge of its own it sinks `stops` further, toward deep navy. The edge lies
   * `at` short sides ahead of the light at `from` (frame fractions) along `angle` (degrees, y down), never behind it;
   * `soft` is half its width (short sides) and `curve` how fast it bends round the light toward its sides.
   */
  deep?: { stops: number; at: number; soft: number; curve: number; from: readonly [number, number]; angle: number }
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
  /** 1: light of the sky's own hue (Cyan, a paler patch of sky) dims with the far sky, its middle too. */
  glowsDim: number
  /** 1: pack output (a warm light's core is small and of its own color, and a light's color fills its bloom). */
  packLight: number
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
 * How far the sky pales toward the light, from a seed's own draw: pale light over the sky at the light's side, in
 * units of the sky luminance. The low end keeps more of the blue.
 */
const SKY_VEIL: readonly [number, number] = [0.8, 2.6]
/** Around Yellow in a pack with Cyan (Bold) the sky pales less: a wide pale veil turns the frame cream and pastel. */
const CYAN_VEIL = 0.6
/**
 * The frame along the way the light runs, from a seed's own draws, as shares of the span from the lead (or the near
 * edge) to the far edge: the deep sky's share (most seeds a deep third, DEEP_STRIP_SHARE of them only a strip), the
 * share the lead's body reaches, the least share left between them for the open sky, and where in that open sky
 * the sky is its exact hex. Past its edge the deep sky sinks DEEP_STOPS further, over a half width of DEEP_SOFT
 * (frame heights), and the edge bends round the light by DEEP_CURVE.
 */
const DEEP_SHARE: readonly [number, number] = [0.26, 0.42]
const DEEP_STRIP: readonly [number, number] = [0.06, 0.14]
const DEEP_STRIP_SHARE = 0.2
const BODY_SHARE: readonly [number, number] = [0.4, 0.62]
/** An orange-red sun's body is one wide light, a third of the frame or more, with less deep and open sky beside it. */
const RED_BODY_SHARE: readonly [number, number] = [0.52, 0.68]
const RED_DEEP_SCALE = 0.7
const RED_OPEN_SHARE = 0.12
const MIN_OPEN_SHARE = 0.16
/** Most a lead grows to reach its share. */
const LEAD_GROW = 1.6
const OPEN_MID: readonly [number, number] = [0.35, 0.7]
const CYAN_OPEN_MID: readonly [number, number] = [0.35, 0.55]
/** Most a warm lead beside a near-equal second sun of its color is wider than tall (the pair arrangement). */
const PAIR_MAX_ANISO = 1.6
const DEEP_STOPS: readonly [number, number] = [1.1, 2.0]
const DEEP_SOFT: readonly [number, number] = [0.1, 0.19]
const DEEP_CURVE: readonly [number, number] = [0.25, 0.9]
/**
 * How far the deep sky's way turns from the light's way toward the top of the frame, where the sky is deepest, for a
 * light that is not itself high (from a seed's own draw, as a share of the turn to straight up).
 */
const DEEP_UP: readonly [number, number] = [0.15, 0.45]
/** A light's body: where its falloff (1 + d^2)^-beta is down to this share of its middle. */
const BODY_LEVEL = 0.35
/** Most a lead flattened to fit its share may be wider than tall: flatter, it reads as a streak. */
const MAX_SQUASH_ANISO = 2.6

/** How far (in radii) a falloff with this exponent keeps BODY_LEVEL of its middle. */
function bodyReach(beta: number): number {
  return Math.sqrt(BODY_LEVEL ** (-1 / beta) - 1)
}

/** The shader's stretch of a glow's axes in a frame of this aspect (taller frames get taller, less stretched glows). */
function glowStretch(aspect: number): [number, number] {
  const tall = clamp(((1 / aspect) / 0.5625) ** 0.25, 0.8, 1.5)
  return [1 / Math.sqrt(tall), tall ** -1.5]
}

/** How far a glow's ellipse of one radius reaches from its middle in direction `u`, in units of sqrt(width * height). */
function supportAlong(radius: number, aniso: number, angle: number, u: readonly number[], stretch: readonly number[]): number {
  const a = (angle * Math.PI) / 180
  const long = (radius * Math.sqrt(aniso)) / stretch[0]
  const short = radius / Math.sqrt(aniso) / stretch[1]
  return Math.hypot(long * (u[0] * Math.cos(a) + u[1] * Math.sin(a)), short * (-u[0] * Math.sin(a) + u[1] * Math.cos(a)))
}

/**
 * A glow's radius and width / height with its reach in direction `u` (supportAlong) brought down to at most `reach`.
 * Each axis gives up length by its share of the reach, so the glow flattens along `u` and keeps its extent across it:
 * a light from the bottom edge stays wide, one from a side edge gets rounder.
 */
function squashTo(radius: number, aniso: number, angle: number, u: readonly number[], stretch: readonly number[], reach: number): { radius: number; aniso: number } {
  const a = (angle * Math.PI) / 180
  const c1 = Math.abs(u[0] * Math.cos(a) + u[1] * Math.sin(a)) / stretch[0]
  const c2 = Math.abs(-u[0] * Math.sin(a) + u[1] * Math.cos(a)) / stretch[1]
  let long = radius * Math.sqrt(aniso)
  let short = radius / Math.sqrt(aniso)
  for (let step = 0; step < 6; step++) {
    const [p1, p2] = [(long * c1) ** 2, (short * c2) ** 2]
    const now = Math.sqrt(p1 + p2)
    if (now <= reach * 1.001) break
    const f = reach / now
    long *= f ** (p1 / (p1 + p2))
    short *= f ** (p2 / (p1 + p2))
  }
  return { radius: Math.sqrt(long * short), aniso: clamp(long / short, 1, MAX_SQUASH_ANISO) }
}

/**
 * Where a ray from `p` (units from the frame's middle) in direction `u` enters and leaves the frame, as distances
 * along it; the entry is 0 for a point inside. A ray that misses the frame gets the frame's middle span.
 */
function spanAlong(p: readonly number[], u: readonly number[], frame: readonly number[]): [number, number] {
  let lo = -Infinity
  let hi = Infinity
  for (let i = 0; i < 2; i++) {
    const h = frame[i] / 2
    if (Math.abs(u[i]) < 1e-9) {
      if (Math.abs(p[i]) > h) return [0, Math.min(frame[0], frame[1])]
      continue
    }
    const t1 = (-h - p[i]) / u[i]
    const t2 = (h - p[i]) / u[i]
    lo = Math.max(lo, Math.min(t1, t2))
    hi = Math.min(hi, Math.max(t1, t2))
  }
  if (hi <= Math.max(lo, 0)) return [0, Math.min(frame[0], frame[1])]
  return [Math.max(lo, 0), hi]
}

/**
 * A glow whose body ends before `limit` (a distance from the lead at `leadP` along `away`): it moves back along
 * `away`, but not back past `from` (the end of the lead's body, so it never lands on the lead), and what still
 * reaches past `limit` it gives up by shrinking (unless `shrink` is false), keeping its shape (flattened, it would
 * read as a streak).
 */
function keepBefore(
  glow: GlowSpec,
  leadP: readonly number[],
  away: readonly number[],
  from: number,
  limit: number,
  frame: readonly number[],
  stretch: readonly number[],
  shrink = true,
): GlowSpec {
  const p = [(glow.at[0] - 0.5) * frame[0], (glow.at[1] - 0.5) * frame[1]]
  const along = (p[0] - leadP[0]) * away[0] + (p[1] - leadP[1]) * away[1]
  const toBody = bodyReach(glow.beta)
  const reach = toBody * supportAlong(glow.radius, glow.aniso, glow.angle, away, stretch)
  if (along + reach <= limit) return glow
  const back = Math.max(0, Math.min(along + reach - limit, along - from))
  const moved: GlowSpec = { ...glow, at: [(p[0] - away[0] * back) / frame[0] + 0.5, (p[1] - away[1] * back) / frame[1] + 0.5] }
  const room = limit - (along - back)
  if (room >= reach || !shrink) return moved
  return { ...moved, radius: (glow.radius * Math.max(room, 0.25 * reach)) / reach }
}

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
 * The line sets only the lead and the far dark, so the seed's kind of scene (DragSeed.kind) sets the rest: its
 * second bloom comes in as a second light on one side of the line or lies across the frame as a level band of
 * haze, or the lead lights the frame alone.
 */
function followDrag(
  layout: BloomsLayout,
  drag: NonNullable<BloomsControls['drag']>,
  aspect: number,
  seedDrag: DragSeed,
  warm: (slot: number) => boolean,
  cyan: (slot: number) => boolean,
): BloomsLayout {
  const {
    sizeDark,
    seedAngle,
    leadAniso,
    leadScale,
    fireLead,
    spots,
    darkTurn,
    darkSlide,
    deepReach,
    kind,
    draws,
    companion,
    companionGain,
    band,
    bandGain,
    nearLight,
  } = seedDrag
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
  const toLight = toP(drag.from)
  const awayFromFrame = (toLight[0] * line[0] + toLight[1] * line[1]) / (Math.max(Math.hypot(toLight[0], toLight[1]), 1e-6) * length)
  const outWide = smoothstep(0, OUT_WIDE_AT, outside) * smoothstep(-0.2, 0.6, awayFromFrame)
  // A sun that burns like fire shows its own color only near its middle, so beyond an edge, pointing away, it reaches
  // further to bring its body in as a band; and as far, as a share of the frame, in a wide frame as in a tall one,
  // which stretches a glow along its axis (glowStretch), so a wide frame's range is longer. Farther in a tall frame,
  // its pale outer light lies long over the blue and the cyan, grey and teal.
  const fireOut = fireLead ? outWide : 0
  const wide = smoothstep(0.5, 1, aspect)
  const fireReach = lerp(lerp(OUT_FIRE_REACH_TALL[0], OUT_FIRE_REACH[0], wide), lerp(OUT_FIRE_REACH_TALL[1], OUT_FIRE_REACH[1], wide), draws[6])
  const fromLine = length / DRAG_REACH
  const reach = clamp(Math.max(fromLine, DRAG_OUTSIDE_REACH * lerp(1, fireReach, fireOut) * outside), DRAG_RADIUS[0], DRAG_RADIUS[1]) * leadScale
  // The other blooms' sizes follow the line itself, not how far outside the light is, and stay large enough to show
  // under a short line (rounded where the two meet, so a size has no kink there).
  const besideReach = 0.5 * (fromLine + BESIDE_MIN_REACH + Math.hypot(fromLine - BESIDE_MIN_REACH, REACH_ROUND)) * leadScale
  // The other blooms sit at their seed's own places inside the frame, so the seed still shows in which colors
  // come in, how much of each and where, whatever the line leaves in the frame. A warm one is drawn out of the
  // deep end, where its dim light reads olive: toward the frame's point nearest the light beside a warm lead,
  // toward the middle beside a cool one (on it, cyan and yellow light make mint).
  const target = warm(layout.glows[0].color) ? insideFrame01(drag.from) : [0.5, 0.5]
  // Seen from inside the frame, a light beyond its edge whose line points away from the frame shows only the light
  // behind it: it lights that edge broadly, widest along the edge and fading inward, so the farther outside it is,
  // the wider it grows across the line than along it (a narrow glow's back would come in as a V). A line pointing
  // into the frame brings the glow's body in along the line.
  // A warm light's band there is as wide as the seed draws; another light's stays wide (narrower, a green light's dim
  // edges lie over the blue, olive).
  const outShape = warm(layout.glows[0].color) ? lerp(OUT_WARM_ANISO[0], OUT_WARM_ANISO[1], draws[7]) : OUT_ANISO
  const leadShape = lerp(leadAniso, outShape, outWide)
  // There a fire sun's body is the band it lights along the edge: its lobes lie together, or one that lies off the
  // frame takes the body with it and the band comes in pale.
  const leadVary = lerp(1, OUT_VARY, fireOut)
  // The dark area slides along the frame's edge from where the line meets it, by the seed's share of the way.
  // The edge the line runs toward is found from a point a little in from the light toward the frame's middle,
  // never from on an edge: from a light at an edge, a line turning along that edge would leave the frame first
  // through the far side, then right beside the light, and the dark area would jump between them.
  // Beside a second light it slides the other way, so the two lie apart.
  const darkWay =
    kind === 'left' ? Math.max(Math.abs(darkTurn), BESIDE_DARK_TURN) : kind === 'right' ? -Math.max(Math.abs(darkTurn), BESIDE_DARK_TURN) : darkTurn
  // A long line leaves a long far side to slide along; under a short one the dark would come round beside the light,
  // unless the light is beyond an edge pointing away, where the dark lies at the frame's far side.
  const slideRoom = Math.max(smoothstep(0.3, 1.2, length), outWide)
  const slide = DRAG_DARK_SLIDE * darkSlide * darkWay * Math.min(frame[0], frame[1]) * lerp(SLIDE_SHORT, SLIDE_LONG, slideRoom)
  const held = insideFrame(start, frame)
  const middle = [held[0] * (1 - DARK_FROM_IN), held[1] * (1 - DARK_FROM_IN)]
  const darkAt = (angle: number, along: number): ZenithSpec => {
    const z: ZenithSpec = { ...layout.zenith, at: fromP(alongEdge(toP(farEdge(middle, angle, frame)), along, frame)), angle: (lineAngle * 180) / Math.PI + 90 }
    z.radius = sizeDark(z)
    return z
  }
  // The sky darkens along the line, leaning a little toward where the seed puts the dark area.
  const skyTurn = (DRAG_SKY_TURN * Math.PI) / 180
  const skyAngle = lineAngle + 0.6 * clamp(darkWay, -skyTurn, skyTurn)
  const front = darkAt(lineAngle, slide)
  const dark = toP(farEdge(middle, lineAngle, frame))
  const ahead = ((dark[0] - start[0]) * line[0] + (dark[1] - start[1]) * line[1]) / (length * length)
  // Ahead of the light the dark area lies at the edge the line runs toward. When that edge falls behind the
  // light it fades out there, and past DARK_TURN it fades in at the frame's far side from the light instead;
  // it moves while it is invisible, so the picture never jumps.
  const back = ahead > DARK_TURN ? null : darkAt(lineAngle + Math.PI, -slide)
  const zenith: ZenithSpec = back
    ? { ...back, amount: back.amount * smoothstep(DARK_TURN, DARK_TURN - DARK_FADE, ahead) }
    : { ...front, amount: front.amount * smoothstep(DARK_TURN, DARK_TURN + DARK_FADE, ahead) }
  // A bloom moves out of a warm lead's bright body, so the body keeps the light's own color: on it a second bloom
  // or a cyan one adds up to cream or white. A bloom at e (the body's size is 1) moves straight away from the
  // light's middle to 2e - e^2: one at the body's edge stays, and none moves faster than twice the line, so as the
  // light passes over a bloom it is pushed aside and comes back, and never jumps across.
  const pushOut = (at: [number, number], c: readonly number[], d: readonly number[], e: number): [number, number] =>
    e >= 1 ? at : insideFrame01(fromP([c[0] + d[0] * (2 - e), c[1] + d[1] * (2 - e)]))
  // A second light moves out of a dark ground by as much as the ground shows (it fades out to move to the far side).
  const groundShows = layout.zenith.amount > 0 ? clamp(zenith.amount / layout.zenith.amount, 0, 1) : 0
  const placed = layout.glows.map((glow, i) => {
    if (i === 0) {
      return {
        ...glow,
        at: [drag.from[0], drag.from[1]] as [number, number],
        angle: (lineAngle * 180) / Math.PI,
        aniso: leadShape,
        radius: reach / Math.sqrt(leadShape),
        vary: glow.vary * leadVary,
        // In a tall frame its fade into the blue runs down the frame's whole height, where its pale outer light and the
        // blue weigh the same over a wide band, grey: there it falls off faster. A fire sun's band meets the pale sky
        // behind it instead (`behind` below), so it falls off slower and comes in as deep as in a wide frame.
        beta: glow.beta * lerp(1, lerp(fireLead ? OUT_TALL_FIRE_BETA : OUT_TALL_BETA, 1, wide), outWide),
      }
    }
    const [x, y] = spots[(i - 1) % spots.length]
    const pull = warm(glow.color) ? DRAG_WARM_TOWARD_LIGHT : 0
    // A second bloom of the lead's own color sits in the frame with the lead under a line, where two near-equal lights
    // merge into one pale mass, so it is the smaller one.
    const sameAsLead = glow.color === layout.glows[0].color ? DRAG_PAIR_SCALE : 1
    return { ...glow, at: [lerp(x, target[0], pull), lerp(y, target[1], pull)] as [number, number], angle: glow.angle + degrees, radius: glow.radius * sameAsLead }
  })
  // The seed's second bloom as a second light beside the line, in the frame's half on the seed's side of it, large
  // enough to show as a light of its own: a pale, grey or cyan one out in the far half, where its light stands against
  // the darker sky; a warm or green one between the light and the frame's middle, where the sky is lit (in the deep end
  // its dim light reads olive).
  const u = [line[0] / length, line[1] / length]
  const besideLine = (glow: GlowSpec, sign: number): GlowSpec => {
    const n = [-u[1] * sign, u[0] * sign]
    const out = toEdge([0, 0], Math.atan2(n[1], n[0]), frame) * lerp(BESIDE_OUT[0], BESIDE_OUT[1], draws[0])
    // A cyan one goes out only in a wide frame: in a narrow one, over the deep sky, it dims to teal.
    const out01 = nearLight(glow.color) ? 0 : cyan(glow.color) ? wide : 1
    const aheadRange = [lerp(BESIDE_WARM_AHEAD[0], BESIDE_AHEAD[0], out01), lerp(BESIDE_WARM_AHEAD[1], BESIDE_AHEAD[1], out01)]
    const forward = toEdge([0, 0], Math.atan2(u[1], u[0]), frame) * lerp(aheadRange[0], aheadRange[1], draws[1])
    const size = lerp(BESIDE_SIZE[0], BESIDE_SIZE[1], draws[2]) * besideReach
    return {
      ...glow,
      at: clearOfGround(insideFrame01(fromP([n[0] * out + u[0] * forward, n[1] * out + u[1] * forward])), zenith, frame, groundShows),
      // In a narrow frame the lead's light already fills its width, so there it is smaller still.
      radius: Math.min((cyan(glow.color) ? CYAN_MAX_RADIUS : BESIDE_MAX_RADIUS) * lerp(BESIDE_TALL, 1, wide), Math.max(glow.radius, size)),
      aniso: Math.min(glow.aniso, BESIDE_ANISO),
      gain: companionGain,
    }
  }
  // The seed's last bloom as a level band of haze across the frame at the seed's height, brighter toward the light's
  // side, its edge drifting along its length.
  const stretch = glowStretch(aspect)
  const levelBand = (glow: GlowSpec): GlowSpec => {
    // As long as the frame is wide, and as thick in any frame (tied to the width, it is a thread in a tall one).
    const long = BAND_LONG * frame[0] * stretch[0]
    const short = lerp(BAND_THICK[0], BAND_THICK[1], draws[4]) * stretch[1]
    const aniso = Math.max(1, long / short)
    return {
      ...glow,
      at: [lerp(0.5, insideFrame01(drag.from)[0], BAND_TOWARD_LIGHT), lerp(BAND_Y[0], BAND_Y[1], draws[3])],
      aniso,
      radius: Math.sqrt(long * short),
      angle: lerp(-BAND_TILT, BAND_TILT, draws[5]),
      beta: glow.beta * BAND_SOFT,
      vary: Math.max(glow.vary, BAND_VARY),
      gain: bandGain,
    }
  }
  if (placed.length > 1) {
    switch (kind) {
      case 'alone':
        break
      case 'left':
      case 'right':
        if (companion > 0) placed[companion] = besideLine(placed[companion], kind === 'left' ? -1 : 1)
        break
      case 'band':
        if (band > 0) placed[band] = levelBand(placed[band])
        break
      default: {
        const unknown: never = kind
        throw new Error(`Unknown drag kind: ${String(unknown)}`)
      }
    }
  }
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
  // cyan one is dimmer. A warm lead too: a large cyan bloom's pale light over a sun beyond the edge washes out the
  // warm light it brings in.
  // The lead counts at most DRAG_APART_LEAD: beyond an edge it grows fast as it moves out, and so would the push.
  const nearness = (at: readonly number[], size: number, other: GlowSpec) => {
    const [c, q] = [toP(other.at), toP(at)]
    const otherSize = other === placed[0] ? Math.min(other.radius, DRAG_APART_LEAD) : other.radius
    return Math.hypot(q[0] - c[0], q[1] - c[1]) / (DRAG_APART * (size + otherSize))
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
    const warmOnes = keptOut.filter((other) => other !== glow && warm(other.color))
    for (const other of warmOnes) at = apart(at, glow.radius, other)
    const near = Math.min(1, ...warmOnes.map((other) => nearness(at, glow.radius, other)))
    return { ...glow, at, gain: glow.gain * lerp(DRAG_OVERLAP_GAIN, 1, smoothstep(0.5, 1, near)) }
  })
  // The sky's darkening runs at least SKY_LINE_MIN: under a tiny line it would change fast with every bit of length.
  const skyLength = Math.max(length, SKY_LINE_MIN)
  // Behind a sun beyond an edge pointing away the frame is its lit side: the sky there stays pale as far as its light
  // reaches, so its pale light meets a pale sky and not a darker blue, where the two weigh the same in grey and sage.
  // Not behind a white or grey light (Ice, Steel): there a pale sky is only paler blue.
  const behind = lerp(BEHIND_REACH, Math.max(BEHIND_REACH, (OUT_BEHIND * reach) / Math.min(frame[0], frame[1])), warm(layout.glows[0].color) ? outWide : 0)
  return {
    ...layout,
    glows,
    zenith,
    sky: {
      ...layout.sky,
      turn: rampTurn(layout.sky.tilt, lineAngle, frame),
      line: {
        from: [drag.from[0], drag.from[1]],
        to: fromP([start[0] + Math.cos(skyAngle) * skyLength, start[1] + Math.sin(skyAngle) * skyLength]),
        behind,
      },
      deep: layout.sky.deep
        ? { ...layout.sky.deep, at: (deepReach * skyLength) / Math.min(frame[0], frame[1]), from: [drag.from[0], drag.from[1]], angle: (skyAngle * 180) / Math.PI }
        : undefined,
    },
  }
}

/** How far inside the frame's edges a bloom's middle stays under a dragged line, in frame fractions. */
const DRAG_INSIDE = 0.1
/** Shortest the sky's darkening runs along a dragged line, in frame units. */
const SKY_LINE_MIN = 0.15
/** How far behind a dragged line's start the sky reaches the far sky, in short sides (the shader's default). */
export const BEHIND_REACH = 1
/** Behind a light beyond an edge pointing away, that reach against the light's own (its long radius). */
const OUT_BEHIND = 1.15
/**
 * A dragged light's reach against its distance outside the frame, so its body comes in over the near edge and
 * the edge glows in the light's own color, not only its pale outer light.
 */
const DRAG_OUTSIDE_REACH = 2.6
/** How far round the meeting of the line's reach and a second light's least reach is (units of sqrt(width * height)). */
const REACH_ROUND = 0.1
/** How far from a warm dragged lead the other blooms keep, in its reach, and at most in units of sqrt(width * height). */
const DRAG_BODY_CLEAR = 0.6
const DRAG_BODY_CLEAR_MAX = 0.45
/** How far apart a cyan bloom's and a warm bloom's middles stay under a dragged line, in their summed radii. */
const DRAG_APART = 0.6
/** Largest radius a warm lead counts with there, in units of sqrt(width * height). */
const DRAG_APART_LEAD = 0.6
/** A cyan bloom's strength where it still lies on a warm one under a dragged line. */
const DRAG_OVERLAP_GAIN = 0.45
/**
 * What a seed keeps under a dragged line, where the line alone places the lead and the far dark: its second bloom
 * stays a small accent and the lead lights the frame alone (`alone`), comes in as a second light on one side of the
 * line (`left`, `right`), or its last bloom lies across the frame as a level band of haze (`band`).
 */
type DragKind = 'alone' | 'left' | 'right' | 'band'
const DRAG_KINDS: readonly DragKind[] = ['alone', 'band', 'left', 'right']

/**
 * Seeds come in runs of four for their kind under a line, each run taking every kind once. The kind is the seed's
 * dark style (darkStyleFor) moved on by one per run, so no two of seeds 1-8 have both the same dark and the same kind.
 */
function dragKindFor(seed: number): DragKind {
  const n = Math.round(seed) - 1
  const count = DRAG_KINDS.length
  const run = Math.floor(n / count)
  return DRAG_KINDS[(((DARK_STYLES.indexOf(darkStyleFor(seed)) + run) % count) + count) % count]
}

/** The seed's own choices for a dragged line (composeLayout draws them, followDrag places the scene with them). */
interface DragSeed {
  /** The dark area's radius that covers the seed's share of the frame. */
  sizeDark: (zenith: ZenithSpec) => number
  /** The way the seed's light runs without a line (radians); the other blooms' places turn by its angle to the line. */
  seedAngle: number
  /** The lead's length / width along the line. */
  leadAniso: number
  /** The lead's reach against the line's. */
  leadScale: number
  /** The lead burns like fire (an orange-red sun). */
  fireLead: boolean
  /** The other blooms' places in the frame. */
  spots: readonly (readonly [number, number])[]
  /** How far the dark area turns off the line's way (radians), and how far along the edge it slides for that, 0..1. */
  darkTurn: number
  darkSlide: number
  /** Where along the line the deep sky begins, as a share of its length. */
  deepReach: number
  kind: DragKind
  /**
   * Draws, 0..1: where the second light sits and its size (0-2), the band's height, shape and tilt (3-5), and a lead
   * beyond an edge's reach (6, an orange-red sun) and width (7).
   */
  draws: readonly number[]
  /** Which bloom comes in as the second light beside the line (-1: none), and its strength there. */
  companion: number
  companionGain: number
  /**
   * Which bloom lies across as the band (-1: none): its last one of a haze color, palest first (a patch of sky or Ice,
   * then Cyan, then a grey such as Steel); a warm or green light drawn out level reads as a streak. And its strength.
   */
  band: number
  bandGain: number
  /** A light that stays near the lead as the second light (warm or green: in the deep end its dim light reads olive). */
  nearLight: (slot: number) => boolean
}

/** A dragged lead's length / width along the line, by kind: alone, a broad wash (a warm one stays round); else round. */
const DRAG_ANISO: Readonly<Record<DragKind, readonly [number, number]>> = { alone: [0.75, 0.95], band: [1.1, 1.5], left: [1.05, 1.3], right: [1.05, 1.3] }
/**
 * A second light beside the line: how far out toward the frame's edge on its side it sits (a share of the distance
 * from the frame's middle to that edge), how far along the line from the middle (the same; negative toward the light,
 * a warm one always), and its radius against the line's reach.
 */
const BESIDE_OUT: readonly [number, number] = [0.5, 0.8]
const BESIDE_AHEAD: readonly [number, number] = [0, 0.4]
const BESIDE_WARM_AHEAD: readonly [number, number] = [-0.35, -0.05]
const BESIDE_SIZE: readonly [number, number] = [0.55, 0.75]
/** The least line reach a second light's size counts with, and its largest radius (units of sqrt(width * height)). */
const BESIDE_MIN_REACH = 0.9
const BESIDE_MAX_RADIUS = 0.6
/** That largest radius in a tall frame (9:16) against a wide one's. */
const BESIDE_TALL = 0.7
/** Least turn (radians) of the dark area away from a second light beside the line (DRAG_DARK_SLIDE per radian). */
const BESIDE_DARK_TURN = (25 * Math.PI) / 180
/** Most a second light beside the line is wider than tall: larger, a long one reads as a lozenge. */
const BESIDE_ANISO = 1.4
/** A patch of sky as the second light or the band: its strength at least this, so it shows as pale light. */
const HAZE_SKY_GAIN = 0.7
/** A grey (Steel) band's strength against its own: brightened, a grey reads as the pale light (Ice), a haze. */
const BAND_GREY_GAIN = 1.5
/**
 * How far a light stays from a dark ground's middle, in the ground's radii (its light stops at the ground), and the
 * largest ground radius it counts with (units of the frame's short side).
 */
const GROUND_CLEAR = 1.4
const GROUND_CLEAR_MAX = 0.9
/**
 * A level band of haze: its height (frame heights), half-thickness (units of sqrt(width * height)), half-length against
 * the frame's width, tilt either way (degrees), its falloff exponent against the bloom's own (lower is softer), how
 * much its edge drifts, and how far its middle leans from the frame's middle toward the light.
 */
const BAND_Y: readonly [number, number] = [0.3, 0.7]
const BAND_THICK: readonly [number, number] = [0.1, 0.16]
const BAND_LONG = 0.45
const BAND_TILT = 6
const BAND_SOFT = 0.7
const BAND_VARY = 0.7
const BAND_TOWARD_LIGHT = 0.4
/**
 * Under a dragged line, where the pack's dark colors blend with the blue (Atmospheric), the seed's dark style sets the
 * share of the frame the dark ground covers, and for a strip how long it lies along the edge (width / height).
 */
const DRAG_STYLE_SHARE: Readonly<Record<DarkStyle, readonly [number, number]>> = { none: [0.06, 0.12], strip: [0.05, 0.09], corner: [0.12, 0.2], third: [0.26, 0.38] }
/** The same for a dark ground of another hue (Plum, Forest), which stays smaller. */
const DRAG_OTHER_SHARE: Readonly<Record<DarkStyle, readonly [number, number]>> = { none: [0.04, 0.06], strip: [0.05, 0.08], corner: [0.07, 0.11], third: [0.11, 0.15] }
const STRIP_ANISO: readonly [number, number] = [3, 4]
/**
 * Under a dragged line the seed's dark style sets how far and how deep the sky darkens along it: where the deep sky
 * begins (a share of the line's length), how much of the seed's darkening toward the far end it keeps, and how many of
 * its deep stops.
 */
const DRAG_STYLE_DEEP: Readonly<Record<DarkStyle, readonly [number, number]>> = { none: [0.85, 1.15], strip: [1.1, 1.3], corner: [0.85, 1.0], third: [0.5, 0.65] }
const DRAG_STYLE_TOP: Readonly<Record<DarkStyle, number>> = { none: 0.35, strip: 0.35, corner: 1, third: 1.2 }
const DRAG_STYLE_STOPS: Readonly<Record<DarkStyle, number>> = { none: 0, strip: 0.3, corner: 1, third: 1.25 }
/** Where along the line (1 at its start, 0 at its end) the sky is its exact hex, by dark style (a corner keeps the seed's). */
const DRAG_STYLE_MID: Readonly<Record<DarkStyle, readonly [number, number] | null>> = { none: [0.15, 0.25], strip: [0.12, 0.22], corner: null, third: [0.55, 0.68] }
/** A white or grey lead's haze against its own, by dark style. */
const DRAG_STYLE_HAZE: Readonly<Record<DarkStyle, number>> = { none: 1.6, strip: 1.25, corner: 1, third: 0.75 }
/**
 * A dragged lead outside the frame: its length / width along the line once it is OUT_WIDE_AT (units of
 * sqrt(width * height)) or more past the frame edge (under 1: wider across the line than along it); a warm light's
 * from a seed's own draw.
 */
const OUT_ANISO = 0.45
const OUT_WARM_ANISO: readonly [number, number] = [0.45, 0.8]
const OUT_WIDE_AT = 0.2
/**
 * An orange-red sun there: its reach against another light's (from a seed's own draw, so seeds differ in how deep
 * its band comes in), and its lobe spread against its own (GlowSpec.vary).
 */
const OUT_FIRE_REACH: readonly [number, number] = [1.2, 1.8]
const OUT_FIRE_REACH_TALL: readonly [number, number] = [1.05, 1.55]
/** A lead's falloff there in a tall frame (9:16) against its own, and an orange-red sun's. */
const OUT_TALL_BETA = 1.26
const OUT_TALL_FIRE_BETA = 0.9
const OUT_VARY = 0.25
/** Under a dragged line, a second bloom of the lead's color against its own size. */
const DRAG_PAIR_SCALE = 0.65
/** How far a dragged line draws a warm bloom toward the frame's point nearest the light. */
const DRAG_WARM_TOWARD_LIGHT = 0.45
/** A dragged cyan lead's reach against the line's: a medium bloom, as without a line, so the warm light shows beside it. */
const CYAN_DRAG_REACH = 0.8
/** How far (degrees) a seed turns its dark area off a dragged line's way, either side, sliding it along the far edge. */
const DRAG_DARK_TURN = 35
const DRAG_DARK_TURN_MIN = 15
/** Most (degrees) the sky's darkening turns with it, so its way still follows the line. */
const DRAG_SKY_TURN = 25
/** How far a dark ground of another hue (Plum, Forest) slides, against the full slide: it stays where the sky is dark. */
const OTHER_HUE_SLIDE = 0.4
/**
 * Under a dragged line, the shift of the line where the sky is its exact hex by arrangement, and by how far the seed's
 * sky pales (positive toward the light).
 */
const DRAG_MID: Readonly<Record<Arrangement, number>> = { low: 0.1, diagonal: 0.04, side: 0.06, high: 0, pair: 0 }
const DRAG_MID_SHIFT: readonly [number, number] = [0.16, -0.05]
/**
 * How far along the frame's edge the dark area slides for that turn, in short sides per radian, and that against a
 * line's length: under a short line (0.3 or less, frame units) and a long one (1.2 or more).
 */
const DRAG_DARK_SLIDE = 2
const SLIDE_SHORT = 0.6
const SLIDE_LONG = 1.3
/** How far behind the light (in line lengths) the edge a line runs toward lies when the dark area moves to the far side. */
const DARK_TURN = -0.05
/** Over how many line lengths of that edge's distance the dark area fades, so it changes slowly as the line moves. */
const DARK_FADE = 0.85
/** How far in from the light toward the frame's middle the edge the line runs toward is looked for, 0..1. */
const DARK_FROM_IN = 0.5

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

/**
 * A light's middle moved out of a held dark ground's body (GROUND_CLEAR of its radius, and `shows` of that while the
 * ground fades): a dark ground stands in front of the sky and stops the light behind it, so a light there would not
 * show. It moves toward the frame's middle, by more the deeper in it lies (none at the body's edge), never straight
 * away from the ground's middle: a light passing that middle would swing round to its other side.
 */
function clearOfGround(at: [number, number], z: ZenithSpec, frame: readonly number[], shows = 1): [number, number] {
  if (z.hold < 0.5 || shows <= 0) return at
  const a = (z.angle * Math.PI) / 180
  const short = Math.min(frame[0], frame[1])
  // A ground near a corner resizes fast to keep its share of the frame; the light counts with at most GROUND_CLEAR_MAX
  // of that size, or it would be dragged along.
  const r = Math.min(z.radius, GROUND_CLEAR_MAX) * short
  const c = [(z.at[0] - 0.5) * frame[0], (z.at[1] - 0.5) * frame[1]]
  const q = [(at[0] - 0.5) * frame[0], (at[1] - 0.5) * frame[1]]
  const d = [q[0] - c[0], q[1] - c[1]]
  const along = (d[0] * Math.cos(a) + d[1] * Math.sin(a)) / (r * Math.sqrt(z.aniso))
  const across = ((-d[0] * Math.sin(a) + d[1] * Math.cos(a)) * Math.sqrt(z.aniso)) / r
  const e = Math.hypot(along, across) / (GROUND_CLEAR * shows)
  if (e >= 1) return at
  const toMiddle = Math.max(Math.hypot(c[0], c[1]), 1e-6)
  const push = (1 - e) * (1 - e) * GROUND_CLEAR * shows * r
  return insideFrame01([(q[0] - (c[0] / toMiddle) * push) / frame[0] + 0.5, (q[1] - (c[1] / toMiddle) * push) / frame[1] + 0.5])
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

/** A warm light with little chroma (Tan): a little blue over it turns it grey. */
function isMuted(c: Rgb): boolean {
  return isWarm(c) && linearToOklch(c)[1] < 0.1
}

/** Lime-like light: chroma with a hue between yellow and cyan. */
export function isGreen(c: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(c)
  return chroma > 0.04 && hue > 105 && hue < 200
}

/** Cyan-like light; along the bottom edge it reads as a horizon, so it comes from a side. */
export function isCyan(c: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(c)
  return chroma > 0.04 && hue >= 200 && hue < 250
}

/** A Steel bloom beside an Ice lead: its strength against its hex. */
const STEEL_GAIN: readonly [number, number] = [1.0, 1.25]

/** A mid grey of the pack such as Steel: no light of its own, but a color the sky can take on. */
export function isGrey(c: Rgb): boolean {
  const [lightness, chroma] = linearToOklch(c)
  return chroma < 0.05 && lightness < 0.8
}

/** A near-white light without a color of its own, such as Ice. */
export function isPaleGrey(c: Rgb): boolean {
  const [lightness, chroma] = linearToOklch(c)
  return chroma < 0.05 && lightness >= 0.8
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
    // Red-orange light (Orange-red) always leads, as a sun: beside a cyan lead it would sit alone on the sky as a
    // small bloom and turn pink.
    if (isRed(colors[warm])) return { lead: warm, other: cool }
    const coolLeads = isCyan(colors[cool]) ? arrangement === 'side' || arrangement === 'high' : u >= 1 - (isGreen(colors[cool]) ? 0.25 : 0.35)
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

/** Oklab hue under which a warm light is red-orange (Orange-red, not Yellow or Tan). */
export const RED_HUE = 50

/** Red-orange light (Orange-red): over blue it turns pink, so it meets the sky through its own pale light. */
export function isRed(c: Rgb): boolean {
  return isWarm(c) && linearToOklch(c)[2] < RED_HUE
}

/** A cyan bloom's size beside an orange-red sun, against its usual size. */
const RED_CYAN_SCALE = 0.65
/** An orange-red sun's size, strength at its middle (against its hex) and falloff exponent, against a Yellow one's. */
const RED_SUN_SIZE = 1.6
const RED_SUN_GAIN = 1.0
const RED_SUN_FALLOFF = 0.8

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
      return { offset: [0, 0.18], lift: [0.12, 0.24], pair: 0.3, balance: [0, 0.6], innerBelow: false, toward: -0.6, across: 1, darkScale: 1.5 }
    case 'diagonal':
      // The light from a lower corner, the sky darkening toward the opposite upper corner.
      return { offset: [0.42, 0.6], lift: [0.1, 0.22], pair: 0.2, balance: [0, 0.5], innerBelow: false, toward: -AWAY_UP, across: 0, darkScale: 1 }
    case 'side':
      // The light from a side edge at mid height, the sky darkening toward the other side.
      return { offset: [0.58, 0.7], lift: [-0.3, -0.12], pair: 0.25, balance: [0, 0.6], innerBelow: true, toward: -AWAY_UP, across: 0, darkScale: 1.5 }
    case 'high':
      // The light from an upper corner, the sky darkening toward the opposite lower corner.
      return { offset: [0.35, 0.6], lift: [-0.9, -0.72], pair: 0.3, balance: [0, 0.6], innerBelow: true, toward: AWAY_UP, across: 0, darkScale: 1 }
    case 'pair':
      // Two lights from the two lower corners, one a little stronger, the sky darkening straight above the stronger
      // one, so it ends dark in another corner than the diagonal's.
      return { offset: [0.4, 0.58], lift: [0.06, 0.18], pair: 1, balance: [0.6, 0.85], innerBelow: false, toward: -AWAY_UP, across: 1, darkScale: 1 }
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

/**
 * How much dark a frame holds where the pack's dark colors blend with the blue (Atmospheric): none (light on light:
 * the far side turns to the mid grey, Steel), a strip along the far edge, a corner, or a third.
 */
type DarkStyle = 'none' | 'strip' | 'corner' | 'third'
const DARK_STYLES: readonly DarkStyle[] = ['none', 'strip', 'corner', 'third']
/** Share of the frame the dark ground covers in a strip and in a third. */
const STRIP_GROUND_SHARE: readonly [number, number] = [0.08, 0.12]
const THIRD_GROUND_SHARE: readonly [number, number] = [0.22, 0.32]
/** Light on light: how much of its usual darkening the far sky keeps, and how much larger the Steel bloom is. */
const NONE_TOP = 0.45
const NONE_STEEL = 2
/** A grey lead's haze against a white one's. */
const GREY_LEAD_HAZE = 1.3
/** Light on light with a Steel lead: how much larger its Ice bloom is, as the frame's bright light. */
const NONE_ICE = 1.5
/** Share of those seeds whose light sits in from its edge, and how far toward the middle it moves (0..1). */
const INWARD_SHARE = 0.35
const INWARD = 0.45

/** Seeds come in runs of four for their dark style; each run takes every style once, in a seeded order. */
function darkStyleFor(seed: number): DarkStyle {
  const n = Math.round(seed) - 1
  const count = DARK_STYLES.length
  const r = random(Math.floor(n / count) * 53 + 7)
  const order = DARK_STYLES.map((_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return DARK_STYLES[order[((n % count) + count) % count]]
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
/** Largest radius of a cyan accent bloom, in units of sqrt(width * height). */
const CYAN_MAX_RADIUS = 0.65
/** Nearest a cyan lead's middle comes to a side edge from outside, in frame widths, and in a tall frame (9:16). */
const CYAN_EDGE = 0.02
const CYAN_EDGE_TALL = 0.16
/** A cyan lead's size in a tall frame against a wide one's. */
const CYAN_TALL_SCALE = 0.85
/** Least radius of the warm light under a cool lead, in units of sqrt(width * height). */
const WARM_MIN_RADIUS = 0.3
/** How far in from a tall frame's side edges a light bloom's middle stays (9:16; none from 1:1), in frame widths. */
const TALL_INSET = 0.22
/** A Steel accent's size in a tall frame (9:16) against a wide one's: the narrow frame holds less of it. */
const STEEL_TALL = 1.25
/** An Ice bloom's haze against another light accent's. */
const ICE_HAZE = 1.5
/** How far inside the frame's edges a warm lead's middle stays, in frame fractions. */
const SUN_EDGE = 0.04
/** The same for a muted warm lead (Tan): its color holds only near its middle, where it outweighs the blue. */
const MUTED_SUN_EDGE = 0.12

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
  const cyanPack = isCyan(colors[SLOT.light1]) || isCyan(colors[SLOT.light2])
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
  // An orange-red sun is one wide light, a third of the frame or more.
  const darkerLight = isRed(colors[lead]) ? RED_SUN_SIZE : clamp(Math.sqrt(0.6 / Math.max(luminance(colors[lead]), 1e-4)), 1, 1.35)
  const size = lerp(0.8, 1.2, r()) * lerp(0.95, 1.08, soft) * sameHalfWidth * lerp(0.88, 1.16, rise) * (isGreen(colors[lead]) ? 0.95 : darkerLight)
  const bend = () => lerp(0.04, 0.2, r())

  // Every seed is the same kind of image: one large field of pack light from a lead at or beyond an edge or
  // a corner, filling much of the frame, with the sky darkening away from it. The seed's arrangement
  // (planFor) sets which edge or corner, relative to the shared light height. The Horizon control only
  // moves it: low, it sinks toward the bottom edge as a setting light does. A cyan light stays well clear
  // of the bottom edge, where a warm light may sit.
  // In a pack whose dark colors blend with the blue (Atmospheric) every seed would otherwise be one pale side and one
  // dark side split by a diagonal, so the seed also picks how much dark the frame holds, from none (light on light)
  // to a third, and whether the light sits in from its edge, toward the middle.
  const groundBlends = [SLOT.deep1, SLOT.deep2].every((d) => luminance(colors[d]) > 1e-4 && blendsWithSky(colors[d], colors[SLOT.sky]))
  const darkStyle: DarkStyle = groundBlends ? darkStyleFor(seed) : 'corner'
  const inward = groundBlends && darkStyle !== 'third' && random(seed * 3571 + 13)() < INWARD_SHARE
  const [ux, uy] = [r(), r()]
  const at: [number, number] = [0.5 + side * lerp(plan.offset[0], plan.offset[1], ux) * (inward ? INWARD : 1), height + lerp(plan.lift[0], plan.lift[1], uy)]
  if (inward) at[1] = lerp(at[1], 0.5, INWARD)
  // A cyan lead is a medium bloom, so its middle stays on or inside a side edge, where the frame shows it.
  // A tall frame is narrow, so there it stays further in: on the edge half of it would lie outside the frame.
  const cyanEdge = lerp(CYAN_EDGE_TALL, CYAN_EDGE, smoothstep(0.5, 1, aspect))
  if (cyanLead) at[0] = clamp(at[0], cyanEdge, 1 - cyanEdge)
  // A warm lead is a sun: its middle stays just inside the frame, so its palest part, the core, is in the picture.
  if (isWarm(colors[lead])) {
    const edge = isMuted(colors[lead]) ? MUTED_SUN_EDGE : SUN_EDGE
    at[0] = clamp(at[0], edge, 1 - edge)
    at[1] = clamp(at[1], edge, 1 - edge)
  }
  // The way the light runs: from the lead toward its arrangement's point (Plan.toward). The sky darkens along it.
  const frameP: [number, number] = [Math.sqrt(aspect), 1 / Math.sqrt(aspect)]
  const leadP: [number, number] = [(at[0] - 0.5) * frameP[0], (at[1] - 0.5) * frameP[1]]
  // Over a dark ground of another hue (Plum, Forest) the pair keeps the corner across from the light, which seeds
  // share less there; a sky that just deepens (Bold) or deepens into a dark of its own family (Slate, Near-black)
  // darkens above the pair's stronger light, so the frame lies along the horizontal.
  const groundPack = luminance(colors[SLOT.deep1]) > 1e-4
  const across = arrangement === 'pair' && groundPack && !groundBlends ? 0 : plan.across
  const awayAngle = Math.atan2(plan.toward - leadP[1], (across - 1) * leadP[0])
  const tilt = lerp(-8, 8, r())
  // How much of the frame the lead takes against the inner bloom: a smaller lead gets a larger cyan or grey
  // bloom and the other way round, so seeds differ in how much of each pack color shows.
  const leadShare = r()
  // A cyan lead stays a medium bloom: as a large field its pale cyan light lies under the warm light beside
  // it, turning Yellow pale and olive and Orange-red pink. In a tall frame it is smaller still, or it would
  // cross the frame and lie under the warm light there (cyan and yellow light together make mint).
  const fieldRadius = lerp(0.5, 0.88, leadShare) * size
  let radius = fieldRadius * (cyanLead ? 0.65 * lerp(CYAN_TALL_SCALE, 1, smoothstep(0.5, 1, aspect)) : 1)
  // A wide source lights a broad, rounded field: a long narrow oval reads as a shape.
  let aniso = lerp(1.2, 2.0, r())
  // The lead stays narrower than the frame, so there is sky beside it for the other blooms.
  radius *= Math.min(1, LEAD_MAX_LONG_RADIUS / (radius * Math.sqrt(aniso)))
  const angle = -side * tilt
  // Along the way the light runs, the seed sets where the lead's body ends (the sun's size), where the sky is its
  // exact hex and where the deep sky begins, as shares of the frame's span from the lead (or the near edge, for a
  // lead outside the frame) to the far edge. So seeds differ in how much of the frame the light, the open sky and
  // the deep sky take, and no light's body lies over the deep sky.
  const away: [number, number] = [Math.cos(awayAngle), Math.sin(awayAngle)]
  const [spanNear, spanFar] = spanAlong(leadP, away, frameP)
  const stretch = glowStretch(aspect)
  const rn = random(seed * 7121 + 3)
  const [uDeepSize, uDeepStops, uDeepSoft, uDeepCurve, uBody, uDeepUp] = [rn(), rn(), rn(), rn(), rn(), rn()]
  // The deep sky lies away from the light and toward the top of the frame, unless the light is itself high.
  const toTop = Math.atan2(Math.sin(-Math.PI / 2 - awayAngle), Math.cos(-Math.PI / 2 - awayAngle))
  const deepAngle = awayAngle + (arrangement === 'high' ? 0 : lerp(DEEP_UP[0], DEEP_UP[1], uDeepUp) * toTop)
  const deepDir = [Math.cos(deepAngle), Math.sin(deepAngle)]
  const [deepNear, deepFar] = spanAlong(leadP, deepDir, frameP)
  // An orange-red sun takes more of the way and leaves the deep sky and the open sky less.
  const redSun = isRed(colors[lead])
  // A seed's dark style (blending grounds only) sets the deep sky's size outright.
  const drawnDeep =
    darkStyle === 'strip'
      ? lerp(DEEP_STRIP[0], DEEP_STRIP[1], uDeepSize)
      : darkStyle === 'third'
        ? lerp(DEEP_SHARE[0], DEEP_SHARE[1], uDeepSize)
        : uDeepSize < DEEP_STRIP_SHARE
          ? lerp(DEEP_STRIP[0], DEEP_STRIP[1], uDeepSize / DEEP_STRIP_SHARE)
          : lerp(DEEP_SHARE[0], DEEP_SHARE[1], (uDeepSize - DEEP_STRIP_SHARE) / (1 - DEEP_STRIP_SHARE))
  const deepShare = drawnDeep * (redSun ? RED_DEEP_SCALE : 1)
  const bodyRange = redSun ? RED_BODY_SHARE : BODY_SHARE
  const bodyShare = Math.min(lerp(bodyRange[0], bodyRange[1], uBody), 1 - deepShare - (redSun ? RED_OPEN_SHARE : MIN_OPEN_SHARE))
  const bodyEnd = spanNear + bodyShare * (spanFar - spanNear)
  const deepEdge = spanNear + (1 - deepShare) * (spanFar - spanNear)
  const leadBeta = beta * (isRed(colors[lead]) ? RED_SUN_FALLOFF : 1)
  // The lead's body ends there: a smaller one grows to it (a cyan lead stays a medium bloom), a larger one flattens.
  const leadRadius = radius
  const leadReach = bodyReach(leadBeta) * supportAlong(radius, aniso, angle, away, stretch)
  if (leadReach < bodyEnd) {
    if (!cyanLead) radius *= Math.max(1, Math.min(LEAD_GROW, bodyEnd / leadReach, LEAD_MAX_LONG_RADIUS / (radius * Math.sqrt(aniso))))
  } else {
    const fitted = squashTo(radius, aniso, angle, away, stretch, bodyEnd / bodyReach(leadBeta))
    radius = fitted.radius
    aniso = fitted.aniso
  }
  // Beside a near-equal second sun of its own warm color (the pair arrangement) a wide lead reaches across under it,
  // and where the two lie on each other they add up to a pale wash: its long axis is held to PAIR_MAX_ANISO times
  // its short one.
  const twoSuns = arrangement === 'pair' && isWarm(colors[lead]) && !isRed(colors[lead])
  if (twoSuns && aniso > PAIR_MAX_ANISO) {
    radius *= Math.sqrt(PAIR_MAX_ANISO / aniso)
    aniso = PAIR_MAX_ANISO
  }
  const leadEnd = Math.min(bodyEnd, bodyReach(leadBeta) * supportAlong(radius, aniso, angle, away, stretch))
  // A grey lead (Steel) is haze at its own hex; brightened, it reads as the paler light (Ice). An orange-red sun
  // is well over its own hex at its middle, which the tone curve takes through amber to cream.
  const leadGain = (isGrey(colors[lead]) ? 1 : lightGain(colors[lead]) * (isRed(colors[lead]) ? RED_SUN_GAIN : 1)) * lerp(isWarm(colors[lead]) ? 1 : 0.94, 1.06, r())

  const glows: GlowSpec[] = [
    // A warm light hides the sky where it comes from (warmHaze). White or cool light over blue only pales it,
    // so it needs less haze and leaves more of the blue.
    {
      color: lead,
      at,
      radius,
      aniso,
      angle,
      gain: leadGain,
      // An orange-red sun falls off slowly, so its dim end is a long way out.
      beta: leadBeta,
      // A grey lead (Steel) hides more of the blue behind it, or its light over the blue reads as paler blue, not grey.
      haze: isWarm(colors[lead]) ? warmHaze(colors[lead], r()) : lerp(1.8, 2.6, r()) * (isGrey(colors[lead]) ? GREY_LEAD_HAZE : 1),
      vary: lerp(0.45, 0.85, r()),
      bend: bend(),
    },
  ]

  // Some seeds get a second bloom of the same light across the frame and higher, with sky between the two
  // (near each other they would merge into one wide pale mass or a band), from much smaller and weaker than
  // the lead to nearly its equal (planFor), so seeds differ in how many blooms there are and how they
  // compare as well as where. Under a cool lead the warm light takes that place across the frame.
  const coolLeadWarmOther = !isWarm(colors[lead]) && isWarm(colors[other])
  if (r() < plan.pair && !coolLeadWarmOther && !isRed(colors[lead])) {
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
      aniso: lerp(1.2, 1.9, r()),
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
  // A grey of the pack (Steel) takes this place as a light of its own, smaller than the lead, where the sky is darker
  // than Steel, so it reads as light paling toward white at its middle; over the pale sky near the lead its haze
  // made a grey patch. The blue still holds the mid sky around it.
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
  // Beside an orange-red sun a cyan bloom stays small and well apart: cyan light on Orange-red turns it pink.
  const redApart = isRed(colors[lead]) && innerCyan
  const [uSize, uAniso, uGain, uBeta, uHaze] = [r(), r(), r(), r(), r()]
  const [uInnerX, uInnerY] = [r(), r()]
  // A Steel bloom sits in the darker blue just before the deep sky, off the light's way: there its light, at Steel's
  // own lightness, is lighter than the sky round it. Other inner blooms sit below a lead that is high or at a side
  // edge, above it otherwise.
  const steelAlong = leadEnd + lerp(0.7, 0.92, uInnerY) * (deepEdge - leadEnd)
  const steelAcross = lerp(-0.35, 0.35, uInnerX)
  const steelAt: [number, number] = [
    clamp((leadP[0] + away[0] * steelAlong - away[1] * steelAcross) / frameP[0] + 0.5, 0.12, 0.88),
    clamp((leadP[1] + away[1] * steelAlong + away[0] * steelAcross) / frameP[1] + 0.5, 0.15, 0.85),
  ]
  // A cyan bloom stays an accent: larger, its pale light covers the middle of the frame and the deep sky turns teal.
  const innerCap = innerCyan ? CYAN_MAX_RADIUS : Infinity
  // A cyan bloom is larger beside a smaller lead (leadShare). In a tall frame it follows the lead's size before the lead
  // grew to its share of the frame: beside a small lead grown large it would fill the narrow frame's sky.
  const innerBase = innerCyan ? lerp(Math.min(radius, leadRadius), radius, smoothstep(0.5, 1, aspect)) : radius
  glows.push({
    color: innerColor,
    at: innerGrey
      ? steelAt
      : [0.5 + innerSide * lerp(redApart ? 0.25 : 0.05, 0.3, uInnerX), (plan.innerBelow ? lerp(0.86, 0.72, rise) : lerp(0.42, 0.28, rise)) + lerp(-0.05, 0.05, uInnerY)],
    // A small accent beside the lead's large field; a cyan one a little larger, so the pack's Cyan shows.
    radius: Math.min(
      innerCap,
      innerBase *
        (innerCyan ? CYAN_ACCENT_SCALE : ACCENT_SCALE) *
        (innerGrey
          ? lerp(0.6, 0.8, uSize) * lerp(1.3, 0.8, leadShare) * (darkStyle === 'none' ? NONE_STEEL : 1) * lerp(STEEL_TALL, 1, smoothstep(0.5, 1, aspect))
          : innerCyan
            ? lerp(1.0, 1.25, uSize) * lerp(1.45, 0.7, leadShare) * (aspect < 1 ? 0.62 : 1) * (redApart ? RED_CYAN_SCALE : 1)
            : lerp(1.15, 1.4, uSize) * (greyLead && darkStyle === 'none' ? NONE_ICE : 1)),
    ),
    aniso: innerCyan || innerGrey ? lerp(1.2, 1.8, uAniso) : lerp(1.8, 2.8, uAniso),
    angle: -side * lerp(-4, 12, r()),
    gain:
      innerColor === SLOT.sky
        ? lerp(0.25, 0.4, uGain)
        : innerGrey
          ? lerp(STEEL_GAIN[0], STEEL_GAIN[1], uGain)
          : lightGain(colors[innerColor]) * (greyLead ? lerp(1.0, 1.06, uGain) : lerp(0.65, 0.85, uGain)),
    beta: beta * (innerCyan ? lerp(0.75, 0.9, uBeta) : lerp(0.5, 0.6, uBeta)),
    // Enough haze that a light bloom's middle is its own color, not a blend with the blue behind it; the
    // grey patch is thinner, so blue shows through its edges.
    // Beside a sun a cyan bloom is the frame's Cyan, so its middle hides the pale sky behind it and stays Cyan.
    // Ice hides more: over the pale sky its light without color of its own reads as paler blue.
    haze: innerGrey
      ? lerp(0.8, 1.2, uHaze)
      : innerColor === SLOT.sky
        ? 0
        : innerCyan && isWarm(colors[lead])
          ? lerp(1.7, 2.2, uHaze)
          : lerp(0.9, 1.3, uHaze) * (isPaleGrey(colors[innerColor]) ? ICE_HAZE : 1),
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
    const farAniso = lerp(lerp(1.8, 2.4, un), lerp(2.4, 3.0, un), corner)
    // The warm light under a cool lead keeps enough of the frame to show as the pack's warm color, as a round soft
    // light: narrow and firm-edged it reads as a lozenge.
    // In a tall frame it keeps at least WARM_MIN_RADIUS, or the narrow frame holds too little of it.
    const farRadius = warmUnderCool ? Math.max(WARM_MIN_RADIUS, fieldRadius * lerp(0.5, 0.65, r())) : radius * ACCENT_SCALE * lerp(0.55, 0.72, r())
    // A color the inner bloom already shows (cyan) gets no second bloom; two of them make it the sky.
    const green = isGreen(colors[other])
    if (far === 'other' && innerColor !== other) {
      glows.push({
        color: other,
        at: farAt,
        radius: farRadius * (green ? 0.85 : 1),
        aniso: warmUnderCool ? lerp(1.0, 1.25, r()) : green ? lerp(1.3, 1.8, r()) : farAniso,
        angle: farAngle,
        // A light never sits below its own hex at its middle, however small: dimmed, Yellow reads dark gold, Tan
        // brown and Lime olive.
        gain: lightGain(colors[other]) * lerp(1.0, 1.06, r()),
        beta: beta * (warmUnderCool ? lerp(0.75, 0.85, r()) : lerp(0.85, 0.95, r())),
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
  // The sky is its exact hex partway between the end of the lead's body and the deep edge; the sky ramp runs one
  // frame height per unit of the ramp, from the frame's middle (vSky in the shader).
  const rampAt = (distance: number) => 0.5 - (leadP[0] * away[0] + leadP[1] * away[1] + distance) / frameP[1]
  const uMid = r()
  // In a pack with cyan light the sky reaches its exact hex nearer the light: farther out, its pale veil and the cyan
  // bloom turn most of the frame pastel.
  const openMid = cyanPack ? CYAN_OPEN_MID : OPEN_MID
  const midDistance = leadEnd + lerp(openMid[0], openMid[1], uMid) * (deepEdge - leadEnd)
  // Along a dragged line the ramp runs from the line's start (1) to its end (0) instead, so its exact hex sits at a
  // share of the line from the seed's arrangement.
  const dragMid = lerp(0.52, 0.38, rise) + DRAG_MID[arrangement] + lerp(-0.08, 0.08, uMid) + lerp(DRAG_MID_SHIFT[0], DRAG_MID_SHIFT[1], paleReach)
  const skyTop = lerp(1.2, 2.3, r())
  const sky: SkySpec = {
    // Light on light: the far sky only darkens a little, to Meta Blue, and has no deep part.
    top: skyTop * (darkStyle === 'none' ? NONE_TOP : 1),
    mid: rampAt(midDistance),
    tilt: skew,
    vary: lerp(0.03, 0.05, r()),
    turn: rampTurn(skew, awayAngle, frameP),
    veil: lerp(SKY_VEIL[0], SKY_VEIL[1], paleReach) * (cyanPack && !redSun ? CYAN_VEIL : 1),
    deep: {
      stops: darkStyle === 'none' ? 0 : lerp(DEEP_STOPS[0], DEEP_STOPS[1], uDeepStops),
      at: (deepNear + (1 - deepShare) * (deepFar - deepNear)) / Math.min(frameP[0], frameP[1]),
      soft: lerp(DEEP_SOFT[0], DEEP_SOFT[1], uDeepSoft),
      curve: lerp(DEEP_CURVE[0], DEEP_CURVE[1], uDeepCurve),
      from: [at[0], at[1]],
      angle: (deepAngle * 180) / Math.PI,
    },
  }
  // No other light's body lies over the deep sky: one that reaches past the deep edge moves back toward the lead, and a
  // warm or green one gives up what still reaches past by shrinking (its dim light over the navy reads olive or dark
  // gold). Cyan, Ice and Steel only move back: smaller they barely show, and over the navy cyan dims to teal, so the
  // deep sky never goes dark. A paler patch of sky only dims there with the sky, so it stays. A dragged line places the
  // blooms anew, so it keeps their own sizes.
  const seedGlows = glows.slice()
  for (let i = 1; i < glows.length; i++) {
    if (sky.deep && sky.deep.stops > 0 && glows[i].color !== SLOT.sky) {
      const c = colors[glows[i].color]
      glows[i] = keepBefore(glows[i], leadP, away, leadEnd, deepEdge, frameP, stretch, isWarm(c) || isGreen(c))
      // The warm light under a cyan lead is the frame's only warm light: it keeps enough size to show.
      if (cyanLead && coolLeadWarmOther && glows[i].color === other) glows[i] = { ...glows[i], radius: Math.max(glows[i].radius, WARM_MIN_RADIUS) }
    }
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
  // Light on light: the far side turns to the pack's mid grey (Steel) instead of a dark ground.
  const noDark = darkStyle === 'none' && isGrey(colors[SLOT.light2])
  const deep = noDark ? SLOT.light2 : (bothBlend ? Math.round(seed) % 2 === 0 : firstDark) ? SLOT.deep1 : SLOT.deep2
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
  const cornerShare: readonly [number, number] = [CORNER_SHARE[0] * plan.darkScale, CORNER_SHARE[1] * plan.darkScale]
  const darkShare: readonly [number, number] = skyFamily
    ? darkStyle === 'strip'
      ? STRIP_GROUND_SHARE
      : darkStyle === 'third'
        ? THIRD_GROUND_SHARE
        : cornerShare
    : OTHER_HUE_CORNER_SHARE
  const sizeDark = (z: ZenithSpec) => (darkGround ? sizeCorner(z, aspect, darkShare, zenithLobes) : z.radius)
  zenith.radius = sizeDark(zenith)
  // A light bloom moves out of a held ground's body, or it would not show (Ice beside a Steel far side). A tall frame is
  // narrow, so there a light bloom also keeps in from the side edges, or most of it lies outside the frame.
  const tallInset = TALL_INSET * (1 - smoothstep(0.5, 1, aspect))
  for (let i = 1; i < glows.length; i++) {
    if (glows[i].color === SLOT.sky) continue
    const at = clearOfGround(glows[i].at, zenith, frameP)
    glows[i] = { ...glows[i], at: [clamp(at[0], tallInset, 1 - tallInset), at[1]] }
  }

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
    glowsDim: 1,
    packLight: 1,
  }
  // Under a dragged line the dark area's share of the frame is the seed's own draw, so seeds differ in it there
  // too; one of another hue stays within a corner's share.
  // Where the dark colors blend with the blue (Atmospheric), the seed's dark style holds under a line too; one of another
  // hue (Plum, Forest) takes a share by the style as well, from an accent to a large ground where the sky is deep.
  const dragShare = random(seed * 4421 + 7)()
  const styleShare = groundBlends ? DRAG_STYLE_SHARE[darkStyle] : DRAG_DARK_SHARE
  const otherShare = DRAG_OTHER_SHARE[darkStyleFor(seed)]
  const dragTarget = skyFamily ? lerp(styleShare[0], styleShare[1], dragShare) : lerp(otherShare[0], otherShare[1], dragShare)
  const sizeDragDark = (z: ZenithSpec) => (darkGround ? sizeCorner(z, aspect, [dragTarget, dragTarget], zenithLobes) : z.radius * lerp(0.7, 1.6, dragShare))
  const kind = dragKindFor(seed)
  const rd = random(seed * 2903 + 5)
  // A warm or green lead stays round: as a broad wash its pale outer light lies over the blue and the cyan, grey and
  // green, and over a dark ground of another hue, mauve.
  const anisoRange = kind === 'alone' && (isWarm(colors[lead]) || isGreen(colors[lead])) ? DRAG_ANISO.band : DRAG_ANISO[kind]
  const leadAniso = lerp(anisoRange[0], anisoRange[1], rd())
  // Where the other blooms sit under a dragged line: each seed's own places, spread over the frame.
  const spots = Array.from({ length: GLOW_COUNT - 1 }, (): [number, number] => [lerp(0.18, 0.82, rd()), lerp(0.2, 0.8, rd())])
  // Where along the far side the dark area sits under a dragged line: the seed turns it off the line's way, clearly to
  // one side or the other (near the line's way the far sides of most seeds would be alike).
  const turnDraw = lerp(-1, 1, rd())
  const darkTurn = (Math.sign(turnDraw) * lerp(DRAG_DARK_TURN_MIN, DRAG_DARK_TURN, Math.abs(turnDraw)) * Math.PI) / 180
  // How far along a dragged line the deep sky begins, as a share of its length, and how deep and how far the sky
  // darkens: in every pack the seed's dark style sets them, as far as the pack allows. Without a dark ground a deeper
  // sky turns grey, so there the style only lightens it. A dark ground of another hue (Plum, Forest) meets the blue
  // only where the sky is already dark, so there the sky stays the seed's own.
  const dragStyle = darkStyleFor(seed)
  // Without a ground, a warm lead keeps the seed's own sky too: a sun's wide light over a pale sky leaves only cream.
  const otherHueGround = darkGround && !skyFamily
  const ownSky = otherHueGround || (!darkGround && isWarm(colors[lead]))
  const styleMid = ownSky ? null : DRAG_STYLE_MID[dragStyle]
  // A large ground of another hue (a third) needs the deeper sky, so the two still meet where both are dark.
  const styleDarkens = groundBlends || (!darkGround && !ownSky && DRAG_STYLE_TOP[dragStyle] < 1) || (otherHueGround && dragStyle === 'third')
  const deepRange = DRAG_STYLE_DEEP[styleDarkens ? dragStyle : 'corner']
  const deepReach = lerp(deepRange[0], deepRange[1], rd())
  const dragSky: SkySpec = {
    ...layout.sky,
    mid: styleMid ? lerp(styleMid[0], styleMid[1], uMid) : dragMid,
    top: skyTop * (styleDarkens ? DRAG_STYLE_TOP[dragStyle] : 1),
    deep: layout.sky.deep
      ? { ...layout.sky.deep, stops: lerp(DEEP_STOPS[0], DEEP_STOPS[1], uDeepStops) * (styleDarkens ? DRAG_STYLE_STOPS[dragStyle] : 1) }
      : undefined,
  }
  const rk = random(seed * 5381 + 23)
  const draws = Array.from({ length: 8 }, () => rk())
  // A strip of dark lies long along the frame's edge, a low band.
  const stripGround = (groundBlends || otherHueGround) && dragStyle === 'strip'
  const dragZenith = stripGround ? { ...zenith, aniso: lerp(STRIP_ANISO[0], STRIP_ANISO[1], rk()) } : zenith
  const pale = (slot: number) => isPaleGrey(colors[slot])
  // A white or grey lead (Ice, Steel) hides more of the sky behind it where the seed's far side is light and less where
  // it is dark, so seeds differ in how much of the blue shows.
  const leadHaze = pale(lead) || isGrey(colors[lead]) ? DRAG_STYLE_HAZE[dragStyle] : 1
  const dragGlows = seedGlows.slice(0, GLOW_COUNT).map((g, i) => (i === 0 ? { ...g, haze: g.haze * leadHaze } : g))
  // The second light is the seed's other light: a pale one (Ice) or Cyan, then a light of another color, then one of
  // the lead's color (two suns of one color flood the frame with it), then a patch of sky; never a grey (Steel), whose
  // light over the blue barely shows.
  // Beside a dark ground of another hue (Plum, Forest) a brightened patch of sky reads as pale blue and lavender, so there
  // it is neither the second light nor the band.
  const skyRank = (rank: number) => (otherHueGround ? 0 : rank)
  const lightRank = (slot: number) =>
    slot === SLOT.sky ? skyRank(1) : isGrey(colors[slot]) ? 0 : pale(slot) || isCyan(colors[slot]) ? 4 : slot === dragGlows[0].color ? 2 : 3
  // Beside a warm lead a cyan band crosses its pale light, teal and mint.
  const hazeRank = (slot: number) =>
    slot === SLOT.sky ? skyRank(3) : pale(slot) ? 3 : isCyan(colors[slot]) ? (isWarm(colors[lead]) ? 0 : 2) : isGrey(colors[slot]) ? 1 : 0
  const best = (rank: (slot: number) => number) =>
    dragGlows.reduce((at, g, i) => (i > 0 && rank(g.color) > 0 && (at < 0 || rank(g.color) >= rank(dragGlows[at].color)) ? i : at), -1)
  const companion = best(lightRank)
  const band = best(hazeRank)
  const hazeGain = (i: number) => {
    const g = dragGlows[i]
    return g.color === SLOT.sky ? Math.max(g.gain, HAZE_SKY_GAIN) : isGrey(colors[g.color]) ? g.gain * BAND_GREY_GAIN : g.gain
  }
  const warmSlot = (slot: number) => isWarm(colors[slot])
  const cyanSlot = (slot: number) => isCyan(colors[slot])
  return controls.drag
    ? followDrag(
        { ...layout, glows: dragGlows, zenith: dragZenith, sky: dragSky },
        controls.drag,
        aspect,
        {
          sizeDark: sizeDragDark,
          seedAngle: awayAngle,
          leadAniso,
          leadScale: cyanLead ? CYAN_DRAG_REACH : 1,
          fireLead: redSun,
          spots,
          darkTurn,
          darkSlide: otherHueGround ? OTHER_HUE_SLIDE : 1,
          deepReach,
          kind,
          draws,
          companion,
          companionGain: companion < 0 ? 0 : dragGlows[companion].color === SLOT.sky ? Math.max(dragGlows[companion].gain, HAZE_SKY_GAIN) : dragGlows[companion].gain,
          band,
          bandGain: band > 0 ? hazeGain(band) : 0,
          nearLight: (slot: number) => isWarm(colors[slot]) || isGreen(colors[slot]),
        },
        warmSlot,
        cyanSlot,
      )
    : layout
}
