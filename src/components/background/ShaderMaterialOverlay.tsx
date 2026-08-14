'use client'

import { useState, type ReactNode } from 'react'
import {
  CRTScreen,
  FilmGrain,
  FilmStock,
  Glass,
  LiquidMetal,
  Pixelate,
  Shader,
  SolidColor,
  StudioBackground,
  Swirl,
} from 'shaders/react'
import { useBackgroundStore } from '@/features/background-generator/store'
import type { MaterialId } from '@/features/background-generator/material/shadersCatalog'
import { materialRenderModel } from '@/features/background-generator/material/renderModel'
import { materialPreviewCssSize } from '@/features/background-generator/material/renderSizing'

export function ShaderMaterialOverlay({ displayScale }: { displayScale: number }) {
  const recipe = useBackgroundStore((state) => state.recipe)
  const material = useBackgroundStore((state) => state.recipe.material)
  const format = useBackgroundStore((state) => state.recipe.format)
  const [readyMaterial, setReadyMaterial] = useState<MaterialId | null>(null)
  const [failedMaterial, setFailedMaterial] = useState<MaterialId | null>(null)
  const model = materialRenderModel(recipe)
  const previewSize = materialPreviewCssSize(
    format.width,
    format.height,
    displayScale,
  )

  if (material.id === 'clean') {
    return (
      <div
        className="lab-clean-material"
        data-mbs-clean-material="true"
        style={{
          width: previewSize.width,
          height: previewSize.height,
        }}
      >
        <span
          className="lab-clean-material-symbol"
          style={{
            left: `${model.metal.center.x * 100}%`,
            top: `${model.metal.center.y * 100}%`,
            width: `${model.metal.scale * 100}%`,
            height: `${model.metal.scale * 100}%`,
            backgroundColor: model.metal.lightColor,
            transform: `translate(-50%, -50%) rotate(${model.metal.rotation}deg)`,
          }}
        />
      </div>
    )
  }
  if (failedMaterial === material.id) {
    return (
      <div className="lab-material-unavailable" role="status" data-mbs-shader-unavailable="true">
        GPU effect unavailable · choose Clean
      </div>
    )
  }

  const metaMetal = <LiquidMetal {...model.metal} />
  const materialSource = (
    <>
      <SolidColor {...model.solid} />
      {metaMetal}
    </>
  )
  let treatment: ReactNode
  if (material.id === 'metal') {
    treatment = (
      <>
        <StudioBackground {...model.stainlessSteel.background} />
        <Glass {...model.stainlessSteel.glass}>
          <Swirl {...model.stainlessSteel.swirl} />
        </Glass>
        <FilmGrain {...model.stainlessSteel.grain} />
      </>
    )
  } else if (material.id === 'glass') {
    treatment = (
      <>
        <SolidColor {...model.solid} />
        <Glass {...model.glass} />
      </>
    )
  } else if (material.id === 'film') {
    treatment = (
      <FilmStock {...model.film}>
        <FilmGrain {...model.grain}>
          {materialSource}
        </FilmGrain>
      </FilmStock>
    )
  } else if (material.id === 'pixel') {
    treatment = (
      <Pixelate {...model.pixel}>
        {materialSource}
      </Pixelate>
    )
  } else if (material.id === 'crt') {
    treatment = (
      <CRTScreen {...model.crt}>
        {materialSource}
      </CRTScreen>
    )
  } else {
    treatment = materialSource
  }

  return (
    <Shader
      className="lab-shader-overlay"
      data-mbs-shader="true"
      data-shader-ready={readyMaterial === material.id}
      colorSpace="p3-linear"
      toneMapping="linear"
      disableTelemetry
      onReady={() => {
        setReadyMaterial(material.id)
        window.dispatchEvent(new CustomEvent('mbs:shader-ready'))
      }}
      onUnavailable={() => setFailedMaterial(material.id)}
      style={{
        width: previewSize.width,
        height: previewSize.height,
      }}
    >
      {treatment}
    </Shader>
  )
}
