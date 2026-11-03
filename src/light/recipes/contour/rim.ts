import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, ParamSpec, ParamValue, RecipeContext, RecipeDefinition } from '../../scene'
import {
  falloffRadius,
  frameSize,
  geo,
  lerp,
  logoPartsShown,
  longestRun,
  pickBase,
  pickLight,
  pickWeighted,
  pointAlong,
  pointsNearFrame,
  productionParts,
  round4,
  seededRandom,
  toFrame,
  visiblePath,
  visibleRuns,
  warmToe,
} from './curveCompose'
import {
  buildShape,
  curveLightGlsl,
  curveLightUniforms,
  farParams,
  farScatter,
  lightParams,
  nearParams,
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
import { META_LOGO_LANDMARKS, META_LOGO_PARTS, type Vec2 } from './shapes'

const COLORS = 8
const STOPS = 6
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

/** A rounded corner whose vertex sits at or just past a frame edge: one leg runs into the frame, the other leaves it. */
function cornerLayout(rand: () => number, aspect: number): RimLayout {
  const [fw, fh] = frameSize(aspect)
  const edge = pickWeighted(rand, (aspect >= 1
    ? [[0, 3], [1, 2], [2, 1.2], [3, 1.2]]
    : [[2, 2], [3, 2], [0, 1.5], [1, 1]]) as readonly (readonly [number, number])[])
  const inward: Vec2 = ([[0, 1], [0, -1], [1, 0], [-1, 0]] as const)[edge] as Vec2
  const tangent: Vec2 = inward[0] === 0 ? [rand() < 0.5 ? 1 : -1, 0] : [0, rand() < 0.5 ? 1 : -1]
  const extent = inward[0] === 0 ? fw : fh
  const along = lerp(-0.28, 0.28, rand()) * extent
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

function rimLayout(kind: RimKind, rand: () => number, aspect: number): RimLayout {
  const [fw, fh] = frameSize(aspect)
  const right = rand() < 0.5
  const top = rand() < 0.65
  const sx = right ? 1 : -1
  const sy = top ? -1 : 1
  const long = Math.max(fw, fh)
  switch (kind) {
    case 'corner': {
      // A few tries keep the first layout whose inner leg crosses at least 0.9 of the short side, so the corner
      // never clips just one corner of the frame.
      let best: RimLayout | null = null
      let bestLength = -1
      for (let attempt = 0; attempt < 12 && bestLength < 0.9 * Math.min(fw, fh); attempt++) {
        const candidate = cornerLayout(rand, aspect)
        const length = longestRun(visibleRuns(buildShape(candidate.shape), candidate.anchor, aspect)).length * 0.01
        if (length > bestLength) {
          best = candidate
          bestLength = length
        }
      }
      return best as RimLayout
    }
    case 'line': {
      const vertical = aspect >= 1 ? rand() < 0.75 : rand() < 0.35
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
      const side = Math.floor(rand() * 4)
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
      // A tight crop: the logo is 3.2 to 5.5 short sides tall and one part of its outline shows.
      const feature = pickWeighted(rand, LOGO_FEATURES)
      const size = lerp(3.2, 5.5, rand())
      const turn = pickWeighted(rand, [[0, 3], [180, 1], [90, 1], [-90, 1]] as const) + lerp(-20, 20, rand())
      const unit = rotate([(feature[0] - LOGO_CENTER[0]) / 1000, (feature[1] - LOGO_CENTER[1]) / 1000], turn)
      // Put the feature toward the side where the logo's body lies, so the body runs off the frame.
      const norm = Math.hypot(unit[0], unit[1]) || 1
      const reachOut = lerp(0, 0.25, rand())
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

function composeRim({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const rand = seededRandom(seed, 7)
  const light = pickLight(pack, rand, seed, 61)
  const base = pickBase(pack, rand)
  const kind = pickWeighted<RimKind>(rand, [
    ['corner', 4],
    ['line', 2],
    ['arc', 2],
    ['logo', 4],
  ])
  const layout = rimLayout(kind, rand, aspect)
  const shape = buildShape(layout.shape)
  const [fw, fh] = frameSize(aspect)
  const path = visiblePath(shape, layout.anchor, aspect)
  // The Light control runs the hot spot from where the curve leaves the frame (0) to its middle (1).
  const fromStart = rand() < 0.5
  const line = layout.shape.kind === 'line'
  const logo = layout.shape.kind === 'logo'
  const corner = layout.shape.kind === 'corner'
  // Other shapes follow the longest piece inside the frame; a corner's hot spot starts at its vertex end.
  const run = line ? path : longestRun(visibleRuns(shape, layout.anchor, aspect))
  const vertexFirst = run.length > 1 && dist(run[0], layout.anchor) <= dist(run[run.length - 1], layout.anchor)
  const start = corner ? vertexFirst : fromStart
  const along = (mood: number) => (start ? lerp(0, 0.5, mood) : lerp(1, 0.5, mood))
  // A line is brightest where it leaves the frame; the Light control moves that end inward.
  const hot = (line ? lineExit(path, fromStart, lerp(0.08, -0.3, controls.mood)) : pointAlong(run, along(controls.mood))) ?? layout.anchor
  const home = pointAlong(run, along(0.5)) ?? layout.anchor
  const at: Vec2 = [hot[0] - layout.anchor[0], hot[1] - layout.anchor[1]]
  const gain = geo(controls.intensity, 0.35, 1, 2.8)
  // Softness from 0.3 to 1.7 (1 at the default): wider glows change more of the frame per step, so the top
  // half of the range spans less than the bottom half and each step changes the picture by about as much.
  const soften = geo(controls.softness, 0.3, 1, 1.7)
  const reachDraw = rand()
  const powerDraw = rand()
  const hotDraw = rand()
  // Away from a line, light field 1 falls 10 to 30 times from the hot spot to the far end of the curve in the frame
  // (with the hot core on top, the edge ends up about 40 to 120 times dimmer there). It is sized at the default hot
  // spot, so the Light control moves the light without resizing it.
  const power = line ? lerp(1.4, 2.2, powerDraw) : lerp(2, 3, powerDraw)
  const reach = line ? lerp(0.22, 0.34, reachDraw) * Math.max(fw, fh) : falloffRadius(run, home, lerp(10, 30, reachDraw), power)
  const toward = (Math.atan2(at[1], at[0]) * 180) / Math.PI
  const params: Record<string, ParamValue> = {
    shape: SHAPE_KINDS.indexOf(layout.shape.kind) + 1,
    at: toFrame(layout.anchor, aspect).map(round4),
    size: round4(layout.shape.size),
    angle: round4(layout.shape.angle),
    aspect: 1,
    rotate: round4(layout.shape.rotate),
    flip: layout.shape.flip,
    stops: 1,
    stopColor: [2, 2, 2],
    ...productionParts('', {
      hex: light.hex,
      side: layout.oneSided ? 1 : 0,
      soften,
      face: layout.oneSided ? 0.012 : 0,
      glow: line ? 0.006 : 0.005,
      fan: line ? 4 : 1.8,
      spread: line ? 0.003 : 0,
    }),
    // Lines widen gradually toward the bright end (growth follows the long light, not the hot spot) and open into a haze there.
    ...(line ? { n2Grow: 1, n2GrowBy: [6, 1.5], n3Weight: 9, f1Grow: 1, f1GrowBy: [2, 1.5], f1Weight: 0.24, f1Width: 0.028 } : {}),
    facing: logo ? 0.85 : 0,
    facingAngle: round4(toward),
    facingPower: 1.5,
    farWidth: 0.01,
    light1Kind: 3,
    light1At: at.map(round4),
    light1Radius: round4(reach),
    light1Power: round4(power),
    light2Kind: 1,
    light2At: at.map(round4),
    light2Radius: round4(lerp(0.06, 0.12, hotDraw)),
    base: base.gain > 0 ? 3 : 0,
    baseGain: base.gain,
    gain: round4(gain),
    soften: round4(soften),
  }
  const colors = ['#000000', light.hex, base.gain > 0 ? base.hex : '#000000', '#000000', '#000000', '#000000', '#000000', '#000000']
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

function readStops(ctx: RecipeContext): EmissionStop[] {
  const count = Math.round(ctx.num('stops'))
  const at = [...ctx.vec('stopAt'), ...ctx.vec('stopAt2')]
  const slots = [...ctx.vec('stopColor'), ...ctx.vec('stopColor2')]
  const gains = [...ctx.vec('stopGain'), ...ctx.vec('stopGain2')]
  return Array.from({ length: count }, (_, i) => ({ t: at[i], color: slotColor(ctx, slots[i]), gain: gains[i] }))
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
  return [
    {
      shape,
      anchor: ctx.vec('at'),
      stops: readStops(ctx),
      near: [1, 2, 3].map((i) => readNear(ctx, `n${i}`, soften, gain)),
      far: [1, 2, 3].map((i) => readFar(ctx, `f${i}`, soften, gain)),
      maskShift: ctx.vec('maskShift'),
      maskGrow: ctx.num('maskGrow'),
      facing: { strength: ctx.num('facing'), angle: ctx.num('facingAngle'), power: ctx.num('facingPower') },
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
    return curveLightUniforms(RIM_LAYOUT, rimEmitters(ctx), readLights(ctx), base, ctx.num('farWidth') * ctx.num('soften'), ctx.num('farStep'), ctx.aspect)
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
