import type { LookColorPlan } from './colorDirection'
import type { Field } from './field'
import { renderGpuFieldLook } from './gpu/fieldRenderer'

export type BackgroundLookOptions = {
  id: string
  width: number
  height: number
  seed: number
  complexity: number
  palette: readonly string[]
  colorPlan?: LookColorPlan
  influence: Field
  sourceSample?: (x: number, y: number) => readonly [number, number, number] | null
  motionPhase: number
  motionAmount: number
  motionEnergy: number
}

const SUPPORTED_LOOKS = new Set([
  'frame',
  'pixels',
  'scanlines',
  'streams',
  'brushwork',
  'beads',
  'quilt',
  'weave',
  'marks',
  'trails',
])

export function renderBackgroundLook(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
): boolean {
  if (!SUPPORTED_LOOKS.has(options.id)) return false
  const rendered = renderGpuFieldLook(context, {
    ...options,
    id: options.id as
      | 'frame'
      | 'pixels'
      | 'scanlines'
      | 'streams'
      | 'brushwork'
      | 'beads'
      | 'quilt'
      | 'weave'
      | 'marks'
      | 'trails',
  })
  if (rendered) return true

  // Keep V2 output full-frame even if WebGL2 is unavailable.
  const gradient = context.createLinearGradient(0, 0, options.width, options.height)
  gradient.addColorStop(0, options.palette[0] ?? '#1F2A44')
  gradient.addColorStop(1, options.palette.at(-1) ?? '#A2B8D8')
  context.fillStyle = gradient
  context.fillRect(0, 0, options.width, options.height)
  return true
}
