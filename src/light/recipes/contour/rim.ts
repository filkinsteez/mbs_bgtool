import type { ColorPack } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import type { ComposeInput, Composition, ParamSpec, ParamValue, RecipeContext, RecipeDefinition } from '../../scene'
import {
  blockPlan,
  curveRoles,
  dimShare,
  dragLight,
  flatRadius,
  frameSize,
  geo,
  lerp,
  logoPartsShown,
  longestRun,
  normalNear,
  offFrameGlow,
  offFrameSpread,
  paleBridge,
  pickWeighted,
  pointAlong,
  pointsNearFrame,
  productionParts,
  round4,
  seededRandom,
  toFrame,
  visiblePath,
  visibleRuns,
  warmDrift,
  warmToe,
} from './curveCompose'
import {
  airParams,
  buildShape,
  curveLightGlsl,
  curveLightUniforms,
  driftParams,
  farParams,
  farScatter,
  lightParams,
  nearParams,
  readAir,
  readDrift,
  readFar,
  readLights,
  readNear,
  SHAPE_KINDS,
  shapeKindAt,
  slotColor,
  type CurveLightLayout,
  type EmissionStop,
  type EmitterSettings,
  type ShapeKind,
  type ShapeSettings,
} from './curveLight'
import { META_LOGO_LANDMARKS, META_LOGO_PARTS, primitiveLength, primitivePoint, primitiveTangent, windingNumber, type Primitive, type Shape, type Vec2 } from './shapes'

const COLORS = 8
const STOPS = 6
/** How much of a line, from its bright end, keeps the light's own color before it turns (lineHues). */
const LINE_HUE_HOLD = 0.2
/** Color slots of a line's colors after the light's own (lineHues). */
const LINE_HUE_SLOTS = [4, 7, 8]
/**
 * How strongly a logo crop's edges face a dragged line's way. An edge turned fully away keeps 1 minus this of the
 * light; at 0.85, crops whose edges all ran along the line went nearly black (SHARED.md, 2026-11-05 11:22 AM).
 */
const DRAG_LOGO_FACING = 0.4
const FACING_POWER = 1.5
/**
 * A turning line's flame (contour-light-line): its glow beside the core is about as bright as the core and some 70 px
 * wide at half the peak three quarters of the way down a 9:16 frame 925 px wide, as the reference's (64 to 85 px; it
 * was 7 to 25). The glow is FLAME_WIDTH wide and grows FLAME_GROW (times, and to the power of the light along the
 * line) toward the bright end; it fades faster than the core along the line, so at the dim end only the thin line is
 * left. The haze grows by FLAME_HAZE_GROW. Both sides alike: the color is summed along the line (clSegmentLit), so
 * the light's own color fades into the next without an edge.
 */
const FLAME_WIDTH = 0.022
const FLAME_GROW = [0.8, 1]
const FLAME_HAZE_GROW = [2, 2]
const FLAME_WEIGHT = 1
const FLAME_HAZE = 0.18
/** How far (short sides) the two sides of a turning line's glow reach across it into each other. */
const FLAME_SIDE_SOFT = 0.02
/**
 * No light on a pinch point (the owner, 2026-11-09): where an outline turns more than TIP_TURN within TIP_SPAN of its
 * length (about one lens radius), as the logo's hole tips, its notch and a tight corner do, its own light goes out
 * before the tip: none within TIP_DARK of it along the outline, full from TIP_DARK + TIP_FADE on (both times the
 * Softness width), so the tip and the glow about it stay unlit while every lit point still adds its light. The hot spot
 * keeps TIP_CLEAR from every tip: the Light control runs it along the longest stretch clear of them, and a drag that
 * starts nearest a tip puts it on the nearest clear point. Up to TIPS tips in or near the frame.
 */
const TIP_TURN = (60 * Math.PI) / 180
const TIP_SPAN = 0.08
const TIP_DARK = 0.04
const TIP_FADE = 0.12
const TIP_CLEAR = 0.2
const TIPS = 4
const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
// The whole Meta logo outline (104 pieces, 3 contours) plus a cut at every stop in each contour must fit:
// pieces past the limit are dropped, and the inside test then flips inside and outside in horizontal bands.
export const RIM_LAYOUT: CurveLightLayout = { emitters: 1, primitives: 128, near: 3, far: 3 }

const params: ParamSpec[] = [
  { kind: 'number', key: 'shape', label: 'Shape (1 line, 2 corner, 3 arc, 4 S-curve, 5 logo, 6 ring)', min: 1, max: 6, step: 1, default: 2 },
  { kind: 'vector', key: 'at', label: 'Shape origin', min: -8, max: 9, step: 0.0005, default: [0.8, 0.22] },
  { kind: 'number', key: 'size', label: 'Size (line length, corner radius, arc radius, logo height)', min: 0, max: 12, step: 0.0005, default: 0.08 },
  { kind: 'number', key: 'angle', label: 'Angle (corner inside angle, arc or S sweep)', min: 1, max: 360, step: 0.01, default: 64 },
  { kind: 'number', key: 'aspect', label: 'Ring aspect', min: 0.2, max: 5, step: 0.001, default: 1 },
  { kind: 'number', key: 'rotate', label: 'Rotation', min: -360, max: 360, step: 0.01, default: 148 },
  { kind: 'boolean', key: 'flip', label: 'Mirror', default: false },
  { kind: 'number', key: 'stops', label: 'Emission stops', min: 1, max: STOPS, step: 1, default: 1 },
  { kind: 'vector', key: 'stopAt', label: 'Stops 1-3 along the curve', min: 0, max: 1, step: 0.0005, default: [0, 0.5, 1] },
  { kind: 'vector', key: 'stopAt2', label: 'Stops 4-6 along the curve', min: 0, max: 1, step: 0.0005, default: [1, 1, 1] },
  { kind: 'vector', key: 'stopColor', label: 'Stops 1-3 color slot', min: 1, max: COLORS, step: 1, default: [2, 2, 2] },
  { kind: 'vector', key: 'stopColor2', label: 'Stops 4-6 color slot', min: 1, max: COLORS, step: 1, default: [2, 2, 2] },
  { kind: 'vector', key: 'stopGain', label: 'Stops 1-3 gain', min: 0, max: 20, step: 0.001, default: [1, 1, 1] },
  { kind: 'vector', key: 'stopGain2', label: 'Stops 4-6 gain', min: 0, max: 20, step: 0.001, default: [1, 1, 1] },
  { kind: 'vector', key: 'tipAt', label: 'Sharp tips along their contours, where the light goes out (0..1, -1 none)', min: -1, max: 1, step: 0.0001, default: [-1, -1, -1, -1] },
  { kind: 'vector', key: 'tipContour', label: 'Contours of the sharp tips', min: 0, max: 8, step: 1, default: [0, 0, 0, 0] },
  { kind: 'number', key: 'tipDark', label: 'Unlit stretch either side of a tip', min: 0, max: 1, step: 0.0005, default: 0 },
  { kind: 'number', key: 'tipFade', label: 'Fade before the unlit stretch', min: 0, max: 1, step: 0.0005, default: 0 },
  ...nearParams('n1', 'Core', { Weight: 2.5, Width: 0.0008, Shape: 8, Light: 2 }),
  ...nearParams('n2', 'Glow', { Weight: 0.7, Width: 0.004, Shape: 3, Side: 1, Light: 1, Grow: 2, GrowBy: [1.5, 2] }),
  ...nearParams('n3', 'Near part 3'),
  ...farParams('f1', 'Haze', { Weight: 0.2, Width: 0.016, Side: 1, Light: 1 }),
  ...farParams('f2', 'Halo', { Weight: 0.03, Width: 0.02, Light: 1 }),
  ...farParams('f3', 'Face', { Weight: 0.025, Width: 0.22, Side: 1, Light: 1, LightGamma: 0.5 }),
  { kind: 'number', key: 'farWidth', label: 'Narrowest scatter blur', min: 0.002, max: 0.2, step: 0.0005, default: 0.008 },
  { kind: 'number', key: 'farStep', label: 'Scatter blur step', min: 1.5, max: 5, step: 0.01, default: 2.5 },
  ...lightParams({
    light1Kind: 2,
    light1At: [-0.05, 0.05],
    light1Radius: 0.1,
    light1Length: 0.35,
    light2Kind: 1,
    light2At: [-0.06, 0.04],
    light2Radius: 0.16,
  }),
  { kind: 'number', key: 'facing', label: 'Edges facing the light get more of it', min: 0, max: 1, step: 0.01, default: 0 },
  { kind: 'number', key: 'facingAngle', label: 'Light comes from (degrees)', min: -360, max: 360, step: 0.1, default: 0 },
  { kind: 'number', key: 'facingPower', label: 'Facing falloff', min: 0.1, max: 8, step: 0.01, default: 1 },
  ...driftParams('drift', 'Dim light'),
  { kind: 'number', key: 'pale', label: 'Pale color slot, for parts with a pale share (0 none)', min: 0, max: COLORS, step: 1, default: 0 },
  ...airParams(COLORS),
  { kind: 'vector', key: 'maskShift', label: 'Inside edge shift', min: -2, max: 2, step: 0.0005, default: [0, 0] },
  { kind: 'number', key: 'maskGrow', label: 'Inside edge grow', min: -1, max: 1, step: 0.0001, default: 0 },
  { kind: 'number', key: 'base', label: 'Base color slot (0 black)', min: 0, max: COLORS, step: 1, default: 0 },
  { kind: 'number', key: 'baseGain', label: 'Base gain', min: 0, max: 2, step: 0.0005, default: 0 },
  { kind: 'number', key: 'gain', label: 'Overall gain', min: 0, max: 20, step: 0.001, default: 1 },
  { kind: 'number', key: 'soften', label: 'Overall width', min: 0.05, max: 8, step: 0.001, default: 1 },
]

/**
 * Logo outline points (logo units, viewBox 1000 1000 1504.8 1000) a tight crop
 * centers on: the notch where the loops meet above, the point where they meet
 * below, the two hole tips and the two loop ends.
 */
const LOGO_FEATURES: readonly (readonly [Vec2, number])[] = [
  [[1772.84, 1210.99], 3],
  [[1752.79, 1471.26], 2],
  [[1675.9, 1353.3], 2],
  [[1915.37, 1420.09], 2],
  [[1000, 1655.86], 2],
  [[2504.83, 1649.66], 2],
]
const LOGO_CENTER: Vec2 = [1752.4136, 1500]

const rotate = (v: Vec2, degrees: number): Vec2 => {
  const a = (degrees * Math.PI) / 180
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]
}

/**
 * A tight crop shows one part of the logo: no part other than the one it
 * centers on comes near the frame, and at most one of the crossing and the
 * two loop tops shows (counting 0.15 of the logo's height, plus 0.05, past the
 * frame edge, since a loop reads from the curve around its top).
 */
function logoCropTooWide(shape: ShapeSettings, anchor: Vec2, aspect: number): boolean {
  const { size, rotate: turn, flip } = shape
  return (
    logoPartsShown(META_LOGO_PARTS, size, turn, flip, anchor, aspect) > 1 ||
    pointsNearFrame(META_LOGO_LANDMARKS, size, turn, flip, anchor, aspect, 0.05 + 0.15 * size) > 1
  )
}

interface RimLayout {
  shape: ShapeSettings
  /** Shape origin, short-side units from the frame center. */
  anchor: Vec2
  /** Glow on the inside only (an edge) or on both sides (a line of light). */
  oneSided: boolean
}

/** Where the shape goes for this seed and frame; the light keeps to one part of the frame so the rest stays dark. */
type RimKind = Exclude<ShapeKind, 'logoEdge' | 'sCurve'>

/**
 * The frame edge toward `where` (0 top, 1 bottom, 2 left, 3 right) and the
 * direction along it toward `where` (-1, 0 or 1 along x for the top and
 * bottom, along y for the sides). A diagonal place picks one of its two edges.
 */
function edgeToward(where: Vec2, rand: () => number, aspect: number): { edge: number; along: number } {
  const horizontal = Math.abs(where[1]) > Math.abs(where[0]) + 1e-3 || (Math.abs(Math.abs(where[1]) - Math.abs(where[0])) <= 1e-3 && rand() < (aspect >= 1 ? 0.6 : 0.4))
  if (horizontal) return { edge: where[1] < 0 ? 0 : 1, along: Math.abs(where[0]) > 1e-3 ? Math.sign(where[0]) : 0 }
  return { edge: where[0] < 0 ? 2 : 3, along: Math.abs(where[1]) > 1e-3 ? Math.sign(where[1]) : 0 }
}

/** A rounded corner whose vertex sits at or just past a frame edge: one leg runs into the frame, the other leaves it. */
function cornerLayout(rand: () => number, aspect: number, edge: number, alongSign: number): RimLayout {
  const [fw, fh] = frameSize(aspect)
  const inward: Vec2 = ([[0, 1], [0, -1], [1, 0], [-1, 0]] as const)[edge] as Vec2
  const tangent: Vec2 = inward[0] === 0 ? [rand() < 0.5 ? 1 : -1, 0] : [0, rand() < 0.5 ? 1 : -1]
  const extent = inward[0] === 0 ? fw : fh
  // The vertex sits toward the seed's place along the edge, or near the edge's middle for a place straight out.
  const reach = lerp(0.1, 0.3, rand())
  const along = (alongSign === 0 ? reach - 0.2 : alongSign * (tangent[0] + tangent[1]) * reach) * extent
  const past = lerp(-0.01, 0.08, rand())
  const toEdge = (inward[0] === 0 ? fh : fw) / 2 + past
  const vertex: Vec2 = [tangent[0] * along - inward[0] * toEdge, tangent[1] * along - inward[1] * toEdge]
  const angle = lerp(48, 100, rand())
  // Degrees from the frame edge toward the inside: the inner leg, then the bisector (the outer leg is at legIn - angle).
  const legIn = lerp(20, Math.min(80, angle - 8), rand())
  const bisector = ((legIn - angle / 2) * Math.PI) / 180
  const direction: Vec2 = [tangent[0] * Math.cos(bisector) + inward[0] * Math.sin(bisector), tangent[1] * Math.cos(bisector) + inward[1] * Math.sin(bisector)]
  return {
    shape: { kind: 'corner', size: lerp(0.03, 0.14, rand()), angle, aspect: 1, rotate: (Math.atan2(direction[1], direction[0]) * 180) / Math.PI, flip: false },
    anchor: vertex,
    oneSided: true,
  }
}

/** Where the shape goes for this seed and frame: its light lies toward `where` (one of PLACES). */
function rimLayout(kind: RimKind, rand: () => number, aspect: number, where: Vec2): RimLayout {
  const [fw, fh] = frameSize(aspect)
  // Length of the longest piece inside the frame (its points are about 0.01 apart).
  const runLength = (l: RimLayout) => longestRun(visibleRuns(buildShape(l.shape), l.anchor, aspect)).length * 0.01
  const { edge, along } = edgeToward(where, rand, aspect)
  const sx = where[0] > 1e-3 ? 1 : where[0] < -1e-3 ? -1 : rand() < 0.5 ? 1 : -1
  const sy = where[1] > 1e-3 ? 1 : where[1] < -1e-3 ? -1 : rand() < 0.5 ? 1 : -1
  const long = Math.max(fw, fh)
  switch (kind) {
    case 'corner': {
      // A few tries keep the first layout whose inner leg crosses at least 0.9 of the short side, so the corner
      // never clips just one corner of the frame.
      let best: RimLayout | null = null
      let bestLength = -1
      for (let attempt = 0; attempt < 12 && bestLength < 0.9 * Math.min(fw, fh); attempt++) {
        const candidate = cornerLayout(rand, aspect, edge, along)
        const length = longestRun(visibleRuns(buildShape(candidate.shape), candidate.anchor, aspect)).length * 0.01
        if (length > bestLength) {
          best = candidate
          bestLength = length
        }
      }
      return best as RimLayout
    }
    case 'line': {
      // A line runs along the side toward the seed's place (left or right: upright; top or bottom: across).
      const vertical = edge >= 2
      const offset = lerp(0.18, 0.34, rand())
      return {
        shape: { kind, size: 4 * long, angle: 90, aspect: 1, rotate: (vertical ? 90 : 0) + lerp(-10, 10, rand()), flip: false },
        anchor: vertical ? [sx * fw * (0.5 - offset), 0] : [0, sy * fh * (0.5 - offset)],
        oneSided: false,
      }
    }
    case 'arc': {
      // A large circle whose arc crosses the frame near one edge; the glow faces its center.
      const radius = lerp(0.9, 2.2, rand()) * long
      // The arc crosses the frame near the edge toward the seed's place.
      const side = [1, 0, 3, 2][edge]
      const reach = lerp(0.22, 0.4, rand())
      const normals: readonly Vec2[] = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]
      const normal = normals[side]
      const extent = normal[0] !== 0 ? fw : fh
      const crossing = (0.5 - reach) * extent
      const center: Vec2 = [normal[0] * (radius + crossing), normal[1] * (radius + crossing)]
      const outward = (Math.atan2(-normal[1], -normal[0]) * 180) / Math.PI
      return {
        shape: { kind, size: radius, angle: 160, aspect: 1, rotate: outward + lerp(-10, 10, rand()), flip: false },
        anchor: center,
        oneSided: true,
      }
    }
    case 'logo': {
      const draw = (): RimLayout => {
        // A tight crop: the logo is 3.2 to 5.5 short sides tall and one part of its outline shows.
        const feature = pickWeighted(rand, LOGO_FEATURES)
        const size = lerp(3.2, 5.5, rand())
        // Turned so the feature lies toward the seed's place, with the logo's body off the frame beyond it.
        const from = Math.atan2(feature[1] - LOGO_CENTER[1], feature[0] - LOGO_CENTER[0])
        const turn = ((Math.atan2(-where[1], -where[0]) - from) * 180) / Math.PI + lerp(-20, 20, rand())
        const unit = rotate([(feature[0] - LOGO_CENTER[0]) / 1000, (feature[1] - LOGO_CENTER[1]) / 1000], turn)
        const norm = Math.hypot(unit[0], unit[1]) || 1
        const reachOut = lerp(0.1, 0.3, rand())
        const target: Vec2 = [(-unit[0] / norm) * fw * reachOut, (-unit[1] / norm) * fh * reachOut]
        const place = (scale: number): RimLayout => ({
          shape: { kind, size: size * scale, angle: 90, aspect: 1, rotate: turn, flip: false },
          anchor: [target[0] - unit[0] * size * scale, target[1] - unit[1] * size * scale],
          oneSided: true,
        })
        // Never the whole logo: a larger logo keeps every other part out of the frame.
        let layout = place(1)
        for (let scale = 1.15; scale < 12 && logoCropTooWide(layout.shape, layout.anchor, aspect); scale *= 1.15) layout = place(scale)
        return layout
      }
      // A few tries keep the first crop whose longest visible piece is at least the short side long, so the light
      // never sits on a short scrap of outline.
      let best = draw()
      let bestLength = runLength(best)
      for (let attempt = 1; attempt < 8 && bestLength < Math.min(fw, fh); attempt++) {
        const next = draw()
        const length = runLength(next)
        if (length > bestLength) {
          best = next
          bestLength = length
        }
      }
      return best
    }
    case 'ring': {
      const radius = lerp(0.7, 1.4, rand())
      return {
        shape: { kind, size: radius, angle: 360, aspect: 1, rotate: 0, flip: false },
        anchor: [sx * (fw / 2 + radius * 0.6), sy * (fh / 2 + radius * 0.5)],
        oneSided: true,
      }
    }
    default: {
      const unknown: never = kind
      throw new Error(`Unknown shape kind: ${String(unknown)}`)
    }
  }
}

/** A point on the line beyond (shift > 0) or before (shift < 0) the end where it leaves the frame. */
function lineExit(path: readonly Vec2[], fromStart: boolean, shift: number): Vec2 | null {
  if (path.length < 2) return null
  const exit = fromStart ? path[0] : path[path.length - 1]
  const inner = fromStart ? path[Math.min(path.length - 1, 5)] : path[Math.max(0, path.length - 6)]
  const dx = exit[0] - inner[0]
  const dy = exit[1] - inner[1]
  const length = Math.hypot(dx, dy) || 1
  return [exit[0] + (dx / length) * shift, exit[1] + (dy / length) * shift]
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * The sharp tips of a shape placed at `anchor` (short-side units from the frame center): each contour's points where
 * its direction turns more than TIP_TURN between TIP_SPAN / 2 before and after, one tip at the middle of each such
 * stretch, as the contour (index) and fraction (0..1) along it and as a point. The tips within reach of the frame,
 * nearest the frame center first.
 */
export function outlineTips(shape: Shape, anchor: Vec2, aspect: number): { contour: number; t: number; at: Vec2 }[] {
  const [fw, fh] = frameSize(aspect)
  const reach = TIP_CLEAR
  const tips: { contour: number; t: number; at: Vec2 }[] = []
  for (const [contour, c] of shape.contours.entries()) {
    const samples: { s: number; angle: number }[] = []
    let total = 0
    for (const p of c.primitives) {
      const l = primitiveLength(p)
      const steps = Math.max(1, Math.ceil(l / 0.004))
      for (let i = 0; i < steps; i++) {
        const d = primitiveTangent(p, i / steps)
        samples.push({ s: total + (l * i) / steps, angle: Math.atan2(d[1], d[0]) })
      }
      total += l
    }
    const n = samples.length
    if (n < 3 || total <= 0) continue
    // The direction along the contour without its jumps of a full turn; on a closed contour one lap adds `lap`.
    const wrapPi = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI))
    const angle = [samples[0].angle]
    for (let i = 1; i < n; i++) angle.push(angle[i - 1] + wrapPi(samples[i].angle - samples[i - 1].angle))
    const lap = angle[n - 1] + wrapPi(samples[0].angle - samples[n - 1].angle) - angle[0]
    const step = TIP_SPAN / 2 / (total / n)
    const directionAt = (k: number): number | null => {
      if (c.closed) return angle[((k % n) + n) % n] + lap * Math.floor(k / n)
      return k >= 0 && k < n ? angle[k] : null
    }
    const sharp = samples.map((_, i) => {
      const before = directionAt(Math.round(i - step))
      const after = directionAt(Math.round(i + step))
      return before !== null && after !== null && Math.abs(after - before) > TIP_TURN
    })
    // Stretches of sharp samples (a closed contour's may wrap past its start), each a tip at its middle.
    const first = c.closed ? sharp.findIndex((v) => !v) : 0
    if (first < 0) continue
    for (let k = 0; k < n; ) {
      const i = (first + k) % n
      if (!sharp[i]) {
        k++
        continue
      }
      let length = 0
      while (k + length < n && sharp[(first + k + length) % n]) length++
      const mid = samples[(first + k + Math.floor(length / 2)) % n].s
      const point = pointOnContour(c.primitives, mid)
      const at: Vec2 = [point[0] + anchor[0], point[1] + anchor[1]]
      if (Math.abs(at[0]) <= fw / 2 + reach && Math.abs(at[1]) <= fh / 2 + reach) tips.push({ contour, t: mid / total, at })
      k += length
    }
  }
  return tips.sort((a, b) => Math.hypot(a.at[0], a.at[1]) - Math.hypot(b.at[0], b.at[1])).slice(0, TIPS)
}

/** The pieces of a run of points where `keep` holds, in order. */
function stretches(run: readonly Vec2[], keep: (p: Vec2) => boolean): Vec2[][] {
  const out: Vec2[][] = [[]]
  for (const p of run) {
    if (keep(p)) out[out.length - 1].push(p)
    else if (out[out.length - 1].length) out.push([])
  }
  return out
}

/** The point `s` along a chain of primitives (short sides from its start). */
function pointOnContour(primitives: readonly Primitive[], s: number): Vec2 {
  let at = 0
  for (const p of primitives) {
    const l = primitiveLength(p)
    if (s <= at + l || p === primitives[primitives.length - 1]) return primitivePoint(p, l > 0 ? Math.min(1, Math.max(0, (s - at) / l)) : 0)
    at += l
  }
  return [0, 0]
}

function composeRim({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const rand = seededRandom(seed, 7)
  // The first draw was the light's; the plan's slot picks it now, and the rest of the composition draws as before.
  rand()
  const baseDraw = rand()
  // A block of 8 seeds shows three corners, three logo crops, a line and an arc, each lighting a different part of the frame.
  const plan = blockPlan<RimKind>(seed, 61, ['corner', 'corner', 'corner', 'logo', 'logo', 'logo', 'line', 'arc'])
  // The design above and below reads no colors; the colors only fill its roles.
  const roles = curveRoles(pack.colors, { slot: plan.slot, baseDraw }, 'rim')
  const { light, base, pale } = roles
  const kind = plan.kind
  const layout = rimLayout(kind, rand, aspect, plan.place)
  const shape = buildShape(layout.shape)
  const [fw, fh] = frameSize(aspect)
  const path = visiblePath(shape, layout.anchor, aspect)
  // The Light control runs the hot spot from where the curve leaves the frame (0) to its middle (1).
  const fromStart = rand() < 0.5
  const line = layout.shape.kind === 'line'
  const logo = layout.shape.kind === 'logo'
  const corner = layout.shape.kind === 'corner'
  // Other shapes follow the longest piece inside the frame; a corner's hot spot starts at its vertex end. The hot
  // spot keeps clear of the outline's sharp tips (outlineTips): it moves along the longest stretch clear of them.
  const runs = line ? [path] : visibleRuns(shape, layout.anchor, aspect)
  const run = line ? path : longestRun(runs)
  const tips = line ? [] : outlineTips(shape, layout.anchor, aspect)
  const clear = (p: Vec2) => tips.every((tip) => dist(tip.at, p) >= TIP_CLEAR)
  // Where tips cut the run into stretches, the seed picks one at least half as long as the longest and shifts the Light
  // control's range along it, so crops lit beside a tip don't all put their light the same way (a draw of its own:
  // the others stay).
  const clearStretches = stretches(run, clear).filter((s) => s.length > 1)
  const longestClear = longestRun(clearStretches)
  const choices = clearStretches.filter((s) => s.length >= longestClear.length / 2)
  const spot = seededRandom(seed, 41)
  const lit = choices.length > 1 ? choices[Math.min(choices.length - 1, Math.floor(spot() * choices.length))] : longestClear
  const smooth = lit.length > 1 ? lit : run
  const vertexFirst = smooth.length > 1 && dist(smooth[0], layout.anchor) <= dist(smooth[smooth.length - 1], layout.anchor)
  const start = corner ? vertexFirst : fromStart
  const shift = lit.length > 1 && lit.length < run.length ? lerp(0, 0.5, spot()) : 0
  const along = (mood: number) => (start ? lerp(shift, shift + 0.5, mood) : lerp(1 - shift, 0.5 - shift, mood))
  // A dragged line puts the hot spot on the outline nearest its start and runs the light along the outline its
  // way (SHARED.md, "Dragging the light"); the Light control then doesn't move it again. Without one, a line is
  // brightest where it leaves the frame and the Light control moves that end inward. Outline points near a sharp tip
  // count less in where a drag's hot spot sits (fading in from half of TIP_CLEAR to TIP_CLEAR), so as the line's start
  // passes a tip the hot spot moves smoothly from one arm to the other instead of jumping.
  const awayFromTips = (p: Vec2) => {
    const t = Math.min(1, Math.max(0, (Math.min(Infinity, ...tips.map((tip) => dist(tip.at, p))) / TIP_CLEAR - 0.5) * 2))
    return 0.02 + 0.98 * t * t * (3 - 2 * t)
  }
  const dragged = controls.drag ? dragLight(controls.drag, runs, aspect, tips.length ? awayFromTips : undefined) : null
  const hot = dragged?.hot ?? (line ? lineExit(path, fromStart, lerp(0.08, -0.3, controls.mood)) : pointAlong(smooth, along(controls.mood))) ?? layout.anchor
  const home = dragged?.hot ?? pointAlong(smooth, along(0.5)) ?? layout.anchor
  const at: Vec2 = [hot[0] - layout.anchor[0], hot[1] - layout.anchor[1]]
  const gain = geo(controls.intensity, 0.35, 1, 2.8)
  // Softness from 0.3 to 1.7 (1 at the default): wider glows change more of the frame per step, so the top
  // half of the range spans less than the bottom half and each step changes the picture by about as much.
  const soften = geo(controls.softness, 0.3, 1, 1.7)
  const reachDraw = rand()
  const powerDraw = rand()
  const hotDraw = rand()
  // Away from a line, light field 1 is a flat-top field: near full along a stretch around the hot spot, then a
  // rounded shoulder, 10 to 30 times dimmer at the far end of the curve in the frame (the rim-edge reference stays
  // at 90% for about a third of the short side and is at 10% by 0.9; its fall fits a power of about 2.8). It is
  // sized at the default hot spot, so the Light control moves the light without resizing it. The same for every
  // light's color, so every pack shows the same design.
  const power = line ? lerp(1.4, 2.2, powerDraw) : lerp(2.4, 3.2, powerDraw)
  const factor = lerp(10, 30, reachDraw)
  const lineReach = lerp(0.22, 0.34, reachDraw) * Math.max(fw, fh)
  const reach = line ? lineReach : flatRadius(run, home, factor, power)
  const dragPower = line ? 2.4 : power
  // A logo crop's edges catch the light where they face the way the outline faces at the default hot spot, so the
  // hot spot's own edge is always fully lit (around a hole tip the outline faces back toward the logo's middle).
  const outwardAt = (p: Vec2): number => {
    const n = normalNear(run, p, 2)
    const probe: Vec2 = [p[0] + n[0] * 0.01 - layout.anchor[0], p[1] + n[1] * 0.01 - layout.anchor[1]]
    const inside = windingNumber(shape.contours.flatMap((c) => c.primitives), probe) !== 0
    return (Math.atan2(inside ? -n[1] : n[1], inside ? -n[0] : n[0]) * 180) / Math.PI
  }
  // Without a drag the facing stays the seed's, so the Light control moves the light along the outline, not the side
  // it shines from.
  const seedHome = pointAlong(smooth, along(0.5)) ?? layout.anchor
  const toward = logo ? outwardAt(seedHome) : (Math.atan2(at[1], at[0]) * 180) / Math.PI
  // A dragged line sets the light's direction and reach: the light runs from the hot spot along the line and has
  // reached the dark at its end, edges facing the line's way catch it, and the hot spot grows with the line. A very
  // short line has no clear direction, so its light is round and its facing fades out.
  const dragReach = dragged ? Math.hypot(dragged.lineLength, 0.12) : 0
  const spread = dragged ? offFrameSpread(controls.drag, dragged.hot, aspect) : 0
  const dragT = dragged ? Math.min(1, dragged.lineLength / 0.15) : 0
  const dragWay = dragT * dragT * (3 - 2 * dragT)
  // Under a dragged line the edges facing its way catch more of the light, so the direction shows. A logo crop's do
  // so gently (DRAG_LOGO_FACING): its hot spot's edge often runs along the line, and at the undragged strength kept a
  // sixth of the light.
  const dragFacing = line ? 0 : logo ? DRAG_LOGO_FACING : 0.6
  const facing = dragged ? dragFacing * dragWay : logo ? 0.85 : 0
  // A line runs through the colors along its length (lineHues) and dims the way its warm color does.
  const lineRun = line ? roles.line : { hues: [light], dims: null }
  const drift = warmDrift((lineRun.dims ?? light).hex)
  // A line's bright end and its direction out of the frame there, and where its two visible ends sit along the line
  // (0 to 1 from one end of the long segment to the other).
  const brightEnd = path.length > 1 ? (fromStart ? path[0] : path[path.length - 1]) : layout.anchor
  const farEnd = path.length > 1 ? (fromStart ? path[path.length - 1] : path[0]) : layout.anchor
  const lineOut = (Math.atan2(brightEnd[1] - farEnd[1], brightEnd[0] - farEnd[0]) * 180) / Math.PI
  const along1 = (p: Vec2) => {
    const r = (layout.shape.rotate * Math.PI) / 180
    return 0.5 + ((p[0] - layout.anchor[0]) * Math.cos(r) + (p[1] - layout.anchor[1]) * Math.sin(r)) / layout.shape.size
  }
  const turns = lineRun.hues.length > 1
  // The other side of a turning line's glow takes the next color at the light's luminance (the pale share keeps it),
  // which overexposes a darker color: Meta Blue beside Cyan, Orange-red beside Yellow. Scaled to the next color's
  // own level with the light's largest channel, as along the line, and never above the light's luminance.
  const peakOf = (hex: string) => Math.max(...hexToLinear(hex))
  const sideLevel = turns
    ? Math.min(1, (luminance(hexToLinear(lineRun.hues[1].hex)) * (peakOf(light.hex) / peakOf(lineRun.hues[1].hex))) / luminance(hexToLinear(light.hex)))
    : 1
  // The light's own color holds over the line's first fifth from its bright end, then the others follow evenly to
  // the far end. Each has its largest channel at the light's, so the hue turns while the brightness follows the
  // light (a lower one reads as the dim end of that color). Where two colors meet the stretch between is a little
  // lighter (readStops).
  const hueStops = ((): Record<string, ParamValue> => {
    if (!turns) return { stops: 1, stopColor: [2, 2, 2] }
    const [from, to] = [along1(brightEnd), along1(farEnd)]
    const rest = lineRun.hues.slice(1)
    const places = [0, LINE_HUE_HOLD, ...rest.map((_, k) => LINE_HUE_HOLD + ((1 - LINE_HUE_HOLD) * (k + 1)) / rest.length)]
    const slots = [2, 2, ...rest.map((_, k) => LINE_HUE_SLOTS[k])]
    const peak = (hex: string) => Math.max(...hexToLinear(hex))
    const gains = [1, 1, ...rest.map((c) => round4(peak(light.hex) / peak(c.hex)))]
    const pad = (values: number[], fill: number) => [...values, ...Array<number>(STOPS - values.length).fill(fill)]
    const at = pad(places.map((f) => round4(from + (to - from) * f)), 1)
    const color = pad(slots, 2)
    const gain = pad(gains, 1)
    return { stops: places.length, stopAt: at.slice(0, 3), stopAt2: at.slice(3), stopColor: color.slice(0, 3), stopColor2: color.slice(3), stopGain: gain.slice(0, 3), stopGain2: gain.slice(3) }
  })()
  const params: Record<string, ParamValue> = {
    shape: SHAPE_KINDS.indexOf(layout.shape.kind) + 1,
    at: toFrame(layout.anchor, aspect).map(round4),
    size: round4(layout.shape.size),
    angle: round4(layout.shape.angle),
    aspect: 1,
    rotate: round4(layout.shape.rotate),
    flip: layout.shape.flip,
    // A line turns through the colors from its bright end to its far end (contour-light-line).
    ...hueStops,
    // The light goes out before each sharp tip (outlineTips); the unlit stretch widens with the glow.
    tipAt: Array.from({ length: TIPS }, (_, i) => (tips[i] ? round4(tips[i].t) : -1)),
    tipContour: Array.from({ length: TIPS }, (_, i) => tips[i]?.contour ?? 0),
    tipDark: round4(TIP_DARK * soften),
    tipFade: round4(TIP_FADE * soften),
    ...productionParts('', {
      side: layout.oneSided ? 1 : 0,
      soften,
      // The rim-edge reference's face is a dim navy (Oklab L about 0.22) that darkens away from the edge and the
      // corner. The same for every light's color, so every pack shows the same design.
      face: layout.oneSided ? 0.035 : 0,
      glow: line ? 0.006 : 0.005,
      fan: line ? 4 : 1.5,
    }),
    // A line's glow widens steadily toward its bright end, following the slow light along it, with a small hot core
    // and little haze, so the end opens as a cone rather than a cloud.
    ...(line
      ? { n2Weight: 0.55, n2Shape: 3, n2Grow: 1, n2GrowBy: [6.5, 1], n3Weight: 2, f1Grow: 1, f1GrowBy: [2, 1], f1Weight: 0.12, f1Width: 0.02 }
      : {}),
    ...(drift ? { drift: drift.ratios, driftShape: [drift.knee, drift.sharpness] } : {}),
    // A line's other side takes its next color (slot 4, its own where it doesn't turn); a Meta Blue light's pale side
    // its pale color (slot 5, curveRoles).
    pale: line ? 4 : pale.color ? 5 : 0,
    // The core line leans toward the pale color; the color band beside it only as a band's body does and less, so
    // the edge keeps the light's own color.
    ...(pale.color ? { n1Pale: pale.line, n2Pale: pale.band, n3Pale: pale.core, f1Pale: pale.air, f2Pale: pale.air, f3Pale: pale.face } : {}),
    // Every line opens like a flame toward its bright end, so every pack shows the same design; one that turns
    // through colors has the light's own color on one side and the next color (the pale slot) on the other, as
    // contour-light-line is yellow on one side and red on the other. Where the two meet, the core line adds to both, so
    // the meeting is lighter than either. The haze splits the same way and follows the light along the line, so the
    // dim end is a thin line.
    ...(line
      ? {
          n1Pale: 0,
          n2Weight: FLAME_WEIGHT,
          n2Width: FLAME_WIDTH,
          n2Side: 1,
          n2MaskSoft: FLAME_SIDE_SOFT,
          n2Pale: 0,
          n2GrowBy: FLAME_GROW,
          n3Weight: round4(FLAME_WEIGHT * sideLevel),
          n3Width: FLAME_WIDTH,
          n3Shape: 3,
          n3Side: 2,
          n3MaskSoft: FLAME_SIDE_SOFT,
          n3Light: 1,
          n3LightGamma: 1.2,
          n3Grow: 1,
          n3GrowBy: FLAME_GROW,
          n3Pale: 1,
          f1Weight: FLAME_HAZE,
          f1Side: 1,
          f1MaskSoft: 2 * FLAME_SIDE_SOFT,
          f1Pale: 0,
          f1GrowBy: FLAME_HAZE_GROW,
          f2Side: 2,
          f2MaskSoft: 2 * FLAME_SIDE_SOFT,
          f2Light: 1,
          f2LightGamma: 1,
          f2Weight: round4(FLAME_HAZE * sideLevel),
          f2Width: 0.02,
          f2Grow: 1,
          f2GrowBy: FLAME_HAZE_GROW,
          f2Pale: 1,
          f3Pale: 0,
        }
      : {}),
    ...offFrameGlow(controls.drag, light.hex, aspect, pale.edge),
    facing: round4(facing),
    facingAngle: round4(dragged ? dragged.lineAngle : toward),
    facingPower: FACING_POWER,
    farWidth: 0.01,
    // Along a dragged line the light is at the look's far end (10 to 30 times dimmer) where the line ends. A line of
    // light fades slowly from its bright end: full at the frame edge, then e times dimmer every 0.35 of the long side.
    light1Kind: dragged ? 6 : line ? 4 : 5,
    light1At: at.map(round4),
    light1Radius: round4(dragged ? Math.hypot(dragReach / Math.log(factor) ** (1 / dragPower), spread) : line ? 0.04 : reach),
    light1Power: round4(dragged ? dragPower : power),
    ...(dragged
      ? { light1Length: round4(lerp(1, 0.35, dragWay)), light1Stretch: round4(lerp(1, 0.75, dragWay)), light1Angle: round4(dragged.lineAngle) }
      : line
        ? { light1Length: round4(0.35 * Math.max(fw, fh)), light1Angle: round4(lineOut) }
        : {}),
    light2Kind: 1,
    light2At: at.map(round4),
    // A broad hot spot: the overexposed core covers a stretch of the edge, not a point (rim-edge reference); a
    // line's is short, at its bright end. A light outside the frame spreads it too, by half as much as its reach.
    light2Radius: round4(
      Math.hypot(
        (line ? lerp(0.08, 0.14, hotDraw) : lerp(0.18, 0.36, hotDraw)) * (dragged ? Math.min(1.4, Math.max(0.45, dragReach / 0.5)) : 1),
        0.5 * spread,
      ),
    ),
    base: base.gain > 0 ? 3 : 0,
    baseGain: base.gain,
    gain: round4(gain),
    soften: round4(soften),
  }
  // Tan shows little of its haze (dimShare) and keeps no face: a dim Tan fill over the dark reads grey-brown, and
  // with a Forest face the two mix olive.
  const dim = dimShare((lineRun.dims ?? light).hex)
  if (dim < 1) {
    for (const key of ['f1Weight', 'f2Weight']) params[key] = round4(Number(params[key] ?? 0) * dim)
    params.f3Weight = 0
  }
  const colors = [
    '#000000',
    light.hex,
    base.gain > 0 ? base.hex : '#000000',
    lineRun.hues[1]?.hex ?? (line ? light.hex : '#000000'),
    pale.color?.hex ?? '#000000',
    '#000000',
    lineRun.hues[2]?.hex ?? '#000000',
    lineRun.hues[3]?.hex ?? '#000000',
  ]
  return {
    colors,
    params,
    lens: {
      bloom: 0,
      halation: round4(lerp(0.04, 0.2, controls.intensity)),
      halationRadius: round4(0.035 * soften),
      halationTint: light.hex,
    },
    output: { grain: 0, toe: warmToe(light.hex) },
  }
}

/**
 * The emission stops in their order along the curve. Where two colors meet, the stretch between is lighter than
 * either and paler (paleBridge), never a dark or muddy mix.
 */
function readStops(ctx: RecipeContext): EmissionStop[] {
  const count = Math.round(ctx.num('stops'))
  const at = [...ctx.vec('stopAt'), ...ctx.vec('stopAt2')]
  const slots = [...ctx.vec('stopColor'), ...ctx.vec('stopColor2')].map(Math.round)
  const gains = [...ctx.vec('stopGain'), ...ctx.vec('stopGain2')]
  const placed = Array.from({ length: count }, (_, i) => ({ t: at[i], slot: slots[i], color: slotColor(ctx, slots[i]).map((v) => v * gains[i]) }))
  return placed.flatMap((s, i) => {
    const prev = placed[i - 1]
    if (!prev || prev.slot === s.slot) return [{ t: s.t, color: s.color, gain: 1 }]
    return [
      { t: (prev.t + s.t) / 2, color: paleBridge(prev.color, s.color), gain: 1 },
      { t: s.t, color: s.color, gain: 1 },
    ]
  })
}

/** The rim's one emitter from its params: the shape, its emission stops and its parts. */
export function rimEmitters(ctx: RecipeContext): EmitterSettings[] {
  const gain = ctx.num('gain')
  const soften = ctx.num('soften')
  const shape = buildShape({
    kind: shapeKindAt(ctx.num('shape')),
    size: ctx.num('size'),
    angle: ctx.num('angle'),
    aspect: ctx.num('aspect'),
    rotate: ctx.num('rotate'),
    flip: ctx.bool('flip'),
  })
  const stops = readStops(ctx)
  const tipContour = ctx.vec('tipContour')
  const fades = ctx
    .vec('tipAt')
    .flatMap((t, i) => (t >= 0 ? [{ contour: Math.round(tipContour[i]), t, dark: ctx.num('tipDark'), fade: ctx.num('tipFade') }] : []))
  return [
    {
      shape,
      anchor: ctx.vec('at'),
      stops,
      fades,
      // The drift measures against the first stop's color, the light's own at a line's bright end.
      own: stops[0]?.color,
      near: [1, 2, 3].map((i) => readNear(ctx, `n${i}`, soften, gain)),
      far: [1, 2, 3].map((i) => readFar(ctx, `f${i}`, soften, gain)),
      maskShift: ctx.vec('maskShift'),
      maskGrow: ctx.num('maskGrow'),
      facing: { strength: ctx.num('facing'), angle: ctx.num('facingAngle'), power: ctx.num('facingPower') },
      drift: readDrift(ctx, 'drift'),
      ...(Math.round(ctx.num('pale')) > 0 ? { pale: slotColor(ctx, ctx.num('pale')) } : {}),
    },
  ]
}

/**
 * Light along one edge: a straight line, a rounded corner, an arc, a gentle S
 * or a crop of the Meta logo outline. The edge is a thin emitter seen through
 * a point-spread function: three near parts (core and glows) integrated along
 * the edge, and three far parts (haze, halo, light scattered into the face)
 * from blurred copies of the emitter.
 */
export const contourRim: RecipeDefinition = {
  id: 'contour.rim',
  mood: 'contour',
  label: 'Rim',
  colorSlots: Array.from({ length: COLORS }, (_, i) => ({ key: `c${i + 1}`, label: `Color ${i + 1}` })),
  defaultColors: ['#000000', '#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00', '#FFFFFF', '#000000', '#000000'],
  params,
  fragment: /* glsl */ `
${curveLightGlsl(RIM_LAYOUT)}
vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }
vec3 auxRadiance(vec2 uv, vec2 p) { return clAux(p, false); }
vec3 combine(vec2 uv, vec2 p, vec3 light, vec3 b0, vec3 b1, vec3 b2, vec3 b3) { return light + curveLight(p, b0, b1, b2, b3, false); }
`,
  uniforms: (ctx) => {
    const base = slotColor(ctx, ctx.num('base')).map((v) => v * ctx.num('baseGain'))
    return curveLightUniforms(
      RIM_LAYOUT,
      rimEmitters(ctx),
      readLights(ctx),
      base,
      ctx.num('farWidth') * ctx.num('soften'),
      ctx.num('farStep'),
      ctx.aspect,
      readAir(ctx, ctx.num('gain')),
    )
  },
  scatter: farScatter(
    (ctx) => ctx.num('farWidth') * ctx.num('soften'),
    (ctx) => ctx.num('farStep'),
  ),
  lens: { bloom: 0 },
  fromPack: (pack: ColorPack) => {
    const hexes = pack.colors.map((c) => c.hex)
    return Array.from({ length: COLORS }, (_, i) => (i === 0 ? '#000000' : (hexes[i - 1] ?? hexes[0])))
  },
  compose: composeRim,
}
