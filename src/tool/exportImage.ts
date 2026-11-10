import { exportPreset, type ControlValues, type ExportAspect, type PackId, type Scene } from '@/light'
import { clampDrag } from './controls'

export interface ExportOutcome {
  fileName: string
  width: number
  height: number
  supersample: 1 | 2
  ms: number
  /** Why the 2x render failed, when it fell back to 1x. */
  retryReason?: string
}

/**
 * The control values an export's file name carries: the ones the user sets. Intensity, softness and the mood control
 * are fixed per mood, and with a line the mood control follows from the line.
 */
export type NamedControls = Pick<ControlValues, 'drag'>

/** Line ends are kept to 0.001 of the frame, so tenths of a percent tell any two lines apart. */
const framePercent = (value: number) => String(Math.round(value * 1000) / 10)

/**
 * File name parts for the controls, at the precision the URL keeps them: when the user dragged a line,
 * `from20,80-to75,30` (its ends in percent of the frame's width and height); none without one.
 */
export function controlNameParts(controls: NamedControls): string[] {
  const line = controls.drag ? clampDrag(controls.drag) : undefined
  return line ? [`from${line.from.map(framePercent).join(',')}`, `to${line.to.map(framePercent).join(',')}`] : []
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
  const nameParts = controls ? controlNameParts(controls) : []
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
