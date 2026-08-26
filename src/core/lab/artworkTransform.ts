export type CoverTransform = {
  x: number
  y: number
  scale: number
  rotation: number
}

function clamp(value: number, lower: number, upper: number): number {
  if (lower > upper) return (lower + upper) / 2
  return Math.max(lower, Math.min(upper, value))
}

export function constrainArtworkCover<T extends CoverTransform>(
  value: T,
  artboardWidth: number,
  artboardHeight: number,
  bleed = 0,
): T {
  const width = Math.max(1, artboardWidth)
  const height = Math.max(1, artboardHeight)
  const safeBleed = Math.max(0, bleed)
  const rotation = Number.isFinite(value.rotation) ? value.rotation : 0
  const angle = (rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const targetHalfWidth = width / 2 + safeBleed
  const targetHalfHeight = height / 2 + safeBleed
  const rotatedHalfWidth = Math.abs(cos) * targetHalfWidth
    + Math.abs(sin) * targetHalfHeight
  const rotatedHalfHeight = Math.abs(sin) * targetHalfWidth
    + Math.abs(cos) * targetHalfHeight
  const minimumScale = Math.max(
    (rotatedHalfWidth * 2) / width,
    (rotatedHalfHeight * 2) / height,
  )
  const scale = Math.max(
    Number.isFinite(value.scale) ? value.scale : 1,
    minimumScale,
  )
  const desiredCenter = {
    x: (Number.isFinite(value.x) ? value.x : 0) * width / 2,
    y: (Number.isFinite(value.y) ? value.y : 0) * height / 2,
  }
  const desiredRotatedCenter = {
    x: desiredCenter.x * cos + desiredCenter.y * sin,
    y: -desiredCenter.x * sin + desiredCenter.y * cos,
  }
  const halfSourceWidth = width * scale / 2
  const halfSourceHeight = height * scale / 2
  const centerX = clamp(
    desiredRotatedCenter.x,
    rotatedHalfWidth - halfSourceWidth,
    halfSourceWidth - rotatedHalfWidth,
  )
  const centerY = clamp(
    desiredRotatedCenter.y,
    rotatedHalfHeight - halfSourceHeight,
    halfSourceHeight - rotatedHalfHeight,
  )
  const worldCenter = {
    x: centerX * cos - centerY * sin,
    y: centerX * sin + centerY * cos,
  }
  return {
    ...value,
    x: (worldCenter.x * 2) / width,
    y: (worldCenter.y * 2) / height,
    scale,
    rotation,
  }
}
