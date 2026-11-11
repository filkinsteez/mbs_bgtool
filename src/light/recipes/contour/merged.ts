import { linearToOklab } from '../../color/oklab'
import type { ColorPack } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import { MEET_GLSL } from '../../engine/meet'
import type { ParamSpec, RecipeContext, RecipeDefinition } from '../../scene'
import { frameSize, paleBridge } from './curveCompose'
import {
  airParams,
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
  slotColor,
  type CurveLightLayout,
  type EmissionStop,
  type EmitterSettings,
} from './curveLight'
import { composeMergedLook, mergedShape, startedShape } from './mergedCompose'
import { MERGED_SHAPE_KINDS } from './mergedShapes'
import type { Vec2 } from './shapes'

const COLORS = 8
const UNITS = 3
const STOPS = 8
// Three emitters (one per group of colors that dim together, and the lights of their own) of up to 64 pieces each, as
// Halo's rings: far pieces of a large shape are merged into chords, and only the contour the light is on is cut at the
// color stops. A fourth emitter of 64 pieces passes WebGL's 1024 uniform vectors (each piece takes four).
export const MERGED_LAYOUT: CurveLightLayout = { emitters: UNITS, primitives: 64, near: 3, far: 3 }

/**
 * The lights of their own besides the main one (a second light, a third): each is a unit lit only by its own stops,
 * with its own core, glow, haze and face, and the other units go dark round the middle of its stretch (its gap). Each
 * takes a unit the main light's colors leave free; more fit by adding a name here.
 */
export const OWN_LIGHTS = [
  { name: 'second', label: 'Second light', gap: 'gap' },
  { name: 'third', label: 'Third light', gap: 'gap3' },
] as const

const ownLightParams = ({ name, label, gap }: (typeof OWN_LIGHTS)[number]): ParamSpec[] => [
  { kind: 'number', key: `${name}Unit`, label: `Unit that is the ${label.toLowerCase()} (0 none)`, min: 0, max: UNITS, step: 1, default: 0 },
  { kind: 'vector', key: `${name}At`, label: `${label}, from the origin`, min: -40, max: 40, step: 0.0001, default: [-40, -40] },
  { kind: 'number', key: `${name}Core`, label: `${label} core line (times the main one)`, min: 0, max: 2, step: 0.01, default: 1 },
  { kind: 'number', key: `${name}Pale`, label: `${label} haze and face in the key color (share)`, min: 0, max: 1, step: 0.01, default: 0 },
  { kind: 'number', key: `${name}Reach`, label: `${label} haze and face reach (times the main ones)`, min: 0.1, max: 2, step: 0.01, default: 0.5 },
  { kind: 'number', key: `${name}FaceSide`, label: `${label} face side (-1 as the main one, 1 inside, 2 outside)`, min: -1, max: 2, step: 1, default: -1 },
  { kind: 'number', key: `${name}Face`, label: `${label} face light (times its haze's share)`, min: 0, max: 8, step: 0.01, default: 1 },
  { kind: 'number', key: `${gap}At`, label: `The other lights go dark here along the ${label.toLowerCase()}'s edge (-1 nowhere)`, min: -1, max: 1, step: 0.0001, default: -1 },
  { kind: 'number', key: `${gap}Contour`, label: `Contour of the ${label.toLowerCase()}'s gap`, min: 0, max: 16, step: 1, default: 0 },
  { kind: 'number', key: `${gap}Dark`, label: `${label} gap dark half length`, min: 0, max: 2, step: 0.0001, default: 0.05 },
  { kind: 'number', key: `${gap}Fade`, label: `${label} gap fade length`, min: 0, max: 2, step: 0.0001, default: 0.1 },
  { kind: 'number', key: `${gap}Depth`, label: `How much of the light the ${label.toLowerCase()}'s gap takes away (0..1)`, min: 0, max: 1, step: 0.0001, default: 1 },
  { kind: 'number', key: `${name}Far`, label: `${label} haze and face (times the main ones, reach halved)`, min: 0, max: 2, step: 0.01, default: 1 },
  { kind: 'number', key: `${name}Glow`, label: `${label} glow width (times the main one)`, min: 0.1, max: 8, step: 0.0001, default: 1 },
  { kind: 'number', key: `${name}GlowWeight`, label: `${label} glow strength (times the main one)`, min: 0, max: 4, step: 0.0001, default: 1 },
  { kind: 'number', key: `${name}GlowSide`, label: `${label} glow side (-1 as the main one, 0 both, 1 inside, 2 outside)`, min: -1, max: 2, step: 1, default: -1 },
]

const unitParams = (i: number): ParamSpec[] => [
  { kind: 'boolean', key: `e${i}On`, label: `Unit ${i} on`, default: false },
  { kind: 'number', key: `e${i}Own`, label: `Unit ${i} own color slot`, min: 1, max: COLORS, step: 1, default: 2 },
  { kind: 'number', key: `e${i}Rest`, label: `Unit ${i} color on the other contours (slot, 1 none)`, min: 1, max: COLORS, step: 1, default: 1 },
  { kind: 'number', key: `e${i}Stops`, label: `Unit ${i} stops`, min: 1, max: STOPS, step: 1, default: 1 },
  { kind: 'vector', key: `e${i}StopAt`, label: `Unit ${i} stops 1-4 along the curve`, min: 0, max: 1, step: 0.0001, default: [0.5, 1, 1, 1] },
  { kind: 'vector', key: `e${i}StopAt2`, label: `Unit ${i} stops 5-8 along the curve`, min: 0, max: 1, step: 0.0001, default: [1, 1, 1, 1] },
  { kind: 'vector', key: `e${i}StopColor`, label: `Unit ${i} stops 1-4 slot (1 none, 10a+b bridge)`, min: 1, max: 99, step: 1, default: [2, 1, 1, 1] },
  { kind: 'vector', key: `e${i}StopColor2`, label: `Unit ${i} stops 5-8 slot`, min: 1, max: 99, step: 1, default: [1, 1, 1, 1] },
  { kind: 'vector', key: `e${i}StopGain`, label: `Unit ${i} stops 1-4 level`, min: 0, max: 4, step: 0.0001, default: [1, 1, 1, 1] },
  { kind: 'vector', key: `e${i}StopGain2`, label: `Unit ${i} stops 5-8 level`, min: 0, max: 4, step: 0.0001, default: [1, 1, 1, 1] },
  { kind: 'number', key: `e${i}StopContour`, label: `Unit ${i} contour its stops are on (-1 the light's)`, min: -1, max: 16, step: 1, default: -1 },
  { kind: 'number', key: `e${i}Level`, label: `Unit ${i} stop lightness (0 the stand-in's)`, min: 0, max: 1, step: 0.001, default: 0 },
  ...driftParams(`e${i}Drift`, `Unit ${i} dim light`),
]

const params: ParamSpec[] = [
  { kind: 'number', key: 'shape', label: 'Shape (1 logo, 2 rounded square, 3 ring, 4 rings)', min: 1, max: 4, step: 1, default: 2 },
  { kind: 'vector', key: 'rings', label: 'Rings beside the main one (shape 4): x, y, radius each, from the origin (short sides)', min: -40, max: 40, step: 0.0001, default: [0, 0, 0, 0, 0, 0] },
  { kind: 'vector', key: 'at', label: 'Shape origin', min: -8, max: 9, step: 0.0001, default: [0.5, 0.5] },
  { kind: 'number', key: 'size', label: 'Size', min: 0, max: 40, step: 0.0001, default: 1 },
  { kind: 'number', key: 'radius', label: 'Corner radius', min: 0, max: 6, step: 0.0001, default: 0.3 },
  { kind: 'number', key: 'rotate', label: 'Rotation', min: -360, max: 360, step: 0.01, default: 0 },
  { kind: 'boolean', key: 'flip', label: 'Mirror', default: false },
  { kind: 'vector', key: 'starts', label: 'Contour starts 1-3', min: -2, max: 2, step: 0.0001, default: [0, 0, 0] },
  { kind: 'number', key: 'stopContour', label: 'Contour the light is on', min: 0, max: 8, step: 1, default: 0 },
  { kind: 'vector', key: 'tipAt', label: 'Sharp tips along their contours, where the light goes out (0..1, -1 none)', min: -1, max: 1, step: 0.0001, default: [-1, -1, -1, -1] },
  { kind: 'vector', key: 'tipContour', label: 'Contours of the sharp tips', min: 0, max: 8, step: 1, default: [0, 0, 0, 0] },
  { kind: 'number', key: 'tipDark', label: 'Unlit stretch either side of a tip', min: 0, max: 1, step: 0.0005, default: 0 },
  { kind: 'number', key: 'tipFade', label: 'Fade before the unlit stretch', min: 0, max: 1, step: 0.0005, default: 0 },
  { kind: 'number', key: 'keySlot', label: 'The key color slot (the light along the edge)', min: 1, max: COLORS, step: 1, default: 2 },
  { kind: 'number', key: 'restBlend', label: 'How far the other contours\' color has turned from the key\'s to their own (0 the key\'s)', min: 0, max: 1, step: 0.0001, default: 1 },
  ...Array.from({ length: UNITS }, (_, k) => k + 1).flatMap(unitParams),
  ...nearParams('n1', 'Core', { Weight: 2.5, Width: 0.0008, Shape: 8, Light: 2 }),
  ...nearParams('n2', 'Glow', { Weight: 0.7, Width: 0.004, Shape: 3, Side: 1, Light: 1, Grow: 2, GrowBy: [1.5, 2] }),
  ...nearParams('n3', 'Near part 3'),
  ...farParams('f1', 'Haze', { Weight: 0.2, Width: 0.016, Side: 1, Light: 1 }),
  ...farParams('f2', 'Halo', { Weight: 0.03, Width: 0.02, Light: 1 }),
  ...farParams('f3', 'Face', { Weight: 0.025, Width: 0.22, Side: 1, Light: 1, LightGamma: 0.5 }),
  { kind: 'number', key: 'farWidth', label: 'Narrowest scatter blur', min: 0.002, max: 0.2, step: 0.0005, default: 0.008 },
  { kind: 'number', key: 'farStep', label: 'Scatter blur step', min: 1.5, max: 5, step: 0.01, default: 2.5 },
  ...lightParams({ light1Kind: 5, light2Kind: 1 }),
  ...airParams(COLORS),
  { kind: 'number', key: 'groundNear', label: 'Room color near the light (slot, 1 black)', min: 1, max: COLORS, step: 1, default: 1 },
  { kind: 'number', key: 'groundFar', label: 'Room color away from the light (slot)', min: 1, max: COLORS, step: 1, default: 1 },
  { kind: 'number', key: 'groundL', label: 'Room lightness (Oklab L)', min: 0, max: 0.4, step: 0.001, default: 0.05 },
  { kind: 'vector', key: 'groundDir', label: 'Room direction x, y, from, to', min: -4, max: 4, step: 0.0001, default: [1, 0, -0.5, 0.7] },
  { kind: 'boolean', key: 'rayOn', label: 'Rays from behind the edge', default: false },
  { kind: 'vector', key: 'rayAt', label: 'Rays from (frame)', min: -2, max: 3, step: 0.0001, default: [0.5, 0.8] },
  { kind: 'vector', key: 'rayShape', label: 'Rays: count, contrast, phase, sky softness', min: 0, max: 100, step: 0.0001, default: [30, 0.6, 0, 1] },
  { kind: 'number', key: 'rayLevel', label: 'Rays level', min: 0, max: 8, step: 0.001, default: 0.9 },
  { kind: 'number', key: 'rayReach', label: 'Rays reach (short sides)', min: 0.05, max: 3, step: 0.001, default: 0.5 },
  { kind: 'number', key: 'rayUnit', label: 'Rays take this unit color', min: 1, max: UNITS, step: 1, default: 1 },
  { kind: 'number', key: 'meetUnit', label: 'Unit whose light meets the others by the meeting rule (a warm light; 0 none)', min: 0, max: UNITS, step: 1, default: 0 },
  ...OWN_LIGHTS.flatMap(ownLightParams),
  { kind: 'vector', key: 'faceDir', label: 'Into the face at the light', min: -1, max: 1, step: 0.0001, default: [0, 1] },
  { kind: 'vector', key: 'partLead', label: 'Color stage: main light with the face near it (place, radius)', min: -9, max: 9, step: 0.0001, default: [-9, -9, -9, -9] },
  { kind: 'vector', key: 'partSecond', label: 'Color stage: second light, 17 points at equal steps along its stretch, x then y (frame units)', min: -9, max: 9, step: 0.0001, default: new Array<number>(34).fill(-9) },
  { kind: 'number', key: 'partWarmFade', label: 'Color stage: second light strength', min: 0, max: 1, step: 0.0001, default: 0 },
  { kind: 'number', key: 'partWarmSide', label: 'Color stage: which half of the second light asks a warm color (1 the second, 0 the first)', min: 0, max: 1, step: 1, default: 1 },
  { kind: 'number', key: 'partEdgeWarm', label: 'Color stage: the second light may ask a warm color (1) or only a cool one (0)', min: 0, max: 1, step: 1, default: 0 },
  { kind: 'number', key: 'partSecondWidth', label: 'Color stage: how wide the second light\'s parts are (short sides)', min: 0.01, max: 0.3, step: 0.0001, default: 0.05 },
  { kind: 'number', key: 'partRing', label: 'Color stage: the second light is a ring of its own on another edge (1) or not (0)', min: 0, max: 1, step: 1, default: 0 },
  { kind: 'vector', key: 'partThird', label: 'Color stage: third light, 9 points at equal steps along its stretch, x then y (frame units)', min: -9, max: 9, step: 0.0001, default: new Array<number>(18).fill(-9) },
  { kind: 'number', key: 'partThirdFade', label: 'Color stage: third light strength', min: 0, max: 1, step: 0.0001, default: 0 },
  { kind: 'number', key: 'partThirdBright', label: 'Color stage: the third light asks the bright color (1) or the cool one (0)', min: 0, max: 1, step: 1, default: 0 },
  { kind: 'vector', key: 'partCool', label: 'Color stage: main light far stretch, first piece', min: -9, max: 9, step: 0.0001, default: [-9, -9, -9, -9] },
  { kind: 'vector', key: 'partCool2', label: 'Color stage: main light far stretch, second piece', min: -9, max: 9, step: 0.0001, default: [-9, -9, -9, -9] },
  { kind: 'vector', key: 'partDark', label: 'Color stage: dim stretch of outline on the other edge (or the main edge)', min: -9, max: 9, step: 0.0001, default: [-9, -9, -9, -9] },
  { kind: 'vector', key: 'partDark2', label: 'Color stage: dim stretch of outline past the main light\'s far stretch', min: -9, max: 9, step: 0.0001, default: [-9, -9, -9, -9] },
  { kind: 'number', key: 'gain', label: 'Overall gain', min: 0, max: 20, step: 0.001, default: 1 },
  { kind: 'number', key: 'soften', label: 'Overall width', min: 0.05, max: 16, step: 0.001, default: 1 },
]

const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const oklabL = (c: readonly number[]) => linearToOklab([c[0], c[1], c[2]])[0]

/** The lightness every light stands at (Meta Blue's, the default lead), so the light and dark layout never follows the colors. */
const STAND_IN_L = oklabL(hexToLinear('#0064E0'))

/** A color lighter than the stand-in is put under less light, so it shows at the stand-in's lightness (as Bands does). */
function underStandIn(c: readonly number[]): number[] {
  const own = oklabL(c)
  const scale = own > STAND_IN_L ? (STAND_IN_L / own) ** 3 : 1
  return c.map((v) => v * scale)
}

/** Whether two linear colors' light mixes to a third hue or grey: both colored and more than 70 degrees apart in Oklab hue. */
function mixesToThird(a: readonly number[], b: readonly number[]): boolean {
  const la = linearToOklab([a[0], a[1], a[2]])
  const lb = linearToOklab([b[0], b[1], b[2]])
  if (Math.hypot(la[1], la[2]) < 0.05 || Math.hypot(lb[1], lb[2]) < 0.05) return false
  const d = Math.abs(Math.atan2(la[2], la[1]) - Math.atan2(lb[2], lb[1])) * (180 / Math.PI)
  return Math.min(d, 360 - d) > 70
}

/**
 * Where two colors meet: pale light at the brighter one's luminance (no lighter, so no bead), mostly grey where the two
 * would mix to a third hue, else their pale mix.
 */
function bridge(a: readonly number[], b: readonly number[]): number[] {
  const level = Math.max(lum(a), lum(b))
  const tint = paleBridge(a, b)
  const t = lum(tint) > 1e-9 ? level / lum(tint) : 0
  const keep = mixesToThird(a, b) ? 0.3 : 0.7
  return tint.map((v) => level + (v * t - level) * keep)
}

/** A slot's color under the stand-in's lightness. */
const litSlot = (ctx: RecipeContext, slot: number) => underStandIn(slotColor(ctx, slot))

/** The other contours' color: from the key's to the unit's own (both at the stand-in's lightness, so the mix is too);
 * none stays none. */
function restColor(ctx: RecipeContext, slot: number, keySlot: number): number[] {
  if (Math.round(slot) === 1) return litSlot(ctx, 1)
  const key = litSlot(ctx, keySlot)
  const own = litSlot(ctx, slot)
  const t = Math.min(1, Math.max(0, ctx.num('restBlend')))
  return key.map((v, c) => v + (own[c] - v) * t)
}

/** A color at a given Oklab lightness, the same in every pack so the design stays one: a lighter color under less
 * light, a darker one under more. */
function atLevel(c: readonly number[], level: number): number[] {
  const own = oklabL(c)
  const scale = own > 1e-6 ? (level / own) ** 3 : 0
  return c.map((v) => v * scale)
}

function unitStops(ctx: RecipeContext, i: number): EmissionStop[] {
  const count = Math.round(ctx.num(`e${i}Stops`))
  const at = [...ctx.vec(`e${i}StopAt`), ...ctx.vec(`e${i}StopAt2`)]
  const slots = [...ctx.vec(`e${i}StopColor`), ...ctx.vec(`e${i}StopColor2`)].map(Math.round)
  const gains = [...ctx.vec(`e${i}StopGain`), ...ctx.vec(`e${i}StopGain2`)]
  const level = ctx.num(`e${i}Level`)
  const lit = (slot: number) => (level > 0 ? atLevel(slotColor(ctx, slot), level) : litSlot(ctx, slot))
  return Array.from({ length: count }, (_, k) => {
    const s = slots[k]
    const color = s >= 10 ? bridge(lit(Math.floor(s / 10)), lit(s % 10)) : lit(s)
    return { t: at[k], color, gain: gains[k] ?? 1 }
  })
}

export function mergedEmitters(ctx: RecipeContext): EmitterSettings[] {
  const gain = ctx.num('gain')
  const soften = ctx.num('soften')
  const [fw, fh] = frameSize(ctx.aspect)
  const at = ctx.vec('at')
  const anchor: Vec2 = [(at[0] - 0.5) * fw, (at[1] - 0.5) * fh]
  const spec = {
    kind: MERGED_SHAPE_KINDS[Math.min(MERGED_SHAPE_KINDS.length - 1, Math.max(0, Math.round(ctx.num('shape')) - 1))],
    size: ctx.num('size'),
    radius: ctx.num('radius'),
    rotate: ctx.num('rotate'),
    flip: ctx.bool('flip'),
    rings: ctx.vec('rings'),
  }
  const shape = startedShape(mergedShape(spec, anchor, ctx.aspect), ctx.vec('starts'))
  const stopContour = Math.round(ctx.num('stopContour'))
  const tipContour = ctx.vec('tipContour')
  const fades = ctx
    .vec('tipAt')
    .flatMap((t, i) => (t >= 0 ? [{ contour: Math.round(tipContour[i]), t, dark: ctx.num('tipDark'), fade: ctx.num('tipFade') }] : []))
  // Along each light of its own the other units go dark, so each light keeps one color there.
  const gaps = OWN_LIGHTS.flatMap(({ gap }) => {
    const t = ctx.num(`${gap}At`)
    return t >= 0 ? [{ contour: Math.round(ctx.num(`${gap}Contour`)), t, dark: ctx.num(`${gap}Dark`), fade: ctx.num(`${gap}Fade`), depth: ctx.num(`${gap}Depth`) }] : []
  })
  const keySlot = ctx.num('keySlot')
  return Array.from({ length: UNITS }, (_, k) => {
    const i = k + 1
    if (!ctx.bool(`e${i}On`)) return { shape: null, anchor: at, stops: [], near: [], far: [], maskShift: [0, 0], maskGrow: 0 }
    // An accent's wide light (its haze and the face it lights) takes the key's color at the same luminance, so the
    // face and the far haze read as the key's light instead of a mix of every color, and no brightness changes.
    // The second light is lit by its own stops along the edge, not by the main light's fields, and keeps its own
    // color from its dim ends to its hot core.
    const ownLight = OWN_LIGHTS.find(({ name }) => Math.round(ctx.num(`${name}Unit`)) === i)
    const second = !!ownLight
    const own = (key: string) => ctx.num(`${ownLight?.name ?? 'second'}${key}`)
    const free = <T extends { light: number }>(part: T): T => (second ? { ...part, light: 0 } : part)
    const accent = !second && Math.round(ctx.num(`e${i}Own`)) !== Math.round(keySlot) && Math.round(ctx.num(`e${i}Rest`)) === 1
    const farPale = [0.5, 0.8, 1]
    // Its wide glow mostly too, so an accent shows as a colored core on the edge, and its dim tail over the key's
    // face never mixes to a third hue; an accent near the key's hue (Cyan beside Meta Blue) keeps more of its own
    // color in its glow, so the line reads as walking from one color to the next.
    const nearPale = accent && !mixesToThird(litSlot(ctx, ctx.num(`e${i}Own`)), litSlot(ctx, keySlot)) ? [0, 0.3, 0] : [0, 0.75, 0]
    const ownContour = Math.round(ctx.num(`e${i}StopContour`))
    return {
      shape,
      anchor: at,
      stops: unitStops(ctx, i),
      stopContour: ownContour >= 0 ? ownContour : stopContour,
      // As the light comes between two edges the other contours turn back to the key's color, so when the light passes
      // to the other edge the two edges' colors don't swap in a jump.
      restStops: [{ t: 0, color: restColor(ctx, ctx.num(`e${i}Rest`), keySlot), gain: 1 }],
      fades: second ? fades : [...fades, ...gaps],
      // The drift measures the light against the color's own level, so a color under the stand-in's lightness dims
      // through its darker neighbour where its light is low.
      own: slotColor(ctx, ctx.num(`e${i}Own`)),
      near: [1, 2, 3].map((n) => {
        const read = free(readNear(ctx, `n${n}`, soften, gain))
        const part =
          second && n === 1
            ? { ...read, weight: read.weight * own('Core') }
            : second && n === 2
              ? {
                  ...read,
                  weight: read.weight * own('GlowWeight'),
                  sigma: read.sigma * own('Glow'),
                  ...(own('GlowSide') >= 0 ? { side: own('GlowSide') } : {}),
                }
              : read
        return accent ? { ...part, pale: nearPale[n - 1] } : part
      }),
      far: [1, 2, 3].map((n) => {
        const read = free(readFar(ctx, `f${n}`, soften, gain))
        // The second light's haze and face may take the key's color at the same luminance, so its own color stays on
        // its stretch of the edge and never mixes over the key's face.
        const faceSide = n === 3 && own('FaceSide') >= 0 ? { side: own('FaceSide') } : {}
        const f = second ? { ...read, ...faceSide, weight: read.weight * own('Far') * (n === 3 ? own('Face') : 1), sigma: read.sigma * own('Reach'), pale: own('Pale') * farPale[n - 1] } : read
        return accent ? { ...f, pale: farPale[n - 1] } : f
      }),
      maskShift: [0, 0],
      maskGrow: 0,
      drift: readDrift(ctx, `e${i}Drift`),
      ...(accent || (second && own('Pale') > 0) ? { pale: litSlot(ctx, keySlot) } : {}),
    }
  })
}

function groundColor(ctx: RecipeContext, slot: number): number[] {
  const c = slotColor(ctx, slot)
  const own = oklabL(c)
  return own > 1e-4 ? c.map((v) => v * (ctx.num('groundL') / own) ** 3) : [0, 0, 0]
}

/**
 * Contour, merged: one light along a pre-made shape (crops of the Meta symbol's curves, a rounded square, a cropped
 * ring; up close and out of focus; behind a horizon with rays; a wide soft wash). Up to three emitters share the shape,
 * one per group of colors that dim together, each with its own dim drift. Every color stands at one lightness, so the
 * light and dark layout is the same for any colors.
 */
export const contourMerged: RecipeDefinition = {
  id: 'contour.merged',
  mood: 'contour',
  label: 'Merged',
  colorSlots: Array.from({ length: COLORS }, (_, i) => ({ key: `c${i + 1}`, label: `Color ${i + 1}` })),
  defaultColors: ['#000000', '#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00', '#000000', '#000000', '#000000'],
  params,
  fragment: /* glsl */ `
${curveLightGlsl(MERGED_LAYOUT)}
${MEET_GLSL}
uniform vec3 uGroundNear;
uniform vec3 uGroundFar;
uniform vec4 uGroundDir;
uniform vec4 uRay;
uniform vec4 uRayShape;
uniform vec3 uRayColor;
uniform float uRayUnit;
uniform float uRayReach;
uniform float uMeetUnit;
float cmLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// meetColors5 for two colors, the same result with one meetTint instead of two: the trailing color's tint (nothing of
// it kept) is white at luminance 1.
vec3 cmMeet2(vec3 c0, float q0, vec3 c1, float q1, float sharp) {
  float top = max(q0, q1);
  float l0 = pow(max(q0, 0.0) / top, sharp);
  float l1 = pow(max(q1, 0.0) / top, sharp);
  float sum = l0 + l1;
  l0 /= sum;
  l1 /= sum;
  vec3 plain = (max(q0, 0.0) * c0 + max(q1, 0.0) * c1) / (max(q0, 0.0) + max(q1, 0.0));
  if (l0 * l1 <= 1e-12) return plain;
  float d0 = max(0.0, 2.0 * l0 - 1.0);
  float d1 = max(0.0, 2.0 * l1 - 1.0);
  vec3 far = l0 * (d0 > 0.0 ? meetTint(c0, d0 * d0) : vec3(1.0)) + l1 * (d1 > 0.0 ? meetTint(c1, d1 * d1) : vec3(1.0));
  return mix(plain, far, meetApart(c0, c1));
}
// Where a warm unit's light meets the others' (Meta Blue's), by the engine's meeting rule as Rush uses it: along the
// line where the two are equal the light rises where it is lit, and where it is dim the two keep their own colors and
// dim through their own dark shades toward black, instead of adding up to a mixed hue (maroon, purple, mauve).
vec3 contourMeet(vec3 e0, vec3 e1, vec3 e2) {
  if (uMeetUnit < -0.5) return e0 + e1 + e2;
  int w = int(uMeetUnit + 0.5);
  vec3 warm = w == 0 ? e0 : (w == 1 ? e1 : e2);
  vec3 other = e0 + e1 + e2 - warm;
  float lw = cmLum(warm);
  float lo = cmLum(other);
  float total = lw + lo;
  // Where one light is a negligible share of the other, or their hues are not far apart, the meeting changes nothing:
  // the light is their sum (most of a frame, so it skips the rule's cost there).
  if (min(lw, lo) <= 1e-4 * total) return warm + other;
  vec3 hOther = other / lo;
  vec3 hWarm = warm / lw;
  float apart = meetApart(hOther, hWarm);
  if (apart <= 0.0) return warm + other;
  float shown = total < 0.5 ? total : 0.5 + 0.4 * (1.0 - exp(-(total - 0.5) / 0.4));
  float meetHere = meetBridgeShares(lo / total, lw / total) * apart;
  float litHere = meetBridgeLit(shown);
  float metShown = meetDarkLight(meetBridgeLight(shown, meetHere * litHere), 0.6 * meetHere * (1.0 - litHere));
  // Lit, the soft hand-over through a light middle; dim, the two lights' own sum, darkened along the meeting line by
  // the dip above (the dim half's sharp hand-over drew a hard rim round the warm light's glow).
  vec3 dimHue = (warm + other) / total;
  vec3 hue = dimHue / max(cmLum(dimHue), 1e-5);
  if (litHere > 0.0) {
    vec3 litHue = cmMeet2(hOther, lo, hWarm, lw, 3.0);
    hue = mix(hue, litHue / max(cmLum(litHue), 1e-5), litHere);
  }
  return hue / max(cmLum(hue), 1e-5) * total * metShown / max(shown, 1e-5);
}
float rayHash(float i) { return fract(sin(i * 127.1 + 311.7) * 43758.5453); }
float rayNoise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(rayHash(i), rayHash(i + 1.0), f * f * (3.0 - 2.0 * f));
}
vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }
vec3 auxRadiance(vec2 uv, vec2 p) { return clAux(p, true); }
vec3 combine(vec2 uv, vec2 p, vec3 light, vec3 b0, vec3 b1, vec3 b2, vec3 b3) {
  vec3 e0;
  vec3 e1;
  vec3 e2;
  vec3 rest = curveLightEach(p, b0, b1, b2, b3, true, e0, e1, e2);
  vec3 color = light + rest + contourMeet(e0, e1, e2);
  color += mix(uGroundNear, uGroundFar, smoothstep(uGroundDir.z, uGroundDir.w, dot(p, uGroundDir.xy)));
  if (uRay.w > 0.5) {
    // Light from behind the edge seen through haze: brightest at its source, in rays, only above the edge.
    vec2 d = p - uRay.xy;
    float r = length(d);
    float x = atan(d.y, d.x) / TAU * uRayShape.x + uRayShape.z;
    float n = 0.6 * rayNoise(x) + 0.4 * rayNoise(2.37 * x + 5.1);
    float pattern = mix(1.0, 0.2 + 1.6 * n, uRayShape.y);
    float glow = uRay.z * exp(-r / uRayReach) * (0.08 / (r + 0.08));
    int e = int(uRayUnit + 0.5);
    float sd = clEmitterMask(e, p - clAnchor(e));
    float sky = smoothstep(-0.004, 0.02 + 0.03 * uRayShape.w, sd);
    color += clDrift(uRayColor * (glow * pattern * sky), uClEmit[e * 5 + 2].rgb, uClEmit[e * 5 + 3], uClEmit[e * 5 + 4].x);
  }
  return color;
}
`,
  uniforms: (ctx) => {
    const [fw, fh] = frameSize(ctx.aspect)
    const rayAt = ctx.vec('rayAt')
    const rayUnit = Math.round(ctx.num('rayUnit'))
    // An off-frame light's glow at the frame's edge stands at the stand-in's lightness too.
    const air = readAir(ctx, ctx.num('gain')).map((g) => ({ ...g, color: underStandIn(g.color) }))
    return {
      ...curveLightUniforms(
        MERGED_LAYOUT,
        mergedEmitters(ctx),
        readLights(ctx),
        [0, 0, 0],
        ctx.num('farWidth') * ctx.num('soften'),
        ctx.num('farStep'),
        ctx.aspect,
        air,
      ),
      uGroundNear: groundColor(ctx, ctx.num('groundNear')),
      uGroundFar: groundColor(ctx, ctx.num('groundFar')),
      uGroundDir: ctx.vec('groundDir'),
      uRay: [(rayAt[0] - 0.5) * fw, (rayAt[1] - 0.5) * fh, ctx.num('rayLevel') * ctx.num('gain'), ctx.bool('rayOn') ? 1 : 0],
      uRayShape: ctx.vec('rayShape'),
      uRayColor: litSlot(ctx, ctx.num(`e${rayUnit}Own`)),
      uRayUnit: rayUnit - 1,
      uRayReach: ctx.num('rayReach'),
      uMeetUnit: ctx.num('meetUnit') - 1,
    }
  },
  scatter: farScatter(
    (ctx) => ctx.num('farWidth') * ctx.num('soften'),
    (ctx) => ctx.num('farStep'),
  ),
  lens: { bloom: 0 },
  fromPack: (pack: ColorPack) => ['#000000', ...pack.colors.map((c) => c.hex), '#000000', '#000000', '#000000'].slice(0, COLORS),
  compose: composeMergedLook,
}
