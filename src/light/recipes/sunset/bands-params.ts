import type { ColorSlot, ParamSpec } from '../../scene'

export const BAND_MAX = 6
export const BUMP_MAX = 4
export const PATCH_MAX = 4

/** Param key for band `index` (0-based), e.g. bandKey(0, 'Edges') = 'band1Edges'. */
export function bandKey(index: number, name: BandParamName): string {
  return `band${index + 1}${name}`
}

/** Param key for patch `index` (0-based), e.g. patchKey(0, 'Shape') = 'patch1Shape'. */
export function patchKey(index: number, name: PatchParamName): string {
  return `patch${index + 1}${name}`
}

export type BandParamName =
  | 'Edges'
  | 'Soft'
  | 'Opacity'
  | 'Light'
  | 'Mode'
  | 'Line'
  | 'Warp'
  | 'Waves'
  | 'Vary'
  | 'Tilt'
  | 'Sun'
  | 'Haze'
  | 'Pale'
  | 'Noise'
  | 'BumpAt'
  | 'BumpWidth'
  | 'BumpTop'
  | 'BumpBottom'
  | 'BumpCover'
  | 'BumpLight'

export type PatchParamName = 'Shape' | 'Look'

/** How a layer combines with what is under it. */
export const MODE_OVER = 0
export const MODE_MULTIPLY = 1
export const MODE_ADD = 2

const zeros = (n: number) => Array.from({ length: n }, () => 0)

function bandSpecs(index: number): ParamSpec[] {
  const n = index + 1
  const key = (name: BandParamName) => bandKey(index, name)
  return [
    // Positions and softness are in frame heights (0 top, 1 bottom); along-x values in frame widths.
    { kind: 'vector', key: key('Edges'), label: `Band ${n} top, bottom`, min: -1, max: 2, step: 0.0005, default: [0.4 + 0.1 * index, 2] },
    { kind: 'vector', key: key('Soft'), label: `Band ${n} softness above, below`, min: 0, max: 0.6, step: 0.0005, default: [0.08, 0.08] },
    { kind: 'number', key: key('Opacity'), label: `Band ${n} opacity`, min: 0, max: 1, step: 0.005, default: 1 },
    { kind: 'number', key: key('Light'), label: `Band ${n} light`, min: 0, max: 4, step: 0.005, default: 1 },
    { kind: 'number', key: key('Mode'), label: `Band ${n} over, multiply, add`, min: 0, max: 2, step: 1, default: MODE_OVER },
    { kind: 'boolean', key: key('Line'), label: `Band ${n} thin line`, default: false },
    { kind: 'vector', key: key('Warp'), label: `Band ${n} warp top, bottom`, min: 0, max: 0.3, step: 0.0005, default: [0.02, 0] },
    { kind: 'number', key: key('Waves'), label: `Band ${n} waves across`, min: 0.1, max: 8, step: 0.01, default: 1.5 },
    { kind: 'vector', key: key('Vary'), label: `Band ${n} softness, cover variation`, min: 0, max: 1.5, step: 0.005, default: [0.3, 0] },
    { kind: 'vector', key: key('Tilt'), label: `Band ${n} tilt top, bottom, cover`, min: -1, max: 1, step: 0.0005, default: [0, 0, 0] },
    { kind: 'vector', key: key('Sun'), label: `Band ${n} sun light, sun cover`, min: 0, max: 1, step: 0.005, default: [0, 0] },
    { kind: 'number', key: key('Haze'), label: `Band ${n} haze`, min: 0, max: 0.8, step: 0.005, default: 0 },
    // 1: where the band thins out at its edges its light is the pale member of its color family.
    { kind: 'number', key: key('Pale'), label: `Band ${n} pale edges`, min: 0, max: 1, step: 0.005, default: 0 },
    // Bands with the same noise number and waves get the same warp.
    { kind: 'number', key: key('Noise'), label: `Band ${n} noise number`, min: 0, max: 63, step: 1, default: index },
    { kind: 'vector', key: key('BumpAt'), label: `Band ${n} bump at`, min: -0.5, max: 1.5, step: 0.001, default: [0.2, 0.4, 0.6, 0.8] },
    { kind: 'vector', key: key('BumpWidth'), label: `Band ${n} bump width`, min: 0, max: 1, step: 0.001, default: zeros(BUMP_MAX) },
    { kind: 'vector', key: key('BumpTop'), label: `Band ${n} bump top shift`, min: -0.3, max: 0.3, step: 0.0005, default: zeros(BUMP_MAX) },
    { kind: 'vector', key: key('BumpBottom'), label: `Band ${n} bump bottom shift`, min: -0.3, max: 0.3, step: 0.0005, default: zeros(BUMP_MAX) },
    { kind: 'vector', key: key('BumpCover'), label: `Band ${n} bump cover`, min: -1, max: 2, step: 0.005, default: zeros(BUMP_MAX) },
    { kind: 'vector', key: key('BumpLight'), label: `Band ${n} bump light`, min: -1, max: 2, step: 0.005, default: zeros(BUMP_MAX) },
  ]
}

function patchSpecs(index: number): ParamSpec[] {
  const n = index + 1
  return [
    // x and radius x in frame widths, y and radius y in frame heights.
    { kind: 'vector', key: patchKey(index, 'Shape'), label: `Patch ${n} x, y, radius x, radius y`, min: -1, max: 2, step: 0.0005, default: [0.5, 0.5, 0.2, 0.1] },
    { kind: 'vector', key: patchKey(index, 'Look'), label: `Patch ${n} opacity, light, mode`, min: 0, max: 4, step: 0.005, default: [0.5, 1, MODE_OVER] },
  ]
}

export const BANDS_PARAMS: readonly ParamSpec[] = [
  { kind: 'number', key: 'bands', label: 'Bands', min: 0, max: BAND_MAX, step: 1, default: 4 },
  { kind: 'number', key: 'patches', label: 'Patches', min: 0, max: PATCH_MAX, step: 1, default: 0 },
  { kind: 'number', key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.005, default: 1 },
  { kind: 'vector', key: 'sun', label: 'Sun x, width', min: -1, max: 2, step: 0.005, default: [0.7, 0.3] },
  { kind: 'number', key: 'bridge', label: 'Bridge light', min: 0, max: 3, step: 0.01, default: 0 },
  { kind: 'number', key: 'deepen', label: 'Deepen dim light', min: 0, max: 3, step: 0.01, default: 0 },
  { kind: 'number', key: 'rounding', label: 'Edge rounding', min: 0, max: 0.5, step: 0.005, default: 0 },
  { kind: 'vector', key: 'shade', label: 'Light change across, down', min: -1, max: 1, step: 0.0005, default: [0, 0] },
  { kind: 'number', key: 'ink', label: 'Ink mixing', min: 0, max: 5, step: 0.01, default: 0 },
  // Grain that follows ink: 0 is even grain; 1 scales it by how much the layers darken the base, down to the floor on bare base.
  { kind: 'vector', key: 'grainInk', label: 'Grain follows ink, floor', min: 0, max: 1, step: 0.01, default: [0, 0.3] },
  ...Array.from({ length: BAND_MAX }, (_, i) => bandSpecs(i)).flat(),
  ...Array.from({ length: PATCH_MAX }, (_, i) => patchSpecs(i)).flat(),
]

export const BANDS_COLOR_SLOTS: readonly ColorSlot[] = [
  { key: 'base', label: 'Base' },
  ...Array.from({ length: BAND_MAX }, (_, i) => ({ key: `band${i + 1}`, label: `Band ${i + 1}` })),
  ...Array.from({ length: PATCH_MAX }, (_, i) => ({ key: `patch${i + 1}`, label: `Patch ${i + 1}` })),
]
