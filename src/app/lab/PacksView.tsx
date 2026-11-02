import { useDialKitController, type DialConfig } from 'dialkit'
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { PACKS, getPack, isPackId } from '@/light/color/packs'
import { EXPORT_ASPECTS, EXPORT_SIZES, exportPreset, type ExportAspect } from '@/light/engine/export'
import { defaultParams } from '@/light/engine/resolve'
import { RECIPE_LIST } from '@/light/recipes'
import type { RecipeDefinition, Scene } from '@/light/scene'
import { mergeAccess, panelAccessFor, usePanelAccess } from '@/tool/panelAccess'
import { errorMessage, useFlash, useLightCanvas } from './hooks'
import { sceneKeySteps } from './sceneConfig'
import { useScenePanel } from './useScenePanel'
import styles from './lab.module.css'

const PREVIEW_LONG_SIDE = 900
const PACK_PANEL = 'lab-pack'
const SCENE_PANEL = 'lab-pack-scene'
const EXPORTING_LABEL = 'Exporting'

const PACK_OPTIONS = PACKS.map((pack) => ({ value: pack.id, label: pack.name }))

const BASE_SCENE: Scene = {
  recipe: RECIPE_LIST[0].id,
  seed: 1,
  colors: [],
  params: defaultParams(RECIPE_LIST[0]),
  lens: {},
  output: {},
}

const isAspect = (value: unknown): value is ExportAspect => typeof value === 'string' && (EXPORT_ASPECTS as readonly string[]).includes(value)

function previewSize(aspect: ExportAspect): { width: number; height: number } {
  const { width, height } = EXPORT_SIZES[aspect]
  const scale = PREVIEW_LONG_SIDE / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Resolves after the browser has painted, so a button label change shows before a long synchronous render. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => window.setTimeout(resolve, 0)))
}

export function PacksView({ panelRoot }: { panelRoot: RefObject<HTMLElement | null> }) {
  const flash = useFlash()
  const [exporting, setExporting] = useState(false)
  const renderHost = useRef<HTMLDivElement>(null)

  const exportLabel = exporting ? EXPORTING_LABEL : flash.label('export', 'Export PNG')
  const packConfig = useMemo<DialConfig>(
    () => ({
      pack: { type: 'select', options: PACK_OPTIONS, default: PACKS[0].id },
      aspect: { type: 'select', options: [...EXPORT_ASPECTS], default: EXPORT_ASPECTS[0] },
      exportPng: { type: 'action', label: exportLabel },
    }),
    [exportLabel],
  )
  const packDial = useDialKitController('Pack', packConfig, {
    id: PACK_PANEL,
    onAction: (action) => {
      if (action === 'exportPng') void exportPng()
    },
  })
  const packValue = packDial.values.pack
  const pack = getPack(typeof packValue === 'string' && isPackId(packValue) ? packValue : PACKS[0].id)
  const aspect = isAspect(packDial.values.aspect) ? packDial.values.aspect : EXPORT_ASPECTS[0]

  const colorsFor = useCallback((recipe: RecipeDefinition) => recipe.fromPack(pack), [pack])
  const { scene, recipe, config } = useScenePanel({ id: SCENE_PANEL, name: 'Scene', base: BASE_SCENE, colors: false, colorsFor })
  const access = useMemo(
    () =>
      mergeAccess(
        panelAccessFor(PACK_PANEL, 'Pack', packConfig, { busy: exporting ? [EXPORTING_LABEL] : [] }),
        panelAccessFor(SCENE_PANEL, 'Scene', config, { keySteps: sceneKeySteps(recipe) }),
      ),
    [packConfig, exporting, config, recipe],
  )
  usePanelAccess(panelRoot, access)

  const size = previewSize(aspect)
  const view = useLightCanvas({ host: renderHost, scene, width: size.width, height: size.height, supersample: 1, canvasClass: styles.canvas })

  async function exportPng() {
    if (exporting) return
    setExporting(true)
    try {
      await afterPaint()
      const result = await exportPreset({ id: `${scene.recipe}-${pack.id}`, pack: pack.id, scene }, { aspect })
      download(result.blob, result.fileName)
    } catch (cause) {
      flash.show('export', errorMessage(cause))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={styles.stage}>
      <div className={styles.panel}>
        <div ref={renderHost} className={view.error ? styles.hidden : styles.fill} />
        {view.error ? <p className={styles.message}>{view.error}</p> : null}
      </div>
    </div>
  )
}
