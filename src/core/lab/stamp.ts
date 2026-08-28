import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { PROTO_SIZE, paintTextProto } from '@/core/canvas/shapeProtos'

// The lab's single proto stamp. The editor inlines this idiom at three
// sites with three private Path2D caches; the lab gets exactly one so
// its painters cannot drift from each other. Fill is always the
// caller's — pass a constant color for alpha-mask renders.

const pathCache = new Map<string, Path2D>()

function protoPath(d: string): Path2D {
  let p = pathCache.get(d)
  if (!p) {
    if (pathCache.size > 256) pathCache.clear()
    p = new Path2D(d)
    pathCache.set(d, p)
  }
  return p
}

export function stampProto(
  ctx: CanvasRenderingContext2D,
  proto: ShapeProto,
  x: number,
  y: number,
  rot: number,
  size: number, // target diameter in the ctx's units
  fill: string,
  alpha: number,
): void {
  ctx.save()
  ctx.translate(x, y)
  if (rot) ctx.rotate(rot)
  const k = size / PROTO_SIZE
  ctx.scale(k, k)
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha * proto.opacity))
  ctx.fillStyle = fill
  if (proto.kind === 'path') {
    if (proto.pathBounds) {
      const { x: left, y: top, width, height } = proto.pathBounds
      const normalize = PROTO_SIZE / Math.max(width, height, 0.001)
      ctx.scale(normalize, normalize)
      ctx.translate(-(left + width / 2), -(top + height / 2))
    }
    ctx.fill(protoPath(proto.d), 'evenodd')
  } else {
    paintTextProto(ctx, proto)
  }
  ctx.restore()
}
