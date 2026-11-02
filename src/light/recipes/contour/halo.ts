import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, ParamSpec, ParamValue, RecipeDefinition } from '../../scene'
import {
  frameSize,
  geo,
  lerp,
  pickBase,
  pickLight,
  pointAlong,
  productionParts,
  round4,
  seededRandom,
  toFrame,
  visiblePath,
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
  slotColor,
  type CurveLightLayout,
  type EmitterSettings,
} from './curveLight'
import { ring, type Vec2 } from './shapes'

const COLORS = 8
const RINGS = 3
const NEAR = 3
const FAR = 3
const LAYOUT: CurveLightLayout = { emitters: RINGS, primitives: 40, near: NEAR, far: FAR }

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

/** One ring with its center off the frame, so only an arc shows; the glow spreads into the disc or out from behind it. */
function composeHalo({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const rand = seededRandom(seed, 13)
  const light = pickLight(pack, rand)
  const base = pickBase(pack, rand)
  const [fw, fh] = frameSize(aspect)
  const inward = rand() < 0.6
  const corner = rand() < 0.6
  const sx = rand() < 0.5 ? 1 : -1
  const sy = rand() < 0.6 ? -1 : 1
  // Direction of the ring's center from the frame center: past a corner or past an edge.
  const direction: Vec2 = corner
    ? [sx * fw * lerp(0.4, 0.6, rand()), sy * fh * lerp(0.4, 0.6, rand())]
    : rand() < (aspect >= 1 ? 0.6 : 0.3)
      ? [sx * fw * 0.5, fh * lerp(-0.15, 0.15, rand())]
      : [fw * lerp(-0.2, 0.2, rand()), sy * fh * 0.5]
  const length = Math.hypot(direction[0], direction[1])
  const unit: Vec2 = [direction[0] / length, direction[1] / length]
  let radius = lerp(0.6, 1.5, rand()) * Math.min(fw, fh)
  const gap = lerp(0.06, 0.28, rand()) * Math.min(fw, fh)
  // Keep the center off the frame so the ring never shows whole.
  const edge = Math.min(Math.abs(fw / 2 / (unit[0] || 1e-9)), Math.abs(fh / 2 / (unit[1] || 1e-9)))
  radius = Math.max(radius, edge + 0.1 - gap)
  const center: Vec2 = [unit[0] * (radius + gap), unit[1] * (radius + gap)]
  const path = visiblePath(ring(radius), center, aspect)
  const fromStart = rand() < 0.5
  const along = fromStart ? lerp(0, 0.5, controls.mood) : lerp(1, 0.5, controls.mood)
  const hot = pointAlong(path, along) ?? center
  const at: Vec2 = [hot[0] - center[0], hot[1] - center[1]]
  const gain = geo(controls.intensity, 0.35, 1, 2.8)
  const soften = geo(controls.softness, 0.55, 1, 1.9)
  const reach = lerp(0.1, 0.2, rand()) * Math.max(fw, fh)
  const side = inward ? 1 : 2
  const toward = (Math.atan2(at[1], at[0]) * 180) / Math.PI
  const params: Record<string, ParamValue> = {
    ring1On: true,
    ring1At: toFrame(center, aspect).map(round4),
    ring1Radius: round4(radius),
    ring1Aspect: 1,
    ring1Sweep: 360,
    ring1Color: 2,
    ring1Gain: 1,
    ...productionParts('ring1', { hex: light.hex, side, soften, face: 0, glow: 0.012, haze: 0.06, outer: 0.05 }),
    ring1Facing: 0.7,
    ring1FacingAngle: round4(toward),
    ring1FacingPower: 1.5,
    ring2On: false,
    ring3On: false,
    farWidth: 0.012,
    light1Kind: 3,
    light1At: at.map(round4),
    light1Radius: round4(reach),
    light1Power: round4(lerp(1.4, 2.2, rand())),
    light2Kind: 1,
    light2At: at.map(round4),
    light2Radius: round4(lerp(0.06, 0.14, rand())),
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

/**
 * Up to three rings or arcs of light, usually cropped by the frame. Each ring
 * is a thin emitter with its own point-spread function: near parts integrated
 * along the ring and far parts from blurred copies of that ring's light alone.
 * Where rings come close or cross, their light adds.
 */
export const contourHalo: RecipeDefinition = {
  id: 'contour.halo',
  mood: 'contour',
  label: 'Halo',
  colorSlots: Array.from({ length: COLORS }, (_, i) => ({ key: `c${i + 1}`, label: `Color ${i + 1}` })),
  defaultColors: ['#000000', '#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00', '#FFFFFF', '#000000', '#000000'],
  params,
  fragment: /* glsl */ `
${curveLightGlsl(LAYOUT)}
vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }
vec3 auxRadiance(vec2 uv, vec2 p) { return clAux(p, true); }
vec3 combine(vec2 uv, vec2 p, vec3 light, vec3 b0, vec3 b1, vec3 b2, vec3 b3) { return light + curveLight(p, b0, b1, b2, b3, true); }
`,
  uniforms: (ctx) => {
    const gain = ctx.num('gain')
    const soften = ctx.num('soften')
    const emitters: EmitterSettings[] = Array.from({ length: RINGS }, (_, index) => {
      const i = index + 1
      const sweep = ctx.num(`ring${i}Sweep`)
      const shape = ctx.bool(`ring${i}On`)
        ? buildShape({
            kind: sweep >= 359.99 ? 'ring' : 'arc',
            size: ctx.num(`ring${i}Radius`),
            angle: sweep,
            aspect: ctx.num(`ring${i}Aspect`),
            rotate: ctx.num(`ring${i}Rotate`),
            flip: false,
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
    const base = slotColor(ctx, ctx.num('base')).map((v) => v * ctx.num('baseGain'))
    return curveLightUniforms(LAYOUT, emitters, readLights(ctx), base, ctx.num('farWidth') * soften, ctx.num('farStep'))
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
