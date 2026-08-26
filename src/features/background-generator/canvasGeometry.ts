import {
  constrainBackgroundTransform,
  normalizeSubjectTransform,
  type SubjectTransform,
} from './recipe'

export type SubjectBox = {
  centerX: number
  centerY: number
  width: number
  height: number
  rotation: number
}

export type SubjectVisualBounds = {
  left: number
  right: number
  top: number
  bottom: number
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

export type SnapResult = {
  transform: SubjectTransform
  guideX?: number
  guideY?: number
}

export function subjectBox(
  transform: SubjectTransform,
  artboardWidth: number,
  artboardHeight: number,
): SubjectBox {
  return {
    centerX: artboardWidth * (0.5 + transform.x * 0.5),
    centerY: artboardHeight * (0.5 + transform.y * 0.5),
    width: artboardWidth * transform.scale,
    height: artboardHeight * transform.scale,
    rotation: transform.rotation,
  }
}

export function artworkContainsPoint(
  transform: SubjectTransform,
  artboardWidth: number,
  artboardHeight: number,
  pointX: number,
  pointY: number,
): boolean {
  const box = subjectBox(transform, artboardWidth, artboardHeight)
  const local = unrotate(
    pointX - box.centerX,
    pointY - box.centerY,
    (box.rotation * Math.PI) / 180,
  )
  return (
    Math.abs(local.x) <= box.width / 2
    && Math.abs(local.y) <= box.height / 2
  )
}

export function subjectVisualBounds(
  transform: SubjectTransform,
  artboardWidth: number,
  artboardHeight: number,
): SubjectVisualBounds {
  const box = subjectBox(transform, artboardWidth, artboardHeight)
  const angle = (box.rotation * Math.PI) / 180
  const halfWidth =
    Math.abs(Math.cos(angle)) * box.width / 2
    + Math.abs(Math.sin(angle)) * box.height / 2
  const halfHeight =
    Math.abs(Math.sin(angle)) * box.width / 2
    + Math.abs(Math.cos(angle)) * box.height / 2
  return {
    left: box.centerX - halfWidth,
    right: box.centerX + halfWidth,
    top: box.centerY - halfHeight,
    bottom: box.centerY + halfHeight,
  }
}

export function moveSubject(
  start: SubjectTransform,
  deltaX: number,
  deltaY: number,
  artboardWidth: number,
  artboardHeight: number,
  constrainAxis: boolean,
  snap = true,
  thresholdPx = 8,
): SnapResult {
  let dx = deltaX
  let dy = deltaY
  if (constrainAxis) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0
    else dx = 0
  }

  const moved = constrainBackgroundTransform({
    ...start,
    preset: 'free',
    x: start.x + (dx * 2) / Math.max(1, artboardWidth),
    y: start.y + (dy * 2) / Math.max(1, artboardHeight),
  }, artboardWidth, artboardHeight)
  if (
    (dx !== 0 || dy !== 0)
    &&
    moved.x === start.x
    && moved.y === start.y
    && moved.scale === start.scale
  ) return { transform: start }
  if (!snap) return { transform: moved }

  const bounds = subjectVisualBounds(moved, artboardWidth, artboardHeight)
  const box = subjectBox(moved, artboardWidth, artboardHeight)
  const xSnap = snapTranslationAxis(
    bounds.left,
    box.centerX,
    bounds.right,
    artboardWidth,
    thresholdPx,
  )
  const ySnap = snapTranslationAxis(
    bounds.top,
    box.centerY,
    bounds.bottom,
    artboardHeight,
    thresholdPx,
  )

  return {
    transform: constrainBackgroundTransform({
      ...moved,
      x: moved.x + ((xSnap?.delta ?? 0) * 2) / Math.max(1, artboardWidth),
      y: moved.y + ((ySnap?.delta ?? 0) * 2) / Math.max(1, artboardHeight),
    }, artboardWidth, artboardHeight),
    guideX: xSnap?.target,
    guideY: ySnap?.target,
  }
}

export function scaleSubjectFromCorner(
  start: SubjectTransform,
  corner: Corner,
  artboardWidth: number,
  artboardHeight: number,
  pointerX: number,
  pointerY: number,
  fromCenter: boolean,
  snap = true,
  thresholdPx = 8,
): SnapResult {
  const box = subjectBox(start, artboardWidth, artboardHeight)
  const signX = corner.includes('w') ? -1 : 1
  const signY = corner.includes('n') ? -1 : 1
  const rotation = (start.rotation * Math.PI) / 180

  let ratio: number
  let transformAtRatio: (nextRatio: number, normalize?: boolean) => SubjectTransform
  if (fromCenter) {
    const current = unrotate(pointerX - box.centerX, pointerY - box.centerY, rotation)
    const initial = {
      x: signX * box.width * 0.5,
      y: signY * box.height * 0.5,
    }
    ratio = projectedRatio(current, initial)
    transformAtRatio = (nextRatio, normalize = true) => {
      const next = {
        ...start,
        preset: 'free' as const,
        scale: start.scale * nextRatio,
      }
      return normalize
        ? constrainBackgroundTransform(next, artboardWidth, artboardHeight)
        : next
    }
  } else {
    const oppositeOffset = rotate(
      -signX * box.width * 0.5,
      -signY * box.height * 0.5,
      rotation,
    )
    const opposite = {
      x: box.centerX + oppositeOffset.x,
      y: box.centerY + oppositeOffset.y,
    }
    const current = unrotate(pointerX - opposite.x, pointerY - opposite.y, rotation)
    const initial = {
      x: signX * box.width,
      y: signY * box.height,
    }
    ratio = projectedRatio(current, initial)
    transformAtRatio = (nextRatio, normalize = true) => {
      const centerOffset = rotate(
        initial.x * nextRatio * 0.5,
        initial.y * nextRatio * 0.5,
        rotation,
      )
      const centerX = opposite.x + centerOffset.x
      const centerY = opposite.y + centerOffset.y
      const next = {
        ...start,
        preset: 'free' as const,
        x: ((centerX / Math.max(1, artboardWidth)) - 0.5) * 2,
        y: ((centerY / Math.max(1, artboardHeight)) - 0.5) * 2,
        scale: start.scale * nextRatio,
      }
      return normalize
        ? constrainBackgroundTransform(next, artboardWidth, artboardHeight)
        : next
    }
  }

  ratio = Math.max(0.01, ratio)
  const raw = transformAtRatio(ratio)
  if (
    Math.abs(ratio - 1) > 0.000001
    &&
    raw.x === start.x
    && raw.y === start.y
    && raw.scale === start.scale
  ) return { transform: start }
  if (!snap) return { transform: raw }

  const rawBounds = subjectVisualBounds(raw, artboardWidth, artboardHeight)
  const xEdge = signX < 0 ? 'left' : 'right'
  const yEdge = signY < 0 ? 'top' : 'bottom'
  const xTarget = signX < 0 ? 0 : artboardWidth
  const yTarget = signY < 0 ? 0 : artboardHeight
  const candidates: {
    axis: 'x' | 'y'
    ratio: number
    distance: number
    target: number
  }[] = []

  const xDistance = Math.abs(rawBounds[xEdge] - xTarget)
  if (xDistance <= thresholdPx) {
    const snappedRatio = ratioForEdge(
      transformAtRatio,
      xEdge,
      xTarget,
      artboardWidth,
      artboardHeight,
    )
    if (snappedRatio !== null) {
      candidates.push({ axis: 'x', ratio: snappedRatio, distance: xDistance, target: xTarget })
    }
  }
  const yDistance = Math.abs(rawBounds[yEdge] - yTarget)
  if (yDistance <= thresholdPx) {
    const snappedRatio = ratioForEdge(
      transformAtRatio,
      yEdge,
      yTarget,
      artboardWidth,
      artboardHeight,
    )
    if (snappedRatio !== null) {
      candidates.push({ axis: 'y', ratio: snappedRatio, distance: yDistance, target: yTarget })
    }
  }
  if (!candidates.length) return { transform: raw }

  candidates.sort((a, b) => a.distance - b.distance)
  const snapped = transformAtRatio(Math.max(0.01, candidates[0].ratio))
  const snappedBounds = subjectVisualBounds(snapped, artboardWidth, artboardHeight)
  return {
    transform: snapped,
    guideX: Math.abs(snappedBounds[xEdge] - xTarget) < 0.5 ? xTarget : undefined,
    guideY: Math.abs(snappedBounds[yEdge] - yTarget) < 0.5 ? yTarget : undefined,
  }
}

export function rotateSubject(
  start: SubjectTransform,
  centerX: number,
  centerY: number,
  startPointerX: number,
  startPointerY: number,
  pointerX: number,
  pointerY: number,
  snapTo15: boolean,
): SubjectTransform {
  const startAngle = Math.atan2(startPointerY - centerY, startPointerX - centerX)
  const currentAngle = Math.atan2(pointerY - centerY, pointerX - centerX)
  let rotation = start.rotation + ((currentAngle - startAngle) * 180) / Math.PI
  if (snapTo15) rotation = Math.round(rotation / 15) * 15
  return normalizeSubjectTransform({ ...start, preset: 'free', rotation })
}

function snapTranslationAxis(
  start: number,
  center: number,
  end: number,
  extent: number,
  threshold: number,
): { delta: number; target: number } | null {
  const candidates = [
    { value: start, target: 0 },
    { value: center, target: extent / 2 },
    { value: end, target: extent },
  ]
  let best: { delta: number; target: number } | null = null
  let distance = threshold
  for (const { value, target } of candidates) {
    const next = Math.abs(target - value)
    if (next <= distance) {
      distance = next
      best = { delta: target - value, target }
    }
  }
  return best
}

function ratioForEdge(
  transformAtRatio: (ratio: number, normalize?: boolean) => SubjectTransform,
  edge: keyof SubjectVisualBounds,
  target: number,
  artboardWidth: number,
  artboardHeight: number,
): number | null {
  const atZero = subjectVisualBounds(
    transformAtRatio(0, false),
    artboardWidth,
    artboardHeight,
  )[edge]
  const atOne = subjectVisualBounds(
    transformAtRatio(1, false),
    artboardWidth,
    artboardHeight,
  )[edge]
  const slope = atOne - atZero
  if (Math.abs(slope) < 0.0001) return null
  const ratio = (target - atZero) / slope
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

function projectedRatio(
  current: { x: number; y: number },
  initial: { x: number; y: number },
): number {
  const denominator = initial.x * initial.x + initial.y * initial.y
  return denominator > 0
    ? (current.x * initial.x + current.y * initial.y) / denominator
    : 1
}

function rotate(x: number, y: number, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

function unrotate(x: number, y: number, angle: number): { x: number; y: number } {
  return rotate(x, y, -angle)
}
