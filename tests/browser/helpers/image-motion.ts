import type { Locator, Page } from '@playwright/test'

export const NINE_FRAME_PHASES = [
  0,
  1 / 8,
  1 / 4,
  3 / 8,
  1 / 2,
  5 / 8,
  3 / 4,
  7 / 8,
  1,
] as const

type MotionGrid = {
  columns: number
  rows: number
  values: number[]
}

export type ImageMotionFrame = {
  phase: number
  width: number
  height: number
  dataUrl: string
  coarse: MotionGrid
  fine: MotionGrid
}

export type BlockFlow = {
  x: number
  y: number
  dx: number
  dy: number
  confidence: number
}

export type ImageMotionPair = {
  fromPhase: number
  toPhase: number
  coarseEnergy: number
  fineEnergy: number
  changedCoverage: number
  shimmerRatio: number
  displacedBlockCoverage: number
  meanBlockDisplacement: number
  topologyRetention: number
  structureEnergy: number
  flows: BlockFlow[]
}

export type ImageMotionReport = {
  seamExact: boolean
  pairCount: number
  meanCoarseEnergy: number
  minimumCoarseEnergy: number
  meanChangedCoverage: number
  minimumChangedCoverage: number
  meanDisplacedBlockCoverage: number
  meanBlockDisplacement: number
  maximumShimmerRatio: number
  minimumTopologyRetention: number
  topologyEnergyDrift: number
  pairs: ImageMotionPair[]
}

export async function captureImageMotionFrame(
  canvas: Locator,
  phase: number,
): Promise<ImageMotionFrame> {
  return canvas.evaluate((element: HTMLCanvasElement, requestedPhase) => {
    const context = element.getContext('2d')
    if (!context) throw new Error('Motion analysis requires a 2D canvas')
    const { width, height } = element
    const pixels = context.getImageData(0, 0, width, height).data
    const sample = (columns: number, rows: number): MotionGrid => {
      const values: number[] = []
      for (let row = 0; row < rows; row += 1) {
        const top = Math.floor(row * height / rows)
        const bottom = Math.max(top + 1, Math.floor((row + 1) * height / rows))
        for (let column = 0; column < columns; column += 1) {
          const left = Math.floor(column * width / columns)
          const right = Math.max(left + 1, Math.floor((column + 1) * width / columns))
          const stepX = Math.max(1, Math.floor((right - left) / 6))
          const stepY = Math.max(1, Math.floor((bottom - top) / 6))
          let luma = 0
          let count = 0
          for (let y = top; y < bottom; y += stepY) {
            for (let x = left; x < right; x += stepX) {
              const offset = (y * width + x) * 4
              luma += (
                pixels[offset] * 0.2126
                + pixels[offset + 1] * 0.7152
                + pixels[offset + 2] * 0.0722
              ) / 255
              count += 1
            }
          }
          values.push(luma / Math.max(1, count))
        }
      }
      return { columns, rows, values }
    }
    return {
      phase: requestedPhase,
      width,
      height,
      dataUrl: element.toDataURL('image/png'),
      coarse: sample(32, 18),
      fine: sample(96, 54),
    }
  }, phase)
}

function meanAbsoluteDifference(left: MotionGrid, right: MotionGrid): number {
  if (
    left.columns !== right.columns
    || left.rows !== right.rows
    || left.values.length !== right.values.length
  ) {
    throw new Error('Motion grids must have matching dimensions')
  }
  let total = 0
  for (let index = 0; index < left.values.length; index += 1) {
    total += Math.abs(left.values[index] - right.values[index])
  }
  return total / Math.max(1, left.values.length)
}

function gradientValues(grid: MotionGrid): number[] {
  const gradients = new Array<number>(grid.values.length).fill(0)
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const index = row * grid.columns + column
      const right = row * grid.columns + Math.min(grid.columns - 1, column + 1)
      const down = Math.min(grid.rows - 1, row + 1) * grid.columns + column
      gradients[index] = Math.hypot(
        grid.values[right] - grid.values[index],
        grid.values[down] - grid.values[index],
      )
    }
  }
  return gradients
}

function topologyMask(grid: MotionGrid): boolean[] {
  const gradients = gradientValues(grid)
  const sorted = [...gradients].sort((left, right) => left - right)
  const threshold = sorted[Math.floor(sorted.length * 0.62)] ?? 0
  return gradients.map((value) => value >= Math.max(0.012, threshold))
}

function topologyRetention(left: MotionGrid, right: MotionGrid): number {
  const leftMask = topologyMask(left)
  const rightMask = topologyMask(right)
  const matches = (source: boolean[], target: boolean[]) => {
    let active = 0
    let matched = 0
    source.forEach((value, index) => {
      if (!value) return
      active += 1
      const column = index % left.columns
      const row = Math.floor(index / left.columns)
      let found = false
      for (let dy = -1; dy <= 1 && !found; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = column + dx
          const y = row + dy
          if (
            x >= 0
            && x < left.columns
            && y >= 0
            && y < left.rows
            && target[y * left.columns + x]
          ) {
            found = true
            break
          }
        }
      }
      if (found) matched += 1
    })
    return matched / Math.max(1, active)
  }
  return Math.min(matches(leftMask, rightMask), matches(rightMask, leftMask))
}

function estimateBlockFlow(left: MotionGrid, right: MotionGrid): BlockFlow[] {
  const blockColumns = 8
  const blockRows = 6
  const cellWidth = left.columns / blockColumns
  const cellHeight = left.rows / blockRows
  const flows: BlockFlow[] = []
  for (let blockY = 0; blockY < blockRows; blockY += 1) {
    for (let blockX = 0; blockX < blockColumns; blockX += 1) {
      const centerX = Math.round((blockX + 0.5) * cellWidth)
      const centerY = Math.round((blockY + 0.5) * cellHeight)
      let baseline = 0
      let best = Number.POSITIVE_INFINITY
      let bestX = 0
      let bestY = 0
      for (let shiftY = -2; shiftY <= 2; shiftY += 1) {
        for (let shiftX = -2; shiftX <= 2; shiftX += 1) {
          let difference = 0
          let count = 0
          for (let localY = -2; localY <= 2; localY += 1) {
            for (let localX = -2; localX <= 2; localX += 1) {
              const leftX = centerX + localX
              const leftY = centerY + localY
              const rightX = leftX + shiftX
              const rightY = leftY + shiftY
              if (
                leftX < 0
                || leftX >= left.columns
                || leftY < 0
                || leftY >= left.rows
                || rightX < 0
                || rightX >= right.columns
                || rightY < 0
                || rightY >= right.rows
              ) continue
              difference += Math.abs(
                left.values[leftY * left.columns + leftX]
                - right.values[rightY * right.columns + rightX],
              )
              count += 1
            }
          }
          const score = difference / Math.max(1, count)
          if (shiftX === 0 && shiftY === 0) baseline = score
          if (score < best) {
            best = score
            bestX = shiftX
            bestY = shiftY
          }
        }
      }
      flows.push({
        x: centerX / left.columns,
        y: centerY / left.rows,
        dx: bestX,
        dy: bestY,
        confidence: Math.max(0, baseline - best),
      })
    }
  }
  return flows
}

function analyzePair(left: ImageMotionFrame, right: ImageMotionFrame): ImageMotionPair {
  const coarseEnergy = meanAbsoluteDifference(left.coarse, right.coarse)
  const fineEnergy = meanAbsoluteDifference(left.fine, right.fine)
  let changed = 0
  for (let index = 0; index < left.coarse.values.length; index += 1) {
    if (Math.abs(left.coarse.values[index] - right.coarse.values[index]) > 0.006) {
      changed += 1
    }
  }
  const flows = estimateBlockFlow(left.coarse, right.coarse)
  const confident = flows.filter((flow) => flow.confidence > 0.0008)
  const displaced = confident.filter((flow) => Math.hypot(flow.dx, flow.dy) >= 1)
  const gradients = gradientValues(left.coarse)
  const structureEnergy = gradients.reduce((sum, value) => sum + value, 0)
    / Math.max(1, gradients.length)
  return {
    fromPhase: left.phase,
    toPhase: right.phase,
    coarseEnergy,
    fineEnergy,
    changedCoverage: changed / Math.max(1, left.coarse.values.length),
    shimmerRatio: fineEnergy > 1e-6
      ? Math.max(0, Math.min(1, (fineEnergy - coarseEnergy) / fineEnergy))
      : 0,
    displacedBlockCoverage: displaced.length / Math.max(1, confident.length),
    meanBlockDisplacement: displaced.reduce(
      (sum, flow) => sum + Math.hypot(flow.dx, flow.dy),
      0,
    ) / Math.max(1, displaced.length),
    topologyRetention: topologyRetention(left.coarse, right.coarse),
    structureEnergy,
    flows,
  }
}

export function analyzeImageMotionSequence(
  frames: readonly ImageMotionFrame[],
): ImageMotionReport {
  if (frames.length < 2) throw new Error('Motion analysis needs at least two frames')
  const pairs = frames.slice(0, -1).map((frame, index) =>
    analyzePair(frame, frames[index + 1]))
  const coarse = pairs.map((pair) => pair.coarseEnergy)
  const coverage = pairs.map((pair) => pair.changedCoverage)
  const structure = pairs.map((pair) => pair.structureEnergy)
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  return {
    seamExact: frames[0].dataUrl === frames.at(-1)?.dataUrl,
    pairCount: pairs.length,
    meanCoarseEnergy: mean(coarse),
    minimumCoarseEnergy: Math.min(...coarse),
    meanChangedCoverage: mean(coverage),
    minimumChangedCoverage: Math.min(...coverage),
    meanDisplacedBlockCoverage: mean(pairs.map((pair) => pair.displacedBlockCoverage)),
    meanBlockDisplacement: mean(pairs.map((pair) => pair.meanBlockDisplacement)),
    maximumShimmerRatio: Math.max(...pairs.map((pair) => pair.shimmerRatio)),
    minimumTopologyRetention: Math.min(...pairs.map((pair) => pair.topologyRetention)),
    topologyEnergyDrift: (
      Math.max(...structure) - Math.min(...structure)
    ) / Math.max(1e-6, mean(structure)),
    pairs,
  }
}

export async function renderBlurredMotionDifference(
  page: Page,
  firstSource: string,
  secondSource: string,
  flows: readonly BlockFlow[],
): Promise<string> {
  return page.evaluate(async ({ first, second, vectors }) => {
    const load = async (source: string) => {
      const image = new Image()
      image.src = source
      await image.decode()
      return image
    }
    const [left, right] = await Promise.all([load(first), load(second)])
    const analysisWidth = 80
    const analysisHeight = 45
    const pixels = (image: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = analysisWidth
      canvas.height = analysisHeight
      const context = canvas.getContext('2d')!
      context.imageSmoothingEnabled = true
      context.drawImage(image, 0, 0, analysisWidth, analysisHeight)
      return context.getImageData(0, 0, analysisWidth, analysisHeight).data
    }
    const leftPixels = pixels(left)
    const rightPixels = pixels(right)
    const heat = document.createElement('canvas')
    heat.width = analysisWidth
    heat.height = analysisHeight
    const heatContext = heat.getContext('2d')!
    const image = heatContext.createImageData(analysisWidth, analysisHeight)
    for (let index = 0; index < analysisWidth * analysisHeight; index += 1) {
      const offset = index * 4
      const delta = (
        Math.abs(leftPixels[offset] - rightPixels[offset])
        + Math.abs(leftPixels[offset + 1] - rightPixels[offset + 1])
        + Math.abs(leftPixels[offset + 2] - rightPixels[offset + 2])
      ) / 3
      const intensity = Math.min(255, delta * 5.5)
      image.data[offset] = intensity
      image.data[offset + 1] = Math.min(255, intensity * 0.62)
      image.data[offset + 2] = Math.min(255, 36 + intensity * 1.25)
      image.data[offset + 3] = 255
    }
    heatContext.putImageData(image, 0, 0)

    const output = document.createElement('canvas')
    output.width = 320
    output.height = 180
    const context = output.getContext('2d')!
    context.imageSmoothingEnabled = true
    context.drawImage(heat, 0, 0, output.width, output.height)
    context.strokeStyle = 'rgb(110 255 224 / 0.9)'
    context.fillStyle = 'rgb(110 255 224 / 0.9)'
    context.lineWidth = 1.25
    vectors
      .filter((flow) => flow.confidence > 0.0008 && Math.hypot(flow.dx, flow.dy) >= 1)
      .forEach((flow) => {
        const startX = flow.x * output.width
        const startY = flow.y * output.height
        const endX = startX + flow.dx * 7
        const endY = startY + flow.dy * 7
        const angle = Math.atan2(endY - startY, endX - startX)
        context.beginPath()
        context.moveTo(startX, startY)
        context.lineTo(endX, endY)
        context.stroke()
        context.beginPath()
        context.moveTo(endX, endY)
        context.lineTo(endX - Math.cos(angle - 0.55) * 4, endY - Math.sin(angle - 0.55) * 4)
        context.lineTo(endX - Math.cos(angle + 0.55) * 4, endY - Math.sin(angle + 0.55) * 4)
        context.closePath()
        context.fill()
      })
    return output.toDataURL('image/png')
  }, {
    first: firstSource,
    second: secondSource,
    vectors: flows,
  })
}
