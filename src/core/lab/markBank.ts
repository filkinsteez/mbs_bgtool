import {
  PROTO_SIZE,
  type ShapeProto,
  type ShapeProtoPathBounds,
} from '@/core/canvas/shapeProtos'
import {
  META_SYMBOL_HEIGHT,
  META_SYMBOL_MIN_X,
  META_SYMBOL_MIN_Y,
  META_SYMBOL_PATH,
  META_SYMBOL_WIDTH,
} from '@/core/metaSymbol'
import { metaUnitOutline, unitPolygon } from '@/core/sheet/sheet'
import { INK } from '@/core/state/defaults'
import type { LookVersion, MarkBankId } from './types'

// Mark vocabularies. Everything is a ShapeProto — the same contract the
// effectors stamp — so the user's own drawn shapes and the built-in
// glyphs are interchangeable. Banks are ordered light -> heavy: the
// study picks by index along that ramp, which is the ASCII-density idea
// with geometry instead of characters.

const H = PROTO_SIZE / 2

function polyD(pts: { x: number; y: number }[], scale = H): string {
  let d = ''
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    d += `${i === 0 ? 'M' : 'L'} ${(p.x * scale).toFixed(2)} ${(p.y * scale).toFixed(2)} `
  }
  return d + 'Z'
}

function circleD(r: number): string {
  return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`
}

const proto = (
  id: string,
  d: string,
  pathBounds?: ShapeProtoPathBounds,
): ShapeProto => ({
  kind: 'path',
  id,
  d,
  fill: INK,
  opacity: 1,
  pathBounds,
})

// built-in glyphs, unit geometry shared with the sheet engine
const DOT = proto('lab-dot', circleD(H))
const RING = proto('lab-ring', circleD(H) + ' ' + circleD(H * 0.55))
const LINE = proto(
  'lab-line',
  `M ${-H} ${-H * 0.14} L ${H} ${-H * 0.14} L ${H} ${H * 0.14} L ${-H} ${H * 0.14} Z`,
)
const HALF = proto('lab-half', `M ${-H} ${H} A ${H} ${H} 0 0 1 ${H} ${H} Z`)
const TRIANGLE = proto('lab-triangle', polyD(unitPolygon('triangle')))
const CROSS = proto('lab-cross', polyD(unitPolygon('cross')))
const SQUARE = proto('lab-square', polyD(unitPolygon('square')))
const META = proto('lab-meta', META_SYMBOL_PATH, {
  x: META_SYMBOL_MIN_X,
  y: META_SYMBOL_MIN_Y,
  width: META_SYMBOL_WIDTH,
  height: META_SYMBOL_HEIGHT,
})
const V1_META = proto('lab-meta', polyD(metaUnitOutline()))

export function builtinBank(id: 'dots' | 'geo'): ShapeProto[] {
  // dots: one mark, tone carried purely by scale — the generic-halftone
  // baseline every brand bank gets compared against (hypothesis 1)
  if (id === 'dots') return [DOT]
  return [LINE, RING, HALF, TRIANGLE, CROSS, DOT, SQUARE]
}

const BRAND_BANK = [META, RING, HALF, CROSS, DOT, SQUARE]
const V1_BRAND_BANK = [V1_META, RING, HALF, CROSS, DOT, SQUARE]

export function resolveBank(
  id: MarkBankId,
  version: LookVersion = 'v2',
): ShapeProto[] {
  if (id === 'brand') return version === 'v1' ? V1_BRAND_BANK : BRAND_BANK
  return builtinBank(id)
}
