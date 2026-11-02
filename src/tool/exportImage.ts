import { exportPreset, type ExportAspect, type PackId, type Scene } from '@/light'

export interface ExportOutcome {
  fileName: string
  width: number
  height: number
  supersample: 1 | 2
  ms: number
  /** Why the 2x render failed, when it fell back to 1x. */
  retryReason?: string
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

/** Renders the scene at the format's 4K preset size at 2x and downloads it; retries at 1x if 2x fails. */
export async function exportPng(scene: Scene, pack: PackId, aspect: ExportAspect): Promise<ExportOutcome> {
  const preset = { id: 'tool', pack, scene }
  const start = performance.now()
  let supersample: 1 | 2 = 2
  let retryReason: string | undefined
  let result
  try {
    result = await exportPreset(preset, { aspect, supersample: 2 })
  } catch (error) {
    retryReason = error instanceof Error ? error.message : String(error)
    supersample = 1
    result = await exportPreset(preset, { aspect, supersample: 1 })
  }
  download(result.blob, result.fileName)
  return { fileName: result.fileName, width: result.width, height: result.height, supersample, ms: performance.now() - start, retryReason }
}
