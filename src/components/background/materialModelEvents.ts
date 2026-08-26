export const MATERIAL_MODEL_RESET_VIEW_EVENT = 'mbs:material-model-reset-view'
export const MATERIAL_MODEL_SETTLE_VIEW_EVENT = 'mbs:material-model-settle-view'

export type MaterialModelStatus = 'loading' | 'ready' | 'error'

let materialModelStatus: MaterialModelStatus = 'loading'
const materialModelStatusListeners = new Set<() => void>()

export function reportMaterialModelStatus(status: MaterialModelStatus): void {
  if (materialModelStatus === status) return
  materialModelStatus = status
  materialModelStatusListeners.forEach((listener) => listener())
}

export function getMaterialModelStatus(): MaterialModelStatus {
  return materialModelStatus
}

export function subscribeMaterialModelStatus(listener: () => void): () => void {
  materialModelStatusListeners.add(listener)
  return () => materialModelStatusListeners.delete(listener)
}
