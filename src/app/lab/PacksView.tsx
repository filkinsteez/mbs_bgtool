import { useMemo, useRef, useState } from 'react'
import { PACKS, getPack, type PackId } from '@/light/color/packs'
import { EXPORT_ASPECTS, EXPORT_SIZES, exportPreset, type ExportAspect } from '@/light/engine/export'
import { defaultParams, resolveScene } from '@/light/engine/resolve'
import { RECIPE_LIST, getRecipe } from '@/light/recipes'
import type { ParamValue, RecipeId, Scene } from '@/light/scene'
import { ParamControls, RECIPE_OPTIONS, SeedRow, SelectRow, type Option } from './controls'
import { errorMessage, useFlash, useLightCanvas } from './hooks'
import styles from './lab.module.css'

const PREVIEW_LONG_SIDE = 900

const PACK_OPTIONS: readonly Option<PackId>[] = PACKS.map((pack) => ({ value: pack.id, label: pack.name }))
const ASPECT_OPTIONS: readonly Option<ExportAspect>[] = EXPORT_ASPECTS.map((aspect) => ({ value: aspect, label: aspect }))

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

export function PacksView({ active }: { active: boolean }) {
  const [recipeId, setRecipeId] = useState<RecipeId>(RECIPE_LIST[0].id)
  const [packId, setPackId] = useState<PackId>(PACKS[0].id)
  const [aspect, setAspect] = useState<ExportAspect>(EXPORT_ASPECTS[0])
  const [seed, setSeed] = useState(1)
  const [params, setParams] = useState<Record<string, ParamValue>>(() => defaultParams(RECIPE_LIST[0]))
  const [exporting, setExporting] = useState(false)
  const flash = useFlash()
  const renderHost = useRef<HTMLDivElement>(null)

  const recipe = getRecipe(recipeId)
  const pack = getPack(packId)
  const scene = useMemo<Scene>(
    () => ({ recipe: recipe.id, seed, colors: recipe.fromPack(pack), params, lens: {}, output: {} }),
    [recipe, pack, seed, params],
  )
  const values = useMemo(() => resolveScene(recipe, scene).params, [recipe, scene])
  const size = previewSize(aspect)
  const view = useLightCanvas({
    host: renderHost,
    scene,
    width: size.width,
    height: size.height,
    supersample: 1,
    canvasClass: styles.canvas,
  })

  function changeRecipe(id: RecipeId) {
    setRecipeId(id)
    setParams(defaultParams(getRecipe(id)))
  }

  async function exportPng() {
    setExporting(true)
    try {
      await afterPaint()
      const result = await exportPreset({ id: `${recipe.id}-${pack.id}`, pack: pack.id, scene }, { aspect })
      download(result.blob, result.fileName)
    } catch (cause) {
      flash.show('export', errorMessage(cause))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={active ? styles.view : styles.hidden}>
      <div className={styles.stage}>
        <div className={styles.panel}>
          <div ref={renderHost} className={view.error ? styles.hidden : styles.fill} />
          {view.error ? <p className={styles.message}>{view.error}</p> : null}
        </div>
      </div>
      <div className={styles.side}>
        <div className={styles.group}>
          <SelectRow label="Recipe" value={recipeId} options={RECIPE_OPTIONS} onChange={changeRecipe} />
          <SelectRow label="Pack" value={packId} options={PACK_OPTIONS} onChange={setPackId} />
          <SelectRow label="Aspect" value={aspect} options={ASPECT_OPTIONS} onChange={setAspect} />
          <SeedRow value={seed} onChange={setSeed} />
          <div className={styles.buttons}>
            <button type="button" className={styles.button} disabled={exporting} onClick={() => void exportPng()}>
              {exporting ? 'Exporting' : flash.label('export', 'Export PNG')}
            </button>
          </div>
        </div>
        <div className={styles.group}>
          <ParamControls
            specs={recipe.params}
            values={values}
            onChange={(key, value) => setParams((current) => ({ ...current, [key]: value }))}
          />
        </div>
      </div>
    </div>
  )
}
