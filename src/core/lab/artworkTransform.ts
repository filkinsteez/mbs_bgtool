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

export function constrainArtworkToCanvas<T extends CoverTransform>(
  value: T,
  artboardWidth: number,
  artboardHeight: number,
  inset = 0,
): T {
  const width = Math.max(1, artboardWidth)
  const height = Math.max(1, artboardHeight)
  const safeInset = Math.max(0, inset)
  const rotation = Number.isFinite(value.rotation) ? value.rotation : 0
  const angle = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const scale = Math.max(0.1, Number.isFinite(value.scale) ? value.scale : 1)
  const halfArtworkWidth = scale * (cos * width / 2 + sin * height / 2)
  const halfArtworkHeight = scale * (sin * width / 2 + cos * height / 2)
  const halfCanvasWidth = width / 2
  const halfCanvasHeight = height / 2

  const constrainAxis = (
    desired: number,
    halfArtwork: number,
    halfCanvas: number,
  ) => {
    if (halfArtwork + safeInset <= halfCanvas) {
      return clamp(
        desired,
        -halfCanvas + safeInset + halfArtwork,
        halfCanvas - safeInset - halfArtwork,
      )
    }
    return clamp(
      desired,
      halfCanvas + safeInset - halfArtwork,
      halfArtwork - halfCanvas - safeInset,
    )
  }

  const centerX = constrainAxis(
    (Number.isFinite(value.x) ? value.x : 0) * width / 2,
    halfArtworkWidth,
    halfCanvasWidth,
  )
  const centerY = constrainAxis(
    (Number.isFinite(value.y) ? value.y : 0) * height / 2,
    halfArtworkHeight,
    halfCanvasHeight,
  )

  return {
    ...value,
    x: (centerX * 2) / width,
    y: (centerY * 2) / height,
    scale,
    rotation,
  }
}
