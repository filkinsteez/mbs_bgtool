import { exportPreset, getRecipe, type ControlValues, type ExportAspect, type MoodId, type PackId, type Scene } from '@/light'
import { clampDrag, MOOD_CONTROL } from './controls'

export interface ExportOutcome {
  fileName: string
  width: number
  height: number
  supersample: 1 | 2
  ms: number
  /** Why the 2x render failed, when it fell back to 1x. */
  retryReason?: string
}

/** The control values an export's file name carries. */
export type NamedControls = Pick<ControlValues, 'intensity' | 'softness' | 'mood' | 'drag'>

const percent = (value: number) => String(Math.round(value * 100))
/** Line ends are kept to 0.001 of the frame, so tenths of a percent tell any two lines apart. */
const framePercent = (value: number) => String(Math.round(value * 1000) / 10)

/**
 * File name parts for the controls, at the precision the URL keeps them: `i50-s50-h28` (Intensity, Softness and
 * the mood control in percent; `h` for Horizon, `l` for Light position) and, when the user dragged a line,
 * `from20,80-to75,30` (its ends in percent of the frame's width and height).
 */
export function controlNameParts(mood: MoodId, controls: NamedControls): string[] {
  const parts = [`i${percent(controls.intensity)}`, `s${percent(controls.softness)}`, `${MOOD_CONTROL[mood][0]}${percent(controls.mood)}`]
  const line = controls.drag ? clampDrag(controls.drag) : undefined
  if (line) parts.push(`from${line.from.map(framePercent).join(',')}`, `to${line.to.map(framePercent).join(',')}`)
  return parts
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/**
 * Renders the scene at the format's 4K preset size at 2x and downloads it; retries at 1x if 2x fails. Given the
 * controls, the file name carries their values.
 */
export async function exportImage(scene: Scene, pack: PackId, aspect: ExportAspect, controls?: NamedControls): Promise<ExportOutcome> {
  const preset = { id: 'tool', pack, scene }
  const nameParts = controls ? controlNameParts(getRecipe(scene.recipe).mood, controls) : []
  const start = performance.now()
  let supersample: 1 | 2 = 2
  let retryReason: string | undefined
  let result
  try {
    result = await exportPreset(preset, { aspect, supersample: 2, nameParts })
  } catch (error) {
    retryReason = error instanceof Error ? error.message : String(error)
    supersample = 1
    result = await exportPreset(preset, { aspect, supersample: 1, nameParts })
  }
  download(result.blob, result.fileName)
  return { fileName: result.fileName, width: result.width, height: result.height, supersample, ms: performance.now() - start, retryReason }
}
