import type { ProjectState, ShapeItem, ShapeLayer, TypeBlockState } from '@/core/state/types'
import { FONT_STACKS, nearestStaticWeight } from '@/core/typography/fonts'
import { INK, PAPER } from '@/core/state/defaults'
import { shapePathD } from './shapeItems'

// A canvas object normalized for stamping by the effector layers. Path
// protos live in a PROTO_SIZE box centered on the origin (largest
// dimension = PROTO_SIZE, aspect preserved); text protos carry their
// type style plus a fontSize normalized so the line's WIDTH fills the
// same box — an engine places either with translate(x,y) rotate(a)
// scale(size / PROTO_SIZE). PROTO_SIZE is 100 rather than 1 because
// shapePathD quantizes coordinates to 0.01 — at unit scale that
// quantization would eat the geometry.
export const PROTO_SIZE = 100

export type ShapeProtoPathBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type ShapeProto =
  | {
      kind: 'path'
      id: string
      d: string
      fill: string
      opacity: number
      pathBounds?: ShapeProtoPathBounds
    }
  | {
      kind: 'text'
      id: string
      text: string
      family: string
      weight: number
      fontSize: number // px in the PROTO box — width-normalized
      fill: string
      opacity: number
    }

// Shapes bound to any effector are CONSUMED: the effector renders them,
// so they stop appearing as standalone canvas objects (live, export,
// and every selection surface). Isolation mode is how they get edited.
// The set holds shape AND text block ids — ids are unique across pools.
export function consumedShapeIds(layers: ShapeLayer[]): Set<string> {
  const out = new Set<string>()
  for (const l of layers) for (const id of l.params.sourceShapeIds) out.add(id)
  return out
}

export function shapeProto(item: ShapeItem): ShapeProto {
  const m = Math.max(item.w, item.h) || 1
  const w = (item.w / m) * PROTO_SIZE
  const h = (item.h / m) * PROTO_SIZE
  const d = shapePathD({ ...item, x: -w / 2, y: -h / 2, w, h })
  return { kind: 'path', id: item.id, d, fill: item.fill, opacity: item.opacity }
}

// Text width measured once per (text, style) — the SAME number feeds
// the SVG def's font-size and the canvas ctx.font, so live and export
// agree by construction. Node (tests/SSR) has no canvas: fall back to a
// rough advance estimate; nothing renders there anyway.
const measureCache = new Map<string, number>()
let measureCtx: CanvasRenderingContext2D | null = null

// FONT_STACKS entries are `var(--font-...)` strings — canvas cannot
// resolve CSS variables, so the concrete family list comes from a
// hidden span's computed style (the round-42 lesson).
const familyCache = new Map<string, string>()

function resolveFamily(stack: string): string {
  const hit = familyCache.get(stack)
  if (hit) return hit
  let resolved = stack
  if (typeof document !== 'undefined' && document.body) {
    const span = document.createElement('span')
    span.style.position = 'absolute'
    span.style.visibility = 'hidden'
    span.style.fontFamily = stack
    document.body.appendChild(span)
    resolved = getComputedStyle(span).fontFamily || stack
    span.remove()
  }
  familyCache.set(stack, resolved)
  return resolved
}

function textWidthAt100(text: string, family: string, weight: number): number {
  const key = `${weight}|${family}|${text}`
  const hit = measureCache.get(key)
  if (hit !== undefined) return hit
  let width = text.length * 55 // ~0.55em average advance
  if (typeof document !== 'undefined') {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
    if (measureCtx) {
      measureCtx.font = `${weight} 100px ${family}`
      width = measureCtx.measureText(text).width || width
    }
  }
  if (measureCache.size > 256) measureCache.clear()
  measureCache.set(key, width)
  return width
}

export function textProto(block: TypeBlockState, fallbackColor: string): ShapeProto {
  const family = resolveFamily(FONT_STACKS[block.fontFamily] ?? 'sans-serif')
  const weight = nearestStaticWeight(block.weight)
  const text = block.text || ' '
  const w100 = Math.max(1, textWidthAt100(text, family, weight))
  return {
    kind: 'text',
    id: block.id,
    text,
    family,
    weight,
    fontSize: (PROTO_SIZE / w100) * 100,
    fill: block.color ?? fallbackColor,
    opacity: 1,
  }
}

// Stamp a text proto at the origin of the PROTO box — the caller has
// already translated/rotated/scaled and set alpha/fill.
export function paintTextProto(ctx: CanvasRenderingContext2D, p: ShapeProto): void {
  if (p.kind !== 'text') return
  ctx.font = `${p.weight} ${p.fontSize}px ${p.family}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(p.text, 0, 0)
}

// Resolve a layer's bound source ids against the live objects. Deleted
// ids drop out silently; an empty result means the layer falls back to
// its built-in glyph vocabulary. `typeBlocks` is optional so engine
// tests and shape-only callers stay unchanged.
export function resolveProtos(
  shapes: ShapeItem[],
  sourceIds: string[] | undefined,
  typeBlocks?: TypeBlockState[],
  textFallbackColor: string = INK,
): ShapeProto[] {
  if (!sourceIds?.length) return []
  const byId = new Map<string, ShapeItem>(shapes.map((s) => [s.id, s]))
  const blockById = new Map<string, TypeBlockState>((typeBlocks ?? []).map((b) => [b.id, b]))
  const out: ShapeProto[] = []
  for (const id of sourceIds) {
    const s = byId.get(id)
    if (s) {
      out.push(shapeProto(s))
      continue
    }
    const b = blockById.get(id)
    if (b) out.push(textProto(b, textFallbackColor))
  }
  return out
}

// The project-level resolver every renderer uses — text fallback color
// follows the same rule the live type layer paints with.
export function resolveProjectProtos(
  project: ProjectState,
  sourceIds: string[] | undefined,
): ShapeProto[] {
  const fallback =
    project.background.mode === 'field' && project.background.ground !== 'neutral' ? PAPER : INK
  return resolveProtos(project.shapes, sourceIds, project.typeBlocks, fallback)
}
