import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, ParamSpec, ParamValue, RecipeContext, RecipeDefinition } from '../../scene'
import {
  falloffRadius,
  frameSize,
  geo,
  haloParts,
  lerp,
  longestRun,
  normalNear,
  pickBase,
  pickLight,
  pickWeighted,
  pointAlong,
  pointsNearFrame,
  round4,
  seededRandom,
  toFrame,
  turning,
  visibleRuns,
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
  type EmitterSettings,
  type ShapeSettings,
} from './curveLight'
import { distanceToShape, META_LOGO_LANDMARKS, windingNumber, type Vec2 } from './shapes'

const COLORS = 8
const RINGS = 3
const NEAR = 3
const FAR = 3
export const HALO_LAYOUT: CurveLightLayout = { emitters: RINGS, primitives: 64, near: NEAR, far: FAR }

function ringParams(i: number): ParamSpec[] {
  const first = i === 1
  const near = [
    first ? { Weight: 2.2, Width: 0.0008, Shape: 8, Light: 1 } : {},
    first ? { Weight: 0.6, Width: 0.008, Shape: 3, Side: 1, Light: 1, Grow: 1, GrowBy: [1.5, 2] } : {},
    {},
  ]
  const far = [first ? { Weight: 0.1, Width: 0.04, Side: 1, Light: 1 } : {}, first ? { Weight: 0.02, Width: 0.02, Light: 1 } : {}, {}]
  return [
    { kind: 'boolean', key: `ring${i}On`, label: `Ring ${i}`, default: first },
    { kind: 'number', key: `ring${i}Shape`, label: `Ring ${i} shape (3 arc, 4 S-curve, 6 ring, 7 logo edge)`, min: 1, max: 7, step: 1, default: 6 },
    { kind: 'boolean', key: `ring${i}Flip`, label: `Ring ${i} mirror`, default: false },
    { kind: 'vector', key: `ring${i}At`, label: `Ring ${i} center`, min: -8, max: 9, step: 0.0005, default: [1.05, 1.1] },
    { kind: 'number', key: `ring${i}Radius`, label: `Ring ${i} radius`, min: 0.01, max: 8, step: 0.0005, default: 1.1 },
    { kind: 'number', key: `ring${i}Aspect`, label: `Ring ${i} aspect`, min: 0.2, max: 5, step: 0.001, default: 1 },
    { kind: 'number', key: `ring${i}Sweep`, label: `Ring ${i} sweep (360 closed)`, min: 1, max: 360, step: 0.01, default: 360 },
    { kind: 'number', key: `ring${i}Rotate`, label: `Ring ${i} rotation`, min: -360, max: 360, step: 0.01, default: 0 },
    { kind: 'number', key: `ring${i}Color`, label: `Ring ${i} color slot`, min: 1, max: COLORS, step: 1, default: 2 },
    { kind: 'number', key: `ring${i}Gain`, label: `Ring ${i} gain`, min: 0, max: 20, step: 0.001, default: 1 },
    { kind: 'vector', key: `ring${i}MaskShift`, label: `Ring ${i} inside edge shift`, min: -2, max: 2, step: 0.0005, default: [0, 0] },
    { kind: 'number', key: `ring${i}MaskGrow`, label: `Ring ${i} inside edge grow`, min: -2, max: 2, step: 0.0001, default: 0 },
    { kind: 'number', key: `ring${i}Facing`, label: `Ring ${i} edges facing the light get more of it`, min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'number', key: `ring${i}FacingAngle`, label: `Ring ${i} light comes from (degrees)`, min: -360, max: 360, step: 0.1, default: 0 },
    { kind: 'number', key: `ring${i}FacingPower`, label: `Ring ${i} facing falloff`, min: 0.1, max: 8, step: 0.01, default: 1 },
    ...near.flatMap((defaults, k) => nearParams(`ring${i}n${k + 1}`, `Ring ${i} near part ${k + 1}`, defaults)),
    ...far.flatMap((defaults, k) => farParams(`ring${i}f${k + 1}`, `Ring ${i} far part ${k + 1}`, defaults)),
  ]
}

const params: ParamSpec[] = [
  ...Array.from({ length: RINGS }, (_, i) => ringParams(i + 1)).flat(),
  { kind: 'number', key: 'farWidth', label: 'Narrowest scatter blur', min: 0.002, max: 0.2, step: 0.0005, default: 0.008 },
  { kind: 'number', key: 'farStep', label: 'Scatter blur step', min: 1.5, max: 5, step: 0.01, default: 2.5 },
  ...lightParams({ light1Kind: 1, light1At: [-0.75, -0.75], light1Radius: 0.45 }),
  { kind: 'number', key: 'base', label: 'Base color slot (0 black)', min: 0, max: COLORS, step: 1, default: 0 },
  { kind: 'number', key: 'baseGain', label: 'Base gain', min: 0, max: 2, step: 0.0005, default: 0 },
  { kind: 'number', key: 'gain', label: 'Overall gain', min: 0, max: 20, step: 0.001, default: 1 },
  { kind: 'number', key: 'soften', label: 'Overall width', min: 0.05, max: 8, step: 0.001, default: 1 },
]

/** Outer-contour points of the logo (logo units) a halo crop can follow: loop ends, tops and bottoms. */
const LOGO_EDGE_FEATURES: readonly Vec2[] = [
  [1000, 1655.86],
  [2504.83, 1649.66],
  [1432.41, 1000],
  [2080, 1000],
  [1273.1, 2000],
  [2245.5, 2000],
]
const LOGO_CENTER: Vec2 = [1752.4136, 1500]

interface HaloLayout {
  shape: ShapeSettings
  /** Shape origin, short-side units from the frame center. */
  anchor: Vec2
}

const rotate = (v: Vec2, degrees: number): Vec2 => {
  const a = (degrees * Math.PI) / 180
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]
}

/** Most a halo's visible curve may turn inside the frame (the yellow-halo reference shows 64 degrees of its circle). */
const MAX_TURN = (75 * Math.PI) / 180

/**
 * Center distance for a ring or ellipse along `unit` so that the curve passes
 * `gap` from the frame center, with the frame center outside it.
 */
function ringDistance(settings: ShapeSettings, unit: Vec2, gap: number): number {
  const shape = buildShape(settings)
  const primitives = shape.contours.flatMap((c) => c.primitives)
  const signedGap = (d: number) => {
    const center: Vec2 = [-unit[0] * d, -unit[1] * d]
    const distance = distanceToShape(shape, center)
    return windingNumber(primitives, center) !== 0 ? -distance : distance
  }
  let lo = 0
  let hi = settings.size + gap + 1
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    if (signedGap(mid) < gap) lo = mid
    else hi = mid
  }
  return hi
}

/** A large curve crossing one part of the frame: a ring or ellipse centered off the frame, a slow S, or the logo's outer edge. */
function haloLayout(kind: 'ring' | 'ellipse' | 'sCurve' | 'logoEdge', rand: () => number, aspect: number): HaloLayout {
  const [fw, fh] = frameSize(aspect)
  const short = Math.min(fw, fh)
  const sx = rand() < 0.5 ? 1 : -1
  const sy = rand() < 0.6 ? -1 : 1
  // Each kind places its curve at a scale; a curve that turns too much inside the frame is drawn larger.
  let place: (scale: number) => HaloLayout
  switch (kind) {
    case 'ring':
    case 'ellipse': {
      const corner = rand() < 0.55
      const direction: Vec2 = corner
        ? [sx * fw * lerp(0.4, 0.6, rand()), sy * fh * lerp(0.4, 0.6, rand())]
        : rand() < (aspect >= 1 ? 0.6 : 0.3)
          ? [sx * fw * 0.5, fh * lerp(-0.15, 0.15, rand())]
          : [fw * lerp(-0.2, 0.2, rand()), sy * fh * 0.5]
      const length = Math.hypot(direction[0], direction[1])
      const unit: Vec2 = [direction[0] / length, direction[1] / length]
      const stretch = kind === 'ellipse' ? lerp(0.5, 0.75, rand()) : 1
      const turn = kind === 'ellipse' ? lerp(-90, 90, rand()) : 0
      const radius = lerp(0.7, 1.6, rand()) * short
      const gap = lerp(0.06, 0.26, rand()) * short
      // The center stays off the frame so the curve never shows whole.
      const edge = Math.min(Math.abs(fw / 2 / (unit[0] || 1e-9)), Math.abs(fh / 2 / (unit[1] || 1e-9)))
      place = (scale) => {
        const shape: ShapeSettings = { kind: 'ring', size: Math.max(radius * scale, (edge + 0.1 - gap) / stretch), angle: 360, aspect: stretch, rotate: turn, flip: false }
        const distance = Math.max(ringDistance(shape, unit, gap), edge + 0.1)
        return { shape, anchor: [unit[0] * distance, unit[1] * distance] }
      }
      break
    }
    case 'sCurve': {
      const vertical = aspect < 1 ? rand() < 0.7 : rand() < 0.25
      const at: Vec2 = vertical ? [sx * fw * lerp(0.1, 0.25, rand()), fh * lerp(-0.1, 0.1, rand())] : [fw * lerp(-0.15, 0.15, rand()), sy * fh * lerp(0.1, 0.25, rand())]
      const size = lerp(0.9, 1.8, rand()) * short
      const angle = lerp(22, 38, rand())
      const turn = (vertical ? 90 : 0) + lerp(-22, 22, rand())
      const flip = rand() < 0.5
      place = (scale) => ({ shape: { kind: 'sCurve', size: size * scale, angle, aspect: 1, rotate: turn, flip }, anchor: at })
      break
    }
    case 'logoEdge': {
      const feature = LOGO_EDGE_FEATURES[Math.floor(rand() * LOGO_EDGE_FEATURES.length)]
      const size = lerp(2.8, 4.6, rand())
      const turn = [0, 180, 90, -90][Math.floor(rand() * 4)] + lerp(-15, 15, rand())
      const out = lerp(0.12, 0.3, rand())
      place = (scale) => {
        const local = rotate([((feature[0] - LOGO_CENTER[0]) / 1000) * size * scale, ((feature[1] - LOGO_CENTER[1]) / 1000) * size * scale], turn)
        // The feature sits toward the side where the logo body lies, so the body runs off the frame.
        const norm = Math.hypot(local[0], local[1]) || 1
        const target: Vec2 = [(-local[0] / norm) * fw * out, (-local[1] / norm) * fh * out]
        return { shape: { kind: 'logoEdge', size: size * scale, angle: 90, aspect: 1, rotate: turn, flip: false }, anchor: [target[0] - local[0], target[1] - local[1]] }
      }
      break
    }
    default: {
      const unknown: never = kind
      throw new Error(`Unknown halo kind: ${String(unknown)}`)
    }
  }
  // Never the whole logo: at most one of the crossing and the two loop tops may show.
  const tooMuch = (l: HaloLayout) =>
    turning(longestRun(visibleRuns(buildShape(l.shape), l.anchor, aspect))) > MAX_TURN ||
    (kind === 'logoEdge' && pointsNearFrame(META_LOGO_LANDMARKS, l.shape.size, l.shape.rotate, l.shape.flip, l.anchor, aspect, 0.05 + 0.15 * l.shape.size) > 1)
  let layout = place(1)
  for (let scale = 1.2; scale < 12 && tooMuch(layout); scale *= 1.2) layout = place(scale)
  return layout
}

/**
 * One large curve of light crossing the frame (never a whole ring), lit like a
 * halo around an off-frame source: crest on the curve, long falloff outward,
 * short flank inward, the inside at the base level, and the light falling
 * along the curve away from the hot spot.
 */
function composeHalo({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const rand = seededRandom(seed, 13)
  const light = pickLight(pack, rand)
  const base = pickBase(pack, rand)
  const kind = pickWeighted(seededRandom(seed, 29), [
    ['ring', 2],
    ['ellipse', 3],
    ['sCurve', 3],
    ['logoEdge', 3],
  ] as const)
  const layout = haloLayout(kind, rand, aspect)
  // The hot spot and the falloff follow the longest piece of the curve inside the frame.
  const path = longestRun(visibleRuns(buildShape(layout.shape), layout.anchor, aspect))
  const fromStart = rand() < 0.5
  const along = fromStart ? lerp(0, 0.5, controls.mood) : lerp(1, 0.5, controls.mood)
  const hot = pointAlong(path, along) ?? layout.anchor
  const at: Vec2 = [hot[0] - layout.anchor[0], hot[1] - layout.anchor[1]]
  const gain = geo(controls.intensity, 0.35, 1, 2.8)
  const soften = geo(controls.softness, 0.45, 1, 2.4)
  // Light falls 20 to 60 times from the hot spot to the far end of the visible curve. The light field is three
  // times longer across the curve, so the glow keeps its long fade outward near the hot spot.
  const power = lerp(2, 3, rand())
  const across = normalNear(path, hot)
  const radius = falloffRadius(path, hot, lerp(20, 60, rand()), power, { direction: across, by: 6 })
  const params: Record<string, ParamValue> = {
    ring1On: true,
    ring1Shape: SHAPE_KINDS.indexOf(layout.shape.kind) + 1,
    ring1At: toFrame(layout.anchor, aspect).map(round4),
    ring1Radius: round4(layout.shape.size),
    ring1Aspect: round4(layout.shape.aspect),
    ring1Sweep: round4(layout.shape.kind === 'ring' ? 360 : layout.shape.angle),
    ring1Rotate: round4(layout.shape.rotate),
    ring1Flip: layout.shape.flip,
    ring1Color: 2,
    ring1Gain: 1,
    ...haloParts('ring1', light.hex),
    ring2On: false,
    ring3On: false,
    farWidth: 0.03,
    farStep: 3,
    light1Kind: 3,
    light1At: at.map(round4),
    light1Radius: round4(radius),
    light1Power: round4(power),
    light1Stretch: 6,
    light1Angle: round4((Math.atan2(across[1], across[0]) * 180) / Math.PI),
    light2Kind: 0,
    base: base.gain > 0 ? 3 : 0,
    baseGain: base.gain,
    gain: round4(gain),
    soften: round4(soften),
  }
  return {
    colors: ['#000000', light.hex, base.gain > 0 ? base.hex : '#000000', '#000000', '#000000', '#000000', '#000000', '#000000'],
    params,
    lens: {
      bloom: 0,
      halation: round4(lerp(0.04, 0.2, controls.intensity)),
      halationRadius: round4(0.035 * soften),
      halationTint: light.hex,
    },
    output: { grain: 0 },
  }
}

/** The halo's emitters from its params: one per ring that is on. */
export function haloEmitters(ctx: RecipeContext): EmitterSettings[] {
  const gain = ctx.num('gain')
  const soften = ctx.num('soften')
  return Array.from({ length: RINGS }, (_, index) => {
    const i = index + 1
    const sweep = ctx.num(`ring${i}Sweep`)
    // A halo has room for the logo's outer outline only (64 pieces per ring; the whole logo has 104).
    const asked = shapeKindAt(ctx.num(`ring${i}Shape`))
    const picked = asked === 'logo' ? 'logoEdge' : asked
    const shape = ctx.bool(`ring${i}On`)
      ? buildShape({
          kind: picked === 'ring' && sweep < 359.99 ? 'arc' : picked,
          size: ctx.num(`ring${i}Radius`),
          angle: sweep,
          aspect: ctx.num(`ring${i}Aspect`),
          rotate: ctx.num(`ring${i}Rotate`),
          flip: ctx.bool(`ring${i}Flip`),
        })
      : null
    return {
      shape,
      anchor: ctx.vec(`ring${i}At`),
      stops: [{ t: 0, color: slotColor(ctx, ctx.num(`ring${i}Color`)), gain: ctx.num(`ring${i}Gain`) }],
      near: Array.from({ length: NEAR }, (_, k) => readNear(ctx, `ring${i}n${k + 1}`, soften, gain)),
      far: Array.from({ length: FAR }, (_, k) => readFar(ctx, `ring${i}f${k + 1}`, soften, gain)),
      maskShift: ctx.vec(`ring${i}MaskShift`),
      maskGrow: ctx.num(`ring${i}MaskGrow`),
      facing: { strength: ctx.num(`ring${i}Facing`), angle: ctx.num(`ring${i}FacingAngle`), power: ctx.num(`ring${i}FacingPower`) },
    }
  })
}

/**
 * Up to three large curves of light (rings, ellipses, slow S-curves or the
 * logo's outer edge), usually cropped by the frame. Each is a thin emitter with
 * its own point-spread function: near parts integrated along the curve and far
 * parts from blurred copies of that curve's light alone. Where curves come close
 * or cross, their light adds.
 */
export const contourHalo: RecipeDefinition = {
  id: 'contour.halo',
  mood: 'contour',
  label: 'Halo',
  colorSlots: Array.from({ length: COLORS }, (_, i) => ({ key: `c${i + 1}`, label: `Color ${i + 1}` })),
  defaultColors: ['#000000', '#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00', '#FFFFFF', '#000000', '#000000'],
  params,
  fragment: /* glsl */ `
${curveLightGlsl(HALO_LAYOUT)}
vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }
vec3 auxRadiance(vec2 uv, vec2 p) { return clAux(p, true); }
vec3 combine(vec2 uv, vec2 p, vec3 light, vec3 b0, vec3 b1, vec3 b2, vec3 b3) { return light + curveLight(p, b0, b1, b2, b3, true); }
`,
  uniforms: (ctx) => {
    const base = slotColor(ctx, ctx.num('base')).map((v) => v * ctx.num('baseGain'))
    return curveLightUniforms(HALO_LAYOUT, haloEmitters(ctx), readLights(ctx), base, ctx.num('farWidth') * ctx.num('soften'), ctx.num('farStep'))
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
  compose: composeHalo,
}
