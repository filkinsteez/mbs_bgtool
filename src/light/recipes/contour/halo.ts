import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, ParamSpec, ParamValue, RecipeContext, RecipeDefinition } from '../../scene'
import {
  accentParams,
  blockPlan,
  dragLight,
  falloffRadius,
  FLAT_POWER,
  flatRadius,
  frameSize,
  geo,
  haloParts,
  arcParts,
  offFrameGlow,
  packAccent,
  packBase,
  ringPartner,
  ringParts,
  suitsRings,
  lerp,
  logoPartsShown,
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
  warmDrift,
  warmTail,
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
  type EmitterSettings,
  type ShapeSettings,
} from './curveLight'
import { distanceToShape, META_LOGO_LANDMARKS, META_LOGO_PARTS, windingNumber, type Vec2 } from './shapes'

const COLORS = 8
const RINGS = 3
const NEAR = 3
const FAR = 3
export const HALO_LAYOUT: CurveLightLayout = { emitters: RINGS, primitives: 64, near: NEAR, far: FAR }
/** The most of a ring's inside glow that takes a Meta Blue light's pale color (packAccent's `air`). */
const RING_HAZE_PALE = 0.6

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
    { kind: 'number', key: `ring${i}Color2`, label: `Ring ${i} second color slot, shifting around the ring (0 none)`, min: 0, max: COLORS, step: 1, default: 0 },
    { kind: 'number', key: `ring${i}ColorTurns`, label: `Ring ${i} color cycles around the ring`, min: 1, max: 8, step: 1, default: 3 },
    { kind: 'number', key: `ring${i}Pale`, label: `Ring ${i} pale color slot, for parts with a pale share (0 none)`, min: 0, max: COLORS, step: 1, default: 0 },
    { kind: 'number', key: `ring${i}Gain`, label: `Ring ${i} gain`, min: 0, max: 20, step: 0.001, default: 1 },
    { kind: 'vector', key: `ring${i}MaskShift`, label: `Ring ${i} inside edge shift`, min: -2, max: 2, step: 0.0005, default: [0, 0] },
    { kind: 'number', key: `ring${i}MaskGrow`, label: `Ring ${i} inside edge grow`, min: -2, max: 2, step: 0.0001, default: 0 },
    { kind: 'number', key: `ring${i}Facing`, label: `Ring ${i} edges facing the light get more of it`, min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'number', key: `ring${i}FacingAngle`, label: `Ring ${i} light comes from (degrees)`, min: -360, max: 360, step: 0.1, default: 0 },
    { kind: 'number', key: `ring${i}FacingPower`, label: `Ring ${i} facing falloff`, min: 0.1, max: 8, step: 0.01, default: 1 },
    ...driftParams(`ring${i}Drift`, `Ring ${i} dim light`),
    ...near.flatMap((defaults, k) => nearParams(`ring${i}n${k + 1}`, `Ring ${i} near part ${k + 1}`, defaults)),
    ...far.flatMap((defaults, k) => farParams(`ring${i}f${k + 1}`, `Ring ${i} far part ${k + 1}`, defaults)),
  ]
}

const params: ParamSpec[] = [
  ...Array.from({ length: RINGS }, (_, i) => ringParams(i + 1)).flat(),
  { kind: 'number', key: 'farWidth', label: 'Narrowest scatter blur', min: 0.002, max: 0.2, step: 0.0005, default: 0.008 },
  { kind: 'number', key: 'farStep', label: 'Scatter blur step', min: 1.5, max: 5, step: 0.01, default: 2.5 },
  ...lightParams({ light1Kind: 1, light1At: [-0.75, -0.75], light1Radius: 0.45 }),
  ...airParams(COLORS),
  { kind: 'number', key: 'base', label: 'Base color slot (0 black)', min: 0, max: COLORS, step: 1, default: 0 },
  { kind: 'number', key: 'baseGain', label: 'Base gain', min: 0, max: 2, step: 0.0005, default: 0 },
  { kind: 'number', key: 'gain', label: 'Overall gain', min: 0, max: 20, step: 0.001, default: 1 },
  { kind: 'number', key: 'soften', label: 'Overall width', min: 0.05, max: 8, step: 0.001, default: 1 },
]

/**
 * Outer-contour points of the logo (logo units) a tight halo crop centers on:
 * the convex parts only (loop ends, loop tops, the bottoms). The halo lights
 * the outside of the curve, so at the notch or where the loops meet below the
 * light would fill the gap between two arms as a wedge with a sharp corner.
 */
const LOGO_EDGE_FEATURES: readonly (readonly [Vec2, number])[] = [
  [[1000, 1655.86], 2],
  [[2504.83, 1649.66], 2],
  [[1432.41, 1000], 1],
  [[2080, 1000], 1],
  [[1273.1, 2000], 1],
  [[2245.5, 2000], 1],
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
/** Least it should turn, so its sharp inner edge reads as a curve, not a straight side. */
const MIN_TURN = (32 * Math.PI) / 180

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

/**
 * A large curve crossing the part of the frame toward `where` (one of PLACES):
 * a ring or ellipse centered off the frame that way, or a crop of the logo's
 * outer edge with its feature that way.
 */
function haloLayout(kind: 'ring' | 'ellipse' | 'logoEdge', rand: () => number, aspect: number, where: Vec2): HaloLayout {
  const [fw, fh] = frameSize(aspect)
  const short = Math.min(fw, fh)
  const toward = rotate([where[0] * fw, where[1] * fh], lerp(-12, 12, rand()))
  const unit: Vec2 = [toward[0] / Math.hypot(toward[0], toward[1]), toward[1] / Math.hypot(toward[0], toward[1])]
  // Each kind places its curve at a scale; a curve that turns too much inside the frame is drawn larger.
  const draw = (): HaloLayout => {
    let place: (scale: number) => HaloLayout
    switch (kind) {
      case 'ring':
      case 'ellipse': {
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
      case 'logoEdge': {
        // A tight crop: the logo is 3 to 6 short sides tall and one part of its outline shows, turned so that
        // the feature lies toward `where` and the logo body runs off the frame beyond it.
        const feature = pickWeighted(rand, LOGO_EDGE_FEATURES)
        const size = lerp(3, 6, rand())
        const from = Math.atan2(feature[1] - LOGO_CENTER[1], feature[0] - LOGO_CENTER[0])
        const turn = ((Math.atan2(-where[1], -where[0]) - from) * 180) / Math.PI + lerp(-15, 15, rand())
        const out = lerp(0.12, 0.32, rand())
        place = (scale) => {
          const local = rotate([((feature[0] - LOGO_CENTER[0]) / 1000) * size * scale, ((feature[1] - LOGO_CENTER[1]) / 1000) * size * scale], turn)
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
    // Rings and ellipses that turn too much inside the frame read as a planet. A logo crop may turn more (a loop
    // end), but never shows the whole logo: one part of the outline, and at most one of the crossing and the two
    // loop tops.
    const tooMuch = (l: HaloLayout) =>
      kind === 'logoEdge'
        ? logoPartsShown(META_LOGO_PARTS, l.shape.size, l.shape.rotate, l.shape.flip, l.anchor, aspect) > 1 ||
          pointsNearFrame(META_LOGO_LANDMARKS, l.shape.size, l.shape.rotate, l.shape.flip, l.anchor, aspect, 0.05 + 0.15 * l.shape.size) > 1
        : turnOf(l) > MAX_TURN
    let layout = place(1)
    for (let scale = 1.2; scale < 12 && tooMuch(layout); scale *= 1.2) layout = place(scale)
    return layout
  }
  const turnOf = (l: HaloLayout) => turning(longestRun(visibleRuns(buildShape(l.shape), l.anchor, aspect)))
  // A curve that hardly turns inside the frame reads as a straight hard side (C-027), so a few draws keep the
  // first that turns at least MIN_TURN, or else the one that turns most.
  let best = draw()
  let bestTurn = turnOf(best)
  for (let attempt = 1; attempt < 8 && bestTurn < MIN_TURN; attempt++) {
    const next = draw()
    const t = turnOf(next)
    if (t > bestTurn) {
      best = next
      bestTurn = t
    }
  }
  return best
}

/**
 * A second ring that crosses the first inside the frame (iridescent-rings reference): centered off the frame in a
 * direction 55 to 110 degrees from the first ring's center, so both arcs pass near the frame center and cross there,
 * and neither ring shows whole.
 */
function crossingRing(first: HaloLayout, rand: () => number, aspect: number): HaloLayout {
  const [fw, fh] = frameSize(aspect)
  const short = Math.min(fw, fh)
  const length = Math.hypot(first.anchor[0], first.anchor[1]) || 1
  const unit = rotate([first.anchor[0] / length, first.anchor[1] / length], (rand() < 0.5 ? 1 : -1) * lerp(55, 110, rand()))
  const radius = lerp(0.6, 1.2, rand()) * short
  const gap = lerp(0.02, 0.18, rand()) * short
  const edge = Math.min(Math.abs(fw / 2 / (unit[0] || 1e-9)), Math.abs(fh / 2 / (unit[1] || 1e-9)))
  const shape: ShapeSettings = { kind: 'ring', size: Math.max(radius, edge + 0.1 - gap), angle: 360, aspect: 1, rotate: rand() * 360, flip: false }
  const distance = Math.max(ringDistance(shape, unit, gap), edge + 0.1)
  return { shape, anchor: [unit[0] * distance, unit[1] * distance] }
}

/**
 * One large curve of light crossing the frame (never a whole ring), lit like a
 * halo around an off-frame source: crest on the curve, long falloff outward,
 * short flank inward, the inside at the base level, and the light falling
 * along the curve away from the hot spot.
 */
function composeHalo({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const rand = seededRandom(seed, 13)
  // A block of 8 seeds shows four logo crops, two ellipses and two rings, each lighting a different part of the frame.
  const plan = blockPlan(pack, seed, 67, ['logoEdge', 'logoEdge', 'logoEdge', 'logoEdge', 'ellipse', 'ellipse', 'ring', 'ring'] as const)
  const light = pickLight(pack, rand, seed, 67)
  const seedBase = pickBase(pack, rand, light.hex)
  const layout = haloLayout(plan.kind, rand, aspect, plan.place)
  // Ring seeds are two thin glass rims that cross, their color shifting around each ring, their insides faintly
  // lit and their light adding where they overlap (iridescent-rings reference); the others are a crest with a long
  // fade outward.
  const rings = plan.kind === 'ring' && suitsRings(light)
  // Ellipse seeds are a broad pale arc with the light's saturated color inside it (yellow-halo reference, on dark).
  // A Tan light keeps its bright bands.
  const paleArc = plan.kind === 'ellipse' && warmTail(light.hex) !== 'bright'
  const crossing = rings ? crossingRing(layout, rand, aspect) : null
  const partner = rings ? ringPartner(pack, light) : null
  // The hot spot and the falloff follow the longest piece of the curve inside the frame.
  const runs = visibleRuns(buildShape(layout.shape), layout.anchor, aspect)
  const path = longestRun(runs)
  const fromStart = rand() < 0.5
  // The Light control runs the hot spot from where the curve leaves the frame toward its middle, eased so equal
  // steps of the slider change the picture by about the same amount (it moves half as fast near the middle).
  const along = (mood: number) => {
    const eased = (4 * mood - mood * mood) / 3
    return fromStart ? lerp(0, 0.5, eased) : lerp(1, 0.5, eased)
  }
  // A dragged line puts the hot spot on the curve nearest its start and runs the light along the curve its way
  // (SHARED.md, "Dragging the light"); the Light control then doesn't move it again.
  const dragged = controls.drag ? dragLight(controls.drag, runs, aspect) : null
  const hot = dragged?.hot ?? pointAlong(path, along(controls.mood)) ?? layout.anchor
  const home = dragged?.hot ?? pointAlong(path, along(0.5)) ?? layout.anchor
  const accent = accentParams(packAccent(pack, light, 'halo'), pointAlong(path, along(0.5)) ?? layout.anchor, hot, aspect, controls.drag)
  const base = packBase(seedBase, accent.base)
  const at: Vec2 = [hot[0] - layout.anchor[0], hot[1] - layout.anchor[1]]
  const gain = geo(controls.intensity, 0.35, 1, 2.8)
  const soften = geo(controls.softness, 0.45, 1, 2.4)
  // Light falls 20 to 60 times from the hot spot to the far end of the visible curve (sized at the default
  // hot spot, so the Light control moves the light without resizing it). The light field is six times longer
  // across the curve, so the glow keeps its long fade outward near the hot spot.
  // A Tan light keeps most of its light at or above Tan's own brightness: near full along most of the curve, then
  // a rounded shoulder and the same 20 to 60 times fall over a short stretch (a flat-top field).
  const bright = warmTail(light.hex) === 'bright'
  const powerDraw = rand()
  const power = bright ? FLAT_POWER : lerp(2, 3, powerDraw)
  const across = normalNear(path, hot, 12)
  // Rims and the pale arcs are lit most of the way along (3 to 5 times dimmer at the far end of the visible curve);
  // a Tan crescent keeps its short fall. A dragged line's light is 20 to 60 times dimmer at the line's end.
  const factorDraw = rand()
  const factor = bright && !rings ? lerp(20, 60, factorDraw) : lerp(3, 5, factorDraw)
  const dragFactor = lerp(20, 60, factorDraw)
  const stretch = { direction: normalNear(path, home, 12), by: 6 }
  const radius = bright ? flatRadius(path, home, factor, power, stretch) : falloffRadius(path, home, factor, power, stretch)
  // A dragged light stays near full along the curve and then falls over a rounded shoulder: with a gaussian fall a
  // short line's patch is a long thin ellipse whose ends read as points, most of all where the curve leaves the frame.
  // A Tan light's flat top falls too fast here: the patch's end reads as a cut edge.
  const dragPower = 4
  const drift = warmDrift(light.hex)
  const ring1Parts = rings ? ringParts('ring1') : paleArc ? arcParts('ring1', light.hex) : haloParts('ring1', light.hex)
  // The widest haze: a crest's outer fade, a pale arc's or a ring's inside glow. A ring's only dims: brighter, it
  // fills the ring like a sail.
  const hazeKey = rings || paleArc ? 'ring1f1Weight' : 'ring1f2Weight'
  const hazeGain = rings ? Math.min(1, accent.haze) : accent.haze
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
    ...ring1Parts,
    ...(hazeGain !== 1 ? { [hazeKey]: round4(Number(ring1Parts[hazeKey] ?? 0) * hazeGain) } : {}),
    ...(rings && partner ? { ring1Color2: 4 } : {}),
    ...(drift ? { ring1Drift: drift.ratios, ring1DriftShape: [drift.knee, drift.sharpness] } : {}),
    ring1Pale: accent.pale ? 5 : 0,
    // A colored band's body is far part 3 (and far part 1 outside a crest); the rest of the far light is haze.
    ...Object.fromEntries((rings ? [] : paleArc ? ['f3'] : ['f1', 'f3']).map((k) => [`ring1${k}Pale`, accent.body])),
    // A ring's insides keep some of the light's color: fully grey, Meta Blue rings look like Ice ones.
    ...Object.fromEntries(
      (rings || paleArc ? ['f1', 'f2'] : ['f2']).map((k) => [`ring1${k}Pale`, rings ? Math.min(accent.air, RING_HAZE_PALE) : accent.air]),
    ),
    ...accent.params,
    ...offFrameGlow(controls.drag, light.hex, aspect, accent.edge),
    ring2On: Boolean(crossing),
    ...(crossing
      ? {
          ring2Shape: SHAPE_KINDS.indexOf('ring') + 1,
          ring2At: toFrame(crossing.anchor, aspect).map(round4),
          ring2Radius: round4(crossing.shape.size),
          ring2Aspect: 1,
          ring2Sweep: 360,
          ring2Rotate: round4(crossing.shape.rotate),
          ring2Color: 2,
          ring2Gain: 0.85,
          ...ringParts('ring2'),
          ...(accent.haze < 1 ? { ring2f1Weight: round4(Number(ringParts('ring2').ring2f1Weight) * accent.haze) } : {}),
          ...(partner ? { ring2Color2: 4 } : {}),
          ...(drift ? { ring2Drift: drift.ratios, ring2DriftShape: [drift.knee, drift.sharpness] } : {}),
        }
      : {}),
    ring3On: false,
    farWidth: 0.03,
    farStep: 3,
    // Along a dragged line the light is 20 to 60 times dimmer where the line ends, and only 1.5 times longer across,
    // with a longer least reach than the Rim's: a short line's patch then fades along the curve, instead of a round
    // patch whose edge meets the crisp side at a corner.
    light1Kind: dragged ? 6 : bright ? 5 : 3,
    light1At: at.map(round4),
    light1Radius: round4(dragged ? Math.hypot(dragged.length, 0.4) / Math.log(dragFactor) ** (1 / dragPower) : radius),
    light1Power: round4(dragged ? dragPower : power),
    light1Stretch: dragged ? 1.5 : 6,
    light1Angle: round4(dragged ? dragged.angle : (Math.atan2(across[1], across[0]) * 180) / Math.PI),
    ...(dragged ? { light1Length: dragged.back } : {}),
    light2Kind: 0,
    base: base.gain > 0 ? 3 : 0,
    baseGain: base.gain,
    gain: round4(gain),
    soften: round4(soften),
  }
  return {
    colors: ['#000000', light.hex, base.gain > 0 ? base.hex : '#000000', partner?.hex ?? '#000000', accent.pale ?? '#000000', accent.second ?? '#000000', '#000000', '#000000'],
    params,
    lens: {
      bloom: 0,
      halation: round4(lerp(0.04, 0.2, controls.intensity)),
      halationRadius: round4(0.035 * soften),
      halationTint: light.hex,
      // Film halation spreads red farthest, which rings a white-hot band in red; only a warm light keeps that.
      ...(warmTail(light.hex) ? {} : { halationSpread: 0 }),
    },
    output: { grain: 0, toe: warmToe(light.hex) },
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
    // With a second color the rim shifts between the two around the ring, like thin glass catching the light.
    const color = slotColor(ctx, ctx.num(`ring${i}Color`))
    const second = Math.round(ctx.num(`ring${i}Color2`)) > 0 ? slotColor(ctx, ctx.num(`ring${i}Color2`)) : null
    const turns = Math.max(1, Math.round(ctx.num(`ring${i}ColorTurns`)))
    const ringGain = ctx.num(`ring${i}Gain`)
    const stops = second
      ? Array.from({ length: 2 * turns + 1 }, (_, k) => ({ t: k / (2 * turns), color: k % 2 ? second : color, gain: ringGain }))
      : [{ t: 0, color, gain: ringGain }]
    return {
      shape,
      anchor: ctx.vec(`ring${i}At`),
      stops,
      near: Array.from({ length: NEAR }, (_, k) => readNear(ctx, `ring${i}n${k + 1}`, soften, gain)),
      far: Array.from({ length: FAR }, (_, k) => readFar(ctx, `ring${i}f${k + 1}`, soften, gain)),
      maskShift: ctx.vec(`ring${i}MaskShift`),
      maskGrow: ctx.num(`ring${i}MaskGrow`),
      facing: { strength: ctx.num(`ring${i}Facing`), angle: ctx.num(`ring${i}FacingAngle`), power: ctx.num(`ring${i}FacingPower`) },
      drift: readDrift(ctx, `ring${i}Drift`),
      ...(Math.round(ctx.num(`ring${i}Pale`)) > 0 ? { pale: slotColor(ctx, ctx.num(`ring${i}Pale`)) } : {}),
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
    return curveLightUniforms(
      HALO_LAYOUT,
      haloEmitters(ctx),
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
  compose: composeHalo,
}
