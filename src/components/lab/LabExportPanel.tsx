'use client'

import { useEffect, useState } from 'react'
import { exportMaterialAtTarget } from '@/features/background-generator/material/exportMaterial'
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
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const flash = (msg: string) => {
    setNote(msg)
    setTimeout(() => setNote(''), 2500)
  }

  const doExport = async () => {
    setBusy(true)
    try {
      const dimensions = canonicalizeFormat(output)
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
      flash(error instanceof Error ? `Export failed: ${error.message}` : 'Export failed')
    } finally {
      setBusy(false)
    }
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
    <div className="panel-section" role="region" aria-label="Export">
      <button type="button" className="ctl-action primary" disabled={busy} onClick={doExport}>
        {busy ? 'Rendering…' : 'Export'}
      </button>
      {note ? (
        <div className="panel-note" role="status" aria-live="polite">
          {note}
        </div>
      ) : null}
    </div>
  )
}
