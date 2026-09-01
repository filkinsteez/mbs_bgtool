'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  getMaterialModelStatus,
  subscribeMaterialModelStatus,
} from '@/components/background/materialModelEvents'
import { exportMaterialAtTarget } from '@/features/background-generator/material/exportMaterial'
import {
  defaultPresetName,
  parseLookPreset,
  presetFilename,
  serializeLookPreset,
} from '@/features/background-generator/lookPreset'
import { canonicalizeFormat } from '@/features/background-generator/recipe'
import {
  exportBackground2DPng,
  resolveBackground2DInputs,
} from '@/features/background-generator/render2d'
import { useBackgroundStore } from '@/features/background-generator/store'

// Export is WYSIWYG: the PNG is the preview's exact painter at full
// output size. Transparency isn't a toggle — zones set to "None"
// export as alpha, exactly as the checkerboard shows them.
async function renderCurrentPng(): Promise<Blob> {
  const background = useBackgroundStore.getState()
  const recipe = background.recipe
  const mode = background.mode
  const exportRecipe = {
    ...recipe,
    format: canonicalizeFormat(recipe.format),
  }
  if (mode === 'material') {
    const { protos } = resolveBackground2DInputs(exportRecipe, { phase: 'export' })
    return exportMaterialAtTarget(exportRecipe, protos)
  }
  return exportBackground2DPng(exportRecipe)
}

export function LabExportPanel() {
  const recipe = useBackgroundStore((state) => state.recipe)
  const mode = useBackgroundStore((state) => state.mode)
  const output = recipe.format
  const presetInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [noteKind, setNoteKind] = useState<'status' | 'error'>('status')
  const materialStatus = useSyncExternalStore(
    subscribeMaterialModelStatus,
    getMaterialModelStatus,
    () => 'loading',
  )
  const exportDisabled = busy || (mode === 'material' && materialStatus !== 'ready')

  const flash = (msg: string, kind: 'status' | 'error' = 'status') => {
    setNoteKind(kind)
    setNote(msg)
    setTimeout(() => setNote(''), 2500)
  }

  const doExport = async () => {
    if (exportDisabled) return
    setBusy(true)
    try {
      const dimensions = canonicalizeFormat(output)
      setNoteKind('status')
      setNote(`Rendering ${dimensions.width} × ${dimensions.height}…`)
      const blob = await renderCurrentPng()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const treatment = mode === 'background' ? recipe.look.id : recipe.material.id
      a.download = `mbs-${mode}-${treatment}-${recipe.seed}.png`
      a.click()
      URL.revokeObjectURL(a.href)
      flash('PNG exported')
    } catch (error) {
      flash(
        error instanceof Error ? `Export failed: ${error.message}` : 'Export failed',
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  const doSaveLook = () => {
    const state = useBackgroundStore.getState()
    const name = defaultPresetName(state.recipe, state.mode)
    const json = serializeLookPreset(state.recipe, state.mode, name)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = presetFilename(name)
    a.click()
    URL.revokeObjectURL(a.href)
    flash('Look saved')
  }

  const doOpenLook = async (file: File) => {
    const parsed = parseLookPreset(await file.text())
    if (!parsed) {
      flash('Not a look file', 'error')
      return
    }
    const store = useBackgroundStore.getState()
    store.replaceRecipe(parsed.recipe)
    store.setMode(parsed.recipe.mode)
    flash(`Loaded ${parsed.name}`)
  }

  // dev capture hook — the REAL export as a dataURL for the devshot loop
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const w = window as unknown as { __lbsLabExportPng?: () => Promise<string> }
    w.__lbsLabExportPng = async () => {
      const blob = await renderCurrentPng()
      return await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsDataURL(blob)
      })
    }
    return () => {
      delete w.__lbsLabExportPng
    }
  }, [])

  return (
    <div className="panel-section lab-export-panel" role="region" aria-label="Export">
      <button
        type="button"
        className="ctl-action primary"
        aria-disabled={exportDisabled}
        aria-busy={busy}
        onClick={() => void doExport()}
      >
        {busy ? 'Rendering…' : 'Export'}
      </button>
      <div className="lab-look-preset-row">
        <button type="button" className="ctl-action" onClick={doSaveLook}>
          Save look
        </button>
        <button
          type="button"
          className="ctl-action"
          onClick={() => presetInputRef.current?.click()}
        >
          Open look
        </button>
        <input
          ref={presetInputRef}
          type="file"
          accept="application/json,.json"
          className="lab-visually-hidden"
          aria-label="Open look file"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void doOpenLook(file)
          }}
        />
      </div>
      {note ? (
        <div
          className="panel-note"
          role={noteKind === 'error' ? 'alert' : 'status'}
          aria-live={noteKind === 'error' ? 'assertive' : 'polite'}
        >
          {note}
        </div>
      ) : null}
    </div>
  )
}
