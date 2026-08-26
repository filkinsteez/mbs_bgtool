'use client'

import { useEffect, useState } from 'react'
import { useLabStore } from '@/core/lab/labStore'
import { getLabSource } from '@/core/lab/sourceCache'
import { exportLabPng } from '@/core/lab/render'
import { resolveBankCached } from './bankCache'
import { exportMaterialAtTarget } from '@/features/background-generator/material/exportMaterial'
import {
  dimensionsFor,
  dimensionsForRatio,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'

// Export is WYSIWYG: the PNG is the preview's exact painter at full
// output size. Transparency isn't a toggle — zones set to "None"
// export as alpha, exactly as the checkerboard shows them.
async function renderCurrentPng(): Promise<Blob> {
  const background = useBackgroundStore.getState()
  const recipe = background.recipe
  const mode = background.mode
  const state = useLabStore.getState()
  const protos = resolveBankCached(state.lab.mark.bank)
  const dimensions = recipe.format.aspect === 'custom'
    ? dimensionsForRatio(recipe.format.width / recipe.format.height)
    : dimensionsFor(recipe.format.aspect)
  const exportRecipe = {
    ...recipe,
    format: {
      ...recipe.format,
      ...dimensions,
    },
  }
  if (mode === 'material') return exportMaterialAtTarget(exportRecipe, protos)
  return exportLabPng(
    {
      ...state.lab,
      output: {
        ...state.lab.output,
        ...dimensions,
      },
    },
    getLabSource(),
    protos,
    exportRecipe.transforms.background,
  )
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
      const dimensions = output.aspect === 'custom'
        ? dimensionsForRatio(output.width / output.height)
        : dimensionsFor(output.aspect)
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
