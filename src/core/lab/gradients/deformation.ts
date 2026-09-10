// Backward displacement in normalized artwork coordinates. A small fixed raster
// makes strokes independent of preview size and keeps history and files bounded.
export const DEFORMATION_SIZE = 192
export type Deformation = { version: 1; data: string }
export type BrushMode = 'push' | 'twirl' | 'inflate' | 'restore'
export type Point = { x: number; y: number }
export type BrushDab = {
  from: Point; to: Point; radius: number; strength: number; mode: BrushMode
  aspect: number; reverse?: boolean
}
const LENGTH = DEFORMATION_SIZE * DEFORMATION_SIZE * 2
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function emptyDeformation(): Float32Array { return new Float32Array(LENGTH) }

export function encodeDeformation(field: Float32Array): Deformation {
  const bytes = new Uint8Array(LENGTH * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < LENGTH; i++) view.setUint16(i * 2, Math.round(clamp(field[i] * 16383.75 + 32768, 0, 65535)), false)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { version: 1, data: btoa(binary) }
}

export function normalizeDeformation(value: unknown): Deformation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Partial<Deformation>
  if (v.version !== 1 || typeof v.data !== 'string' || v.data.length !== LENGTH * 2 / 3 * 4) return undefined
  if (!/^[A-Za-z0-9+/]+$/.test(v.data)) return undefined
  return { version: 1, data: v.data }
}

export function decodeDeformation(value?: Deformation): Float32Array {
  const field = emptyDeformation()
  if (!normalizeDeformation(value)) return field
  const binary = atob(value!.data)
  for (let i = 0; i < LENGTH; i++) {
    const n = binary.charCodeAt(i * 2) * 256 + binary.charCodeAt(i * 2 + 1)
    field[i] = (n - 32768) / 16383.75
  }
  return field
}

export function deformationTexture(value?: Deformation): Uint8Array {
  const bytes = new Uint8Array(LENGTH * 2)
  if (value && normalizeDeformation(value)) {
    const binary = atob(value.data)
    for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i)
  } else {
    for (let i = 0; i < bytes.length; i += 2) { bytes[i] = 128; bytes[i + 1] = 0 }
  }
  return bytes
}

function sample(field: Float32Array, x: number, y: number, channel: number): number {
  const n = DEFORMATION_SIZE
  const px = clamp(x * n - 0.5, 0, n - 1), py = clamp(y * n - 0.5, 0, n - 1)
  const ix = Math.floor(px), iy = Math.floor(py), jx = Math.min(n - 1, ix + 1), jy = Math.min(n - 1, iy + 1)
  const fx = px - ix, fy = py - iy
  return (field[(iy * n + ix) * 2 + channel] * (1 - fx) + field[(iy * n + jx) * 2 + channel] * fx) * (1 - fy)
    + (field[(jy * n + ix) * 2 + channel] * (1 - fx) + field[(jy * n + jx) * 2 + channel] * fx) * fy
}

// Pull old coordinates through the brush instead of adding independent vectors.
// Repeated strokes therefore carry existing folds with them, like a liquify tool.
export function applyBrushDab(field: Float32Array, dab: BrushDab): Float32Array {
  const out = field.slice()
  const n = DEFORMATION_SIZE
  const ax = Math.max(1, dab.aspect), ay = Math.max(1, 1 / dab.aspect)
  const radius = clamp(dab.radius, 0.025, 0.9), strength = clamp(dab.strength, 0, 1)
  const dx = dab.to.x - dab.from.x, dy = dab.to.y - dab.from.y
  const minX = Math.max(0, Math.floor((dab.to.x - radius / ax) * n))
  const maxX = Math.min(n - 1, Math.ceil((dab.to.x + radius / ax) * n))
  const minY = Math.max(0, Math.floor((dab.to.y - radius / ay) * n))
  const maxY = Math.min(n - 1, Math.ceil((dab.to.y + radius / ay) * n))
  const travel = Math.hypot(dx * ax, dy * ay)
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n
    const rx = (u - dab.to.x) * ax, ry = (v - dab.to.y) * ay
    const distance = Math.hypot(rx, ry) / radius
    if (distance >= 1) continue
    const falloff = (1 - distance * distance) ** 3
    const w = falloff * strength
    const idx = (y * n + x) * 2
    if (dab.mode === 'restore') {
      const amount = Math.min(1, w * (travel > 1e-6 ? travel / radius * 3 : 0.18))
      out[idx] *= 1 - amount
      out[idx + 1] *= 1 - amount
      continue
    }
    let sx = u, sy = v
    if (dab.mode === 'push') {
      sx -= dx * w * 1.5
      sy -= dy * w * 1.5
    } else if (dab.mode === 'twirl') {
      const angle = (dab.reverse ? -1 : 1) * w * (travel > 1e-6 ? travel / radius * 2.5 : 0.06)
      sx = dab.to.x + (rx * Math.cos(angle) - ry * Math.sin(angle)) / ax
      sy = dab.to.y + (rx * Math.sin(angle) + ry * Math.cos(angle)) / ay
    } else {
      const factor = Math.exp((dab.reverse ? 1 : -1) * w * (travel > 1e-6 ? travel / radius * 1.8 : 0.04))
      sx = dab.to.x + rx * factor / ax
      sy = dab.to.y + ry * factor / ay
    }
    out[idx] = clamp(sample(field, sx, sy, 0) + sx - u, -2, 2)
    out[idx + 1] = clamp(sample(field, sx, sy, 1) + sy - v, -2, 2)
  }
  return out
}

export function applyBrushSegment(field: Float32Array, dab: BrushDab): Float32Array {
  const distance = Math.hypot((dab.to.x - dab.from.x) * Math.max(1, dab.aspect), (dab.to.y - dab.from.y) * Math.max(1, 1 / dab.aspect))
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.006, dab.radius * 0.12)))
  let result = field
  let previous = dab.from
  for (let i = 1; i <= steps; i++) {
    const point = { x: dab.from.x + (dab.to.x - dab.from.x) * i / steps, y: dab.from.y + (dab.to.y - dab.from.y) * i / steps }
    result = applyBrushDab(result, { ...dab, from: previous, to: point })
    previous = point
  }
  return result
}

export function artworkBrushPoint(x: number, y: number, aspect: number, transform: { x: number; y: number; scale: number; rotation: number }): Point {
  const angle = -transform.rotation * Math.PI / 180
  x -= 0.5 + transform.x * 0.5
  y -= 0.5 + transform.y * 0.5
  return {
    x: (x * Math.cos(angle) - y / aspect * Math.sin(angle)) / transform.scale + 0.5,
    y: (x * aspect * Math.sin(angle) + y * Math.cos(angle)) / transform.scale + 0.5,
  }
}
