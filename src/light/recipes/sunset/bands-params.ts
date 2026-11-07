import type { ColorSlot, ParamSpec } from '../../scene'

export const BAND_MAX = 6
export const BUMP_MAX = 4
export const PATCH_MAX = 4
export const LIGHT_MAX = 4

/** Param key for band `index` (0-based), e.g. bandKey(0, 'Edges') = 'band1Edges'. */
export function bandKey(index: number, name: BandParamName): string {
  return `band${index + 1}${name}`
}

/** Param key for patch `index` (0-based), e.g. patchKey(0, 'Shape') = 'patch1Shape'. */
export function patchKey(index: number, name: PatchParamName): string {
  return `patch${index + 1}${name}`
}

/** Param key for light `index` (0-based), e.g. lightKey(0, 'Shape') = 'light1Shape'. */
export function lightKey(index: number, name: LightParamName): string {
  return `light${index + 1}${name}`
}

export type BandParamName =
  | 'Edges'
  | 'Fade'
  | 'FadeVary'
  | 'Opacity'
  | 'Light'
  | 'Mode'
  | 'Line'
  | 'Tilt'
  | 'Lean'
  | 'Wave'
  | 'Sun'
  | 'Vary'
  | 'BumpAt'
  | 'BumpWidth'
  | 'BumpTop'
  | 'BumpBottom'
  | 'BumpCover'
  | 'BumpLight'
  | 'Bridge'
  | 'Drift'
  | 'Pale'
  | 'Veil'
  | 'Fall'

export type PatchParamName = 'Shape' | 'Look'
export type LightParamName = 'Shape' | 'Look'

/** How a band combines with what is above it. */
export const MODE_COVER = 0
export const MODE_MULTIPLY = 1
export const MODE_ADD = 2
/** Light that fades in over the band's top and adds to the light above it. */
export const MODE_LIGHT = 3

/** Kinds of light terms. */
export const LIGHT_GLOW = 0
export const LIGHT_DOME = 1
export const LIGHT_SHADE = 2
/** A glow whose light pales its color toward white in that color's own hue (its color slot names the color). */
export const LIGHT_PALE = 3

const zeros = (n: number) => Array.from({ length: n }, () => 0)

function bandSpecs(index: number): ParamSpec[] {
  const n = index + 1
  const key = (name: BandParamName) => bandKey(index, name)
  return [
    // Positions and widths are in frame heights (0 top, 1 bottom); along-x values in frame widths.
    { kind: 'vector', key: key('Edges'), label: `Band ${n} top, bottom`, min: -1, max: 2, step: 0.0005, default: [0.4 + 0.1 * index, 2] },
    // 10-90 width of each edge in the scene, before the lens; 0 is a sharp outline.
    { kind: 'vector', key: key('Fade'), label: `Band ${n} scene width of the top and bottom edge`, min: 0, max: 1, step: 0.0005, default: [0, 0] },
    { kind: 'number', key: key('FadeVary'), label: `Band ${n} change of the scene width along its edges`, min: 0, max: 2, step: 0.01, default: 0 },
    { kind: 'number', key: key('Opacity'), label: `Band ${n} opacity`, min: 0, max: 1, step: 0.005, default: 1 },
    { kind: 'number', key: key('Light'), label: `Band ${n} light`, min: 0, max: 4, step: 0.005, default: 1 },
    { kind: 'number', key: key('Mode'), label: `Band ${n} cover, multiply, add, light`, min: 0, max: 3, step: 1, default: MODE_COVER },
    { kind: 'boolean', key: key('Line'), label: `Band ${n} thin line`, default: false },
    { kind: 'vector', key: key('Tilt'), label: `Band ${n} tilt top, bottom, cover`, min: -1, max: 1, step: 0.0005, default: [0, 0, 0] },
    // Light leans brighter toward one side: exp(2 * lean * (x - 0.5)).
    { kind: 'number', key: key('Lean'), label: `Band ${n} light lean`, min: -1, max: 1, step: 0.005, default: 0 },
    // Broad wave of the top edge, extra wave of the bottom edge (frame heights), and its lattice along the edge (short sides).
    { kind: 'vector', key: key('Wave'), label: `Band ${n} wave top, bottom, length`, min: 0, max: 2, step: 0.0005, default: [0, 0, 0.6] },
    { kind: 'vector', key: key('Sun'), label: `Band ${n} sun light, sun cover`, min: 0, max: 1, step: 0.005, default: [0, 0] },
    // Share of the slow light change inside the band.
    { kind: 'number', key: key('Vary'), label: `Band ${n} light change share`, min: 0, max: 2, step: 0.01, default: 1 },
    { kind: 'vector', key: key('BumpAt'), label: `Band ${n} bump at`, min: -0.5, max: 1.5, step: 0.001, default: [0.2, 0.4, 0.6, 0.8] },
    { kind: 'vector', key: key('BumpWidth'), label: `Band ${n} bump width`, min: 0, max: 1, step: 0.001, default: zeros(BUMP_MAX) },
    { kind: 'vector', key: key('BumpTop'), label: `Band ${n} bump top shift`, min: -0.3, max: 0.3, step: 0.0005, default: zeros(BUMP_MAX) },
    { kind: 'vector', key: key('BumpBottom'), label: `Band ${n} bump bottom shift`, min: -0.3, max: 0.3, step: 0.0005, default: zeros(BUMP_MAX) },
    { kind: 'vector', key: key('BumpCover'), label: `Band ${n} bump cover`, min: -1, max: 2, step: 0.005, default: zeros(BUMP_MAX) },
    { kind: 'vector', key: key('BumpLight'), label: `Band ${n} bump light`, min: -1, max: 2, step: 0.005, default: zeros(BUMP_MAX) },
    // Pale light added across a light-mode top edge, so two colors far apart meet through a pale bridge (0 none).
    { kind: 'number', key: key('Bridge'), label: `Band ${n} pale bridge at its top edge`, min: 0, max: 2, step: 0.01, default: 0 },
    // How fast each channel deepens as the band's light dims (1, 1, 1: all alike).
    { kind: 'vector', key: key('Drift'), label: `Band ${n} deepening of red, green, blue as its light dims`, min: -2, max: 6, step: 0.01, default: [1, 1, 1] },
    // Extra light at the band's core, near the light's column: amount, the band's height (frame heights), where the
    // core is (0 its top edge, 1 its height below it), and its color: 0 pale light of the band's own hue, 1 more of
    // the band's own light, which the tone curve pales (orange-red through orange and amber to pale yellow).
    { kind: 'vector', key: key('Pale'), label: `Band ${n} pale core amount, height, place, own light`, min: 0, max: 4, step: 0.005, default: [0, 1, 0.5, 0] },
    // Pale light of the band's own hue rising across the band toward its lower edge (the haze near a light below
    // it): amount at the lower edge, the band's height (frame heights).
    { kind: 'vector', key: key('Veil'), label: `Band ${n} pale veil toward its lower edge: amount, height`, min: 0, max: 2, step: 0.005, default: [0, 1] },
    // The band's light falling off away from the light: amount at its far side, and which side is far (1 its
    // bottom, for a band below the light; -1 its top, for a band above it). The height is the veil's.
    { kind: 'vector', key: key('Fall'), label: `Band ${n} light falloff away from the light: amount, side`, min: -1, max: 1, step: 0.005, default: [0, 1] },
  ]
}

function patchSpecs(index: number): ParamSpec[] {
  const n = index + 1
  return [
    // x and radius x in frame widths, y and radius y in frame heights.
    { kind: 'vector', key: patchKey(index, 'Shape'), label: `Patch ${n} x, y, radius x, radius y`, min: -1, max: 2, step: 0.0005, default: [0.5, 0.5, 0.2, 0.1] },
    { kind: 'vector', key: patchKey(index, 'Look'), label: `Patch ${n} opacity, light, mode`, min: 0, max: 4, step: 0.005, default: [0.5, 1, MODE_COVER] },
  ]
}

function lightSpecs(index: number): ParamSpec[] {
  const n = index + 1
  return [
    // x and size across in frame widths, y and size down in frame heights.
    { kind: 'vector', key: lightKey(index, 'Shape'), label: `Light ${n} x, y, size across, size down`, min: -2, max: 3, step: 0.0005, default: [0.5, 0.6, 0.4, 0.05] },
    // A glow peaks at y and falls off over the tail above and the size down below; a dome is a soft bump of light;
    // a shade takes light from one band. Band -1 is the sky behind every band.
    { kind: 'vector', key: lightKey(index, 'Look'), label: `Light ${n} gain, glow dome shade pale, band, tail up`, min: -1, max: 8, step: 0.001, default: [0, LIGHT_GLOW, -1, 0.3] },
  ]
}

export const BANDS_PARAMS: readonly ParamSpec[] = [
  { kind: 'number', key: 'bands', label: 'Bands', min: 0, max: BAND_MAX, step: 1, default: 4 },
  { kind: 'number', key: 'patches', label: 'Patches', min: 0, max: PATCH_MAX, step: 1, default: 0 },
  { kind: 'number', key: 'lights', label: 'Lights', min: 0, max: LIGHT_MAX, step: 1, default: 0 },
  { kind: 'number', key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.005, default: 1 },
  // Radius of the one out-of-focus lens over the whole scene, short-side units.
  { kind: 'number', key: 'lens', label: 'Lens radius', min: 0, max: 0.3, step: 0.0005, default: 0.0825 },
  { kind: 'vector', key: 'sun', label: 'Sun x, width', min: -1, max: 2, step: 0.005, default: [0.7, 0.3] },
  { kind: 'number', key: 'deepen', label: 'Deepen dim light', min: 0, max: 3, step: 0.01, default: 0 },
  { kind: 'vector', key: 'shade', label: 'Light change across, down', min: -1, max: 1, step: 0.0005, default: [0, 0] },
  { kind: 'number', key: 'ink', label: 'Ink mixing', min: 0, max: 5, step: 0.01, default: 0 },
  // Grain that follows ink: 0 is even grain; 1 scales it by how much the layers darken the base, down to the floor on bare base.
  { kind: 'vector', key: 'grainInk', label: 'Grain follows ink, floor', min: 0, max: 1, step: 0.01, default: [0, 0.3] },
  // Slow change of light inside every band with zero mean, so a band keeps its color at its mean. Lattice in short-side units.
  { kind: 'vector', key: 'lightVary', label: 'Light change inside bands: amount, length along, length down', min: 0, max: 2, step: 0.001, default: [0, 0.6, 0.5] },
  // Light bands keep more of their light across the overlap than a plain mix: weight ^ overlap.
  { kind: 'number', key: 'overlap', label: 'Light overlap', min: 0.2, max: 1, step: 0.01, default: 0.65 },
  // Where a glow is strong, the sky's own light (the base and light bands) gives way to it: exp(-extinction * glow).
  { kind: 'number', key: 'extinction', label: 'Sky gives way to glows', min: 0, max: 4, step: 0.01, default: 0 },
  // A lighter band of close hue spills light into its darker neighbour: amount, reach in lens radii.
  { kind: 'vector', key: 'spill', label: 'Spill amount, reach', min: 0, max: 4, step: 0.005, default: [0, 1.2] },
  // Sky light: gain toward the sun, stops less light per frame height above the reference height, the reference height.
  { kind: 'vector', key: 'sky', label: 'Sky light toward the sun, darkening up, nominal height, own light', min: -1, max: 4, step: 0.001, default: [0, 0, 0.5, 1] },
  // Water below a level horizon (frame heights; 2 is off): the sky mirrored, squeezed, smeared by ripples, dimmer with depth.
  { kind: 'vector', key: 'water', label: 'Water horizon, squeeze, smear, reflection at the bottom', min: 0, max: 2, step: 0.0005, default: [2, 1.25, 0.3, 0.4] },
  { kind: 'vector', key: 'waterLook', label: 'Water own light, strip gain, strip width, ripple length', min: 0, max: 2, step: 0.0005, default: [0.5, 0, 0.008, 0.05] },
  // The height the water mirrors about (frame heights); below 0, its own line. Water in front of the frame mirrors
  // about the top of the bank, so just below the shore it shows the light and then the sky.
  { kind: 'number', key: 'waterAxis', label: 'Water mirror height', min: -1, max: 2, step: 0.0005, default: -1 },
  // The sky pales toward the light below it: pale light of the sky's own hue rising from 0 at `from` to `amount` at
  // `to` (frame heights), and the sky's own light rising by `gain` over the same span.
  { kind: 'vector', key: 'skyVeil', label: 'Sky veil amount, from, to, light gain', min: -1, max: 2, step: 0.0005, default: [0, 0, 1, 0] },
  // Above a dark band the veil gives way again, from `from` to `to` (frame heights), so the lens mixes the sky's own
  // color with the dark band's. The default lies below every scene: nowhere.
  { kind: 'vector', key: 'skyVeilEnd', label: 'Sky veil gives way again from, to', min: -1, max: 10, step: 0.0005, default: [9, 10] },
  // The sky's own boundaries (where the veil begins, where the far sky turns dark) wander: how far (frame heights,
  // RMS) and along what lattice (short sides).
  { kind: 'vector', key: 'skyDrift', label: 'Sky boundaries wander, lattice, lean where it pales, lean where its far part turns dark', min: -1, max: 4, step: 0.0005, default: [0, 1, 0, 0] },
  // The light that veil adds, in linear light: a tint of the pack's own colors (Cyan, Lime, Steel).
  { kind: 'vector', key: 'skyTint', label: 'Sky veil light, linear red, green, blue', min: 0, max: 4, step: 0.0005, default: [1, 1, 1] },
  // Under a long line the farthest sky sinks toward a dark pack color: its linear light and how far, full above
  // `full` and gone by `gone` (frame heights).
  { kind: 'vector', key: 'farSky', label: 'Far sky light, linear red, green, blue, amount', min: 0, max: 1, step: 0.0005, default: [0, 0, 0, 0] },
  { kind: 'vector', key: 'farSpan', label: 'Far sky full, gone', min: -1, max: 20, step: 0.0005, default: [0, 0.1] },
  // The stack along the dragged line: a frame point p (short sides from the frame's center, y down) shows the scene
  // at (a b; c d) p + (e, f). The identity without a drag.
  { kind: 'vector', key: 'stack', label: 'Stack along the drag: a, b, c, d, e, f', min: -20, max: 20, step: 0.0001, default: [1, 0, 0, 1, 0, 0] },
  // A drag that draws the stack out k times along the line: k, and the light's scene point (short sides). Each
  // edge's wander and the light change inside bands stay frame-sized.
  { kind: 'vector', key: 'stackFrame', label: 'Drawn-out stack: k, light x, light y', min: -20, max: 20, step: 0.0001, default: [1, 0, 0] },
  ...Array.from({ length: BAND_MAX }, (_, i) => bandSpecs(i)).flat(),
  ...Array.from({ length: PATCH_MAX }, (_, i) => patchSpecs(i)).flat(),
  ...Array.from({ length: LIGHT_MAX }, (_, i) => lightSpecs(i)).flat(),
]

export const BANDS_COLOR_SLOTS: readonly ColorSlot[] = [
  { key: 'base', label: 'Base' },
  ...Array.from({ length: BAND_MAX }, (_, i) => ({ key: `band${i + 1}`, label: `Band ${i + 1}` })),
  ...Array.from({ length: PATCH_MAX }, (_, i) => ({ key: `patch${i + 1}`, label: `Patch ${i + 1}` })),
  ...Array.from({ length: LIGHT_MAX }, (_, i) => ({ key: `light${i + 1}`, label: `Light ${i + 1}` })),
  { key: 'water', label: 'Water' },
]
