import { deltaEMap, heatmapImage } from '@/light/audit/metrics'
import type { DiffJob, DiffResult } from './diff'

addEventListener('message', (event: MessageEvent<DiffJob>) => {
  const { key, width, height, target, render, mask } = event.data
  const map = deltaEMap({ width, height, data: target }, { width, height, data: render })
  const heat = new Uint8ClampedArray(heatmapImage(map, width, height, mask).data)
  const result: DiffResult = { key, width, height, heat }
  postMessage(result, { transfer: [heat.buffer] })
})
