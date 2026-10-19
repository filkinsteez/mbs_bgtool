export const MATERIAL_MODEL_RESET_VIEW_EVENT = 'mbs:material-model-reset-view'
export const MATERIAL_MODEL_SETTLE_VIEW_EVENT = 'mbs:material-model-settle-view'

export type MaterialModelStatus = 'loading' | 'ready' | 'error'
export type MaterialLookStatus = 'idle' | 'processing' | 'ready' | 'error'

let materialModelStatus: MaterialModelStatus = 'loading'
const materialModelStatusListeners = new Set<() => void>()
let materialLookStatus: MaterialLookStatus = 'idle'
const materialLookStatusListeners = new Set<() => void>()

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

export function reportMaterialLookStatus(status: MaterialLookStatus): void {
  if (materialLookStatus === status) return
  materialLookStatus = status
  materialLookStatusListeners.forEach((listener) => listener())
}

export function getMaterialLookStatus(): MaterialLookStatus {
  return materialLookStatus
}

export function subscribeMaterialLookStatus(listener: () => void): () => void {
  materialLookStatusListeners.add(listener)
  return () => materialLookStatusListeners.delete(listener)
}
