'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { GRADIENT_LOOKS } from '@/core/lab/looks'
import { createDefaultBackgroundRecipe, type BackgroundRecipeV2 } from '@/features/background-generator/recipe'
import { colorMixForPack, PALETTE_PACKS } from '@/features/background-generator/palette/registry'
import { renderBackground2DCanvas, exportBackground2DPng } from '@/features/background-generator/render2d'
import { brushStudy } from '@/core/lab/gradients/studies'
import { serializeLookPreset } from '@/features/background-generator/lookPreset'

// Development-only visual review. Uses the production renderer and saves every
// iteration through /api/devshot; no reference images are bundled with the app.
export function GradientReview() {
  const root = useRef<HTMLDivElement>(null)
  const [seed, setSeed] = useState(1913)
  const [aspect, setAspect] = useState('16:9')
  const [stage, setStage] = useState('01')
  const [status, setStatus] = useState('')
  const [study, setStudy] = useState('none')
  const [softness, setSoftness] = useState(0.5)
  const [folds, setFolds] = useState(0.32)
  const [bleed, setBleed] = useState(0.6)
  const [depth, setDepth] = useState(0.45)
  const [complexity, setComplexity] = useState(0.65)
  const [distortion, setDistortion] = useState(0.65)
  const palettes = ['bold', 'harmonious', 'atmospheric', 'primary-core', 'primary-neutrals', 'neutral-flex']
  const recipeFor = (index: number): BackgroundRecipeV2 => {
    const recipe = createDefaultBackgroundRecipe(seed)
    const pack = PALETTE_PACKS.find((p) => p.id === palettes[Math.floor(index / 4)])!
    recipe.look = { version: 'gradients', id: GRADIENT_LOOKS[index % 4].id, detail: complexity, gradient: { softness, distortion, grain: 0.22, scale: 0.5, folds, bleed, depth } }
    if (study !== 'none') recipe.look.deformation = brushStudy(aspect === '9:16' ? 9 / 16 : 16 / 9, study as 'sweep' | 'fold')
    recipe.palette = { packId: pack.id, mix: colorMixForPack(pack), ground: pack.colors.at(-1)!, ink: pack.colors[0] }
    recipe.format = aspect === '9:16'
      ? { aspect: '9:16', width: 2160, height: 3840 }
      : { aspect: '16:9', width: 3840, height: 2160 }
    return recipe
  }
  useEffect(() => {
    root.current?.querySelectorAll('canvas').forEach((canvas, index) => {
      renderBackground2DCanvas(canvas, recipeFor(index), { phase: 'preview', maxLongEdge: 960 })
    })
  // This development matrix has a fixed palette/renderer order.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, aspect, study, softness, folds, bleed, depth, complexity, distortion])

  const save = async () => {
    const canvases = Array.from(root.current!.querySelectorAll('canvas'))
    // Re-render before capturing so hot-reloaded shader changes cannot leave
    // an old canvas paired with a new recipe in the review archive.
    canvases.forEach((canvas, index) => renderBackground2DCanvas(canvas, recipeFor(index), { phase: 'preview', maxLongEdge: 960 }))
    const width = 640, height = aspect === '9:16' ? 1138 : 360
    const sheet = document.createElement('canvas')
    sheet.width = 4 * width
    sheet.height = palettes.length * (height + 38)
    const ctx = sheet.getContext('2d')!
    ctx.fillStyle = '#111315'
    ctx.fillRect(0, 0, sheet.width, sheet.height)
    for (let i = 0; i < canvases.length; i++) {
      const name = `gradient-${stage}-${study}-${seed}-${aspect.replace(':', '-')}-${palettes[Math.floor(i / 4)]}-${GRADIENT_LOOKS[i % 4].id}`
      const response = await fetch('/api/devshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, dataUrl: canvases[i].toDataURL(), recipe: JSON.parse(serializeLookPreset(recipeFor(i), 'background', name)) }) })
      if (!response.ok) throw new Error('Snapshot save failed')
      const x = i % 4 * width, y = Math.floor(i / 4) * (height + 38)
      ctx.drawImage(canvases[i], x, y, width, height)
      ctx.fillStyle = '#fff'
      ctx.font = '16px sans-serif'
      ctx.fillText(`${palettes[Math.floor(i / 4)]} / ${GRADIENT_LOOKS[i % 4].label} / ${seed}`, x + 12, y + height + 25)
    }
    await fetch('/api/devshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `gradient-${stage}-${study}-sheet-${seed}-${aspect.replace(':', '-')}`, dataUrl: sheet.toDataURL() }) })
    setStatus(`Saved ${stage}`)
  }

  const validate = async () => {
    setStatus('Checking renders')
    const results: string[] = []
    const canvas = document.createElement('canvas')
    const draw = (recipe: BackgroundRecipeV2, timeMs = 0) => {
      renderBackground2DCanvas(canvas, recipe, { phase: 'preview', maxLongEdge: 480, timeMs })
      return canvas.toDataURL()
    }
    const structureFrames: Uint8ClampedArray[] = []
    const variance = (pixels: Uint8ClampedArray) => {
      const sum = [0, 0, 0], squared = [0, 0, 0]
      const count = pixels.length / 4
      for (let p = 0; p < pixels.length; p += 4) for (let c = 0; c < 3; c++) {
        sum[c] += pixels[p + c]
        squared[c] += pixels[p + c] ** 2
      }
      return sum.reduce((v, s, c) => v + squared[c] / count - (s / count) ** 2, 0) / 3
    }
    for (let i = 0; i < 4; i++) {
      const recipe = recipeFor(i)
      const first = draw(recipe)
      const repeated = draw(recipe)
      if (first !== repeated) {
        for (const [name, dataUrl] of [['first', first], ['repeat', repeated]]) {
          await fetch('/api/devshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `gradient-${stage}-failed-${name}`, dataUrl }) })
        }
        throw new Error('Repeat render differs')
      }
      const depthRecipe = (value: number): BackgroundRecipeV2 => ({ ...recipe,
        look: { ...recipe.look, gradient: { ...recipe.look.gradient!, depth: value, grain: 0 } },
      })
      draw(depthRecipe(0.45))
      const structured = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      draw(depthRecipe(0))
      const washed = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      const varianceRatio = variance(washed) / Math.max(1, variance(structured))
      if (varianceRatio > 0.3) throw new Error(`Depth zero retains too much separation: ${varianceRatio.toFixed(2)}`)
      if (i < 3) {
        for (const earlier of structureFrames) {
          let difference = 0
          for (let p = 0; p < structured.length; p += 4) for (let c = 0; c < 3; c++) difference += Math.abs(structured[p + c] - earlier[p + c])
          difference /= structured.length * 0.75
          if (difference < 8) throw new Error(`Look structures are too similar: ${difference.toFixed(2)}`)
        }
        structureFrames.push(structured)
      }
      const colorRecipe = (colors: string[]): BackgroundRecipeV2 => ({ ...recipe,
        palette: { ...recipe.palette, packId: 'custom', mix: colors.map((color) => ({ color, enabled: true, ratio: 100 })) },
        look: { ...recipe.look, gradient: { ...recipe.look.gradient!, grain: 0 } },
      })
      // Test the real GPU output: lighting and overlap must not add brown/gray
      // shadows to bright swatches, or add color to intentional neutrals.
      for (const hex of ['#0064E0', '#FF4F00', '#808080', '#000000', '#FFFFFF']) {
        draw(colorRecipe([hex]))
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        const expected = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
        for (let p = 0; p < pixels.length; p += 4) {
          for (let c = 0; c < 3; c++) if (Math.abs(pixels[p + c] - expected[c]) > 2) throw new Error(`Single swatch changed: ${hex}`)
        }
      }
      draw(colorRecipe(['#0064E0', '#FFD61E', '#FF4F00', '#25C8EE']))
      const vividPixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      for (let p = 0; p < vividPixels.length; p += 4) {
        // The input minimum value is 224. Allow the texture sampler's local
        // interpolation at smear edges, while rejecting added dark shading.
        if (Math.max(vividPixels[p], vividPixels[p + 1], vividPixels[p + 2]) < 208) {
          await fetch('/api/devshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `gradient-${stage}-failed-brightness`, dataUrl: canvas.toDataURL() }) })
          throw new Error(`Bright swatches became dark at ${p / 4}: ${Array.from(vividPixels.slice(p, p + 4))}`)
        }
      }
      const primary = PALETTE_PACKS.find((pack) => pack.id === 'primary-core')!
      draw(colorRecipe([...primary.colors]))
      await fetch('/api/devshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `gradient-${stage}-${study}-primary-${recipe.look.id}`, dataUrl: canvas.toDataURL() }) })
      const weighted = (ratio: number) => ({ ...recipe, palette: { ...recipe.palette, mix: recipe.palette.mix.map((c, j) => j === 0 ? { ...c, ratio } : c) } })
      if (draw(weighted(5)) === draw(weighted(95))) throw new Error('Lead color weight has no effect')
      if (first === draw({ ...recipe, seed: seed + 717 })) throw new Error('Seed has no effect')
      if (first === draw({ ...recipe, symbol: { enabled: false } })) throw new Error('Symbol control has no effect')
      if (draw({ ...recipe, look: { ...recipe.look, detail: 0 } }) === draw({ ...recipe, look: { ...recipe.look, detail: 1 } })) throw new Error('Complexity has no effect')
      for (const key of ['softness', 'distortion', 'scale', 'folds', 'bleed', 'depth', 'grain'] as const) {
        const base = { softness: 0.5, distortion: 0.45, grain: 0.22 }
        if (draw({ ...recipe, look: { ...recipe.look, gradient: { ...base, [key]: 0 } } }) === draw({ ...recipe, look: { ...recipe.look, gradient: { ...base, [key]: 1 } } })) throw new Error(`${key} has no effect`)
      }
      if (recipe.look.deformation && first === draw({ ...recipe, look: { ...recipe.look, deformation: undefined } })) throw new Error('Brush has no effect')
      recipe.motion = { ...recipe.motion, enabled: true, amount: 0.7 }
      if (draw(recipe, 0) !== draw(recipe, recipe.motion.loopSeconds * 1000)) throw new Error('Loop does not close')
      if (draw(recipe, 0) === draw(recipe, recipe.motion.loopSeconds * 250)) throw new Error('Motion is static')
      if (draw(recipe, 1100) === draw({ ...recipe, motion: { ...recipe.motion, speed: 2 } }, 1100)) throw new Error('Energy has no effect')
      const start = performance.now()
      const png = await exportBackground2DPng(recipe)
      const bitmap = await createImageBitmap(png)
      if (Math.max(bitmap.width, bitmap.height) !== 3840) throw new Error('Export is not 4K')
      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = bitmap.width
      exportCanvas.height = bitmap.height
      exportCanvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      await fetch('/api/devshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `gradient-${stage}-${study}-4k-${recipe.look.id}`, dataUrl: exportCanvas.toDataURL() }) })
      bitmap.close()
      // Compare color/composition at preview and export sizes without the grain,
      // whose samples deliberately follow the final output pixel grid.
      const clean = { ...recipe, motion: { ...recipe.motion, enabled: false }, look: { ...recipe.look, gradient: { softness: 0.5, distortion: 0.45, grain: 0 } } }
      draw(clean)
      const expected = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      const exported = await createImageBitmap(await exportBackground2DPng(clean))
      canvas.getContext('2d')!.drawImage(exported, 0, 0, canvas.width, canvas.height)
      exported.close()
      const actual = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let error = 0
      for (let p = 0; p < actual.length; p++) error += Math.abs(expected[p] - actual[p])
      error /= actual.length
      if (error > 3) throw new Error(`Preview/export difference: ${error.toFixed(2)}`)
      const exportTime = Math.round(performance.now()-start)
      const frameStart = performance.now()
      for (let frame = 0; frame < 4; frame++) {
        renderBackground2DCanvas(canvas, recipe, { phase: 'preview', maxLongEdge: 1200, timeMs: frame * 100 })
        canvas.getContext('2d')!.getImageData(0, 0, 1, 1)
      }
      results.push(`${GRADIENT_LOOKS[i].label}: depth-zero variance ${(varianceRatio * 100).toFixed(1)}% of default; structure, color brightness, single swatches, neutrals, repeat, seed, symbol, palette weight, controls, loop, energy, 4K passed; preview/export error ${error.toFixed(2)}/255 (${exportTime} ms including two exports); 1200px frame + readback ${((performance.now()-frameStart)/4).toFixed(1)} ms`)
    }
    setStatus(results.join('\n'))
  }

  const saveDepthStudy = async () => {
    const depths = [0, 0.15, 0.45, 1]
    const width = 480, height = aspect === '9:16' ? 854 : 270
    const sheet = document.createElement('canvas'), sample = document.createElement('canvas')
    const comparison = document.createElement('canvas')
    comparison.width = width * 3
    comparison.height = height + 34
    const compareCtx = comparison.getContext('2d')!
    compareCtx.fillStyle = '#111315'
    compareCtx.fillRect(0, 0, comparison.width, comparison.height)
    sheet.width = width * 3
    sheet.height = (height + 34) * depths.length
    const ctx = sheet.getContext('2d')!
    ctx.fillStyle = '#111315'
    ctx.fillRect(0, 0, sheet.width, sheet.height)
    for (let row = 0; row < depths.length; row++) for (let column = 0; column < 3; column++) {
      const recipe = recipeFor(column)
      recipe.look.gradient = { ...recipe.look.gradient!, depth: depths[row] }
      renderBackground2DCanvas(sample, recipe, { phase: 'preview', maxLongEdge: 960 })
      const x = column * width, y = row * (height + 34)
      ctx.drawImage(sample, x, y, width, height)
      ctx.fillStyle = '#fff'
      ctx.font = '14px sans-serif'
      ctx.fillText(`${GRADIENT_LOOKS[column].label} / Depth ${Math.round(depths[row] * 100)}%`, x + 12, y + height + 23)
      if (depths[row] === 0.45) {
        compareCtx.drawImage(sample, x, 0, width, height)
        compareCtx.fillStyle = '#fff'
        compareCtx.font = '14px sans-serif'
        compareCtx.fillText(GRADIENT_LOOKS[column].label, x + 12, height + 23)
      }
    }
    const response = await fetch('/api/devshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `gradient-${stage}-depth-study-${seed}-${aspect.replace(':', '-')}`, dataUrl: sheet.toDataURL() }) })
    if (!response.ok) throw new Error('Depth study save failed')
    const comparisonResponse = await fetch('/api/devshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `gradient-${stage}-look-comparison-${seed}-${aspect.replace(':', '-')}`, dataUrl: comparison.toDataURL() }) })
    if (!comparisonResponse.ok) throw new Error('Look comparison save failed')
    setStatus(`Saved depth study ${stage}`)
  }

  const validatePalettes = async () => {
    const canvas = document.createElement('canvas')
    const results: string[] = []
    for (const pack of PALETTE_PACKS.filter((p) => p.tier !== 'extended')) {
      let minRange = Infinity, minDifference = Infinity, maxFlatRatio = 0, maxExportError = 0
      for (const sampleSeed of [1913, 9027, 14023]) {
        const frames: Uint8ClampedArray[] = []
        for (let i = 0; i < 4; i++) {
          const recipe = recipeFor(i)
          recipe.seed = sampleSeed
          recipe.palette = { packId: pack.id, mix: colorMixForPack(pack), ground: pack.colors.at(-1)!, ink: pack.colors[0] }
          recipe.look.gradient = { ...recipe.look.gradient!, depth: 0.45, grain: 0 }
          const capture = () => {
            renderBackground2DCanvas(canvas, recipe, { phase: 'preview', maxLongEdge: 480 })
            return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
          }
          const pixels = capture()
          const values = (data: Uint8ClampedArray) => {
            const sorted: number[] = []
            for (let p = 0; p < data.length; p += 4) sorted.push(Math.max(data[p], data[p + 1], data[p + 2]))
            sorted.sort((a, b) => a - b)
            return sorted[Math.floor(sorted.length * 0.95)] - sorted[Math.floor(sorted.length * 0.05)]
          }
          const range = values(pixels)
          minRange = Math.min(minRange, range)
          for (const previous of frames) {
            let difference = 0
            for (let p = 0; p < pixels.length; p += 4) for (let c = 0; c < 3; c++) difference += Math.abs(pixels[p + c] - previous[p + c])
            minDifference = Math.min(minDifference, difference / (pixels.length / 4 * 3))
          }
          frames.push(pixels)
          if (sampleSeed === 1913) {
            const bitmap = await createImageBitmap(await exportBackground2DPng(recipe))
            if (Math.max(bitmap.width, bitmap.height) !== 3840) throw new Error(`${pack.label}: export is not 4K`)
            canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
            bitmap.close()
            const exported = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
            let difference = 0
            for (let p = 0; p < pixels.length; p += 4) for (let c = 0; c < 3; c++) difference += Math.abs(pixels[p + c] - exported[p + c])
            maxExportError = Math.max(maxExportError, difference / (pixels.length / 4 * 3))
          }
          recipe.look.gradient.depth = 0
          maxFlatRatio = Math.max(maxFlatRatio, values(capture()) / Math.max(range, 1))
        }
      }
      if (minRange < 5) throw new Error(`${pack.label}: insufficient tonal range (${minRange})`)
      if (minDifference < 4) throw new Error(`${pack.label}: look difference only ${minDifference.toFixed(1)}/255`)
      if (maxFlatRatio > 0.35) throw new Error(`${pack.label}: Depth zero retains too much contrast`)
      if (maxExportError > 3) throw new Error(`${pack.label}: preview/export difference ${maxExportError.toFixed(2)}/255`)
      results.push(`${pack.label}: 3 seeds × 4 looks passed; minimum brightness span ${minRange}/255; minimum look difference ${minDifference.toFixed(1)}/255; maximum Depth-zero span ${(maxFlatRatio * 100).toFixed(1)}%; 4K error ${maxExportError.toFixed(2)}/255`)
    }
    const response = await fetch('/api/devshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `gradient-${stage}-palette-checks-${aspect.replace(':', '-')}`, dataUrl: canvas.toDataURL(), recipe: { results, aspect, softness, complexity, bleed, study } }) })
    if (!response.ok) throw new Error('Palette check save failed')
    setStatus(results.join('\n'))
  }

  return <div style={{ padding: 24, background: '#111315', minHeight: '100vh', color: '#fff' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20, alignItems: 'center' }}>
      <label>Seed <input aria-label="Review seed" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label>
      <select aria-label="Review aspect" value={aspect} onChange={(e) => setAspect(e.target.value)}><option>16:9</option><option>9:16</option></select>
      <select aria-label="Brush study" value={study} onChange={(e) => setStudy(e.target.value)}><option value="none">No brush</option><option value="sweep">Swept</option><option value="fold">Folded</option></select>
      <label>Softness <input aria-label="Review softness" type="number" min="0" max="1" step="0.05" value={softness} onChange={(e) => setSoftness(Number(e.target.value))} style={{ width: 55 }} /></label>
      <label>Folds <input aria-label="Review folds" type="number" min="0" max="1" step="0.05" value={folds} onChange={(e) => setFolds(Number(e.target.value))} style={{ width: 55 }} /></label>
      <label>Bleed <input aria-label="Review bleed" type="number" min="0" max="1" step="0.05" value={bleed} onChange={(e) => setBleed(Number(e.target.value))} style={{ width: 55 }} /></label>
      <label>Depth <input aria-label="Review depth" type="number" min="0" max="1" step="0.05" value={depth} onChange={(e) => setDepth(Number(e.target.value))} style={{ width: 55 }} /></label>
      <label>Complexity <input aria-label="Review complexity" type="number" min="0" max="1" step="0.05" value={complexity} onChange={(e) => setComplexity(Number(e.target.value))} style={{ width: 55 }} /></label>
      <label>Distortion <input aria-label="Review distortion" type="number" min="0" max="1" step="0.05" value={distortion} onChange={(e) => setDistortion(Number(e.target.value))} style={{ width: 55 }} /></label>
      <label>Iteration <input aria-label="Iteration" value={stage} onChange={(e) => setStage(e.target.value)} style={{ width: 70 }} /></label>
      <button onClick={() => save().catch((e) => setStatus(String(e)))}>Save snapshots</button>
      <button onClick={() => saveDepthStudy().catch((e) => setStatus(String(e)))}>Save depth study</button>
      <button onClick={() => validate().catch((e) => setStatus(String(e)))}>Check rendering</button>
      <button onClick={() => validatePalettes().catch((e) => setStatus(String(e)))}>Check palettes</button>
      <Link href="/">Generator</Link>
    </div>
    <pre role="status" style={{ whiteSpace: 'pre-wrap' }}>{status}</pre>
    <div ref={root} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
      {palettes.flatMap((palette) => GRADIENT_LOOKS.map((look) => <div key={`${palette}-${look.id}`}>
        <canvas aria-label={`${palette} ${look.label}`} style={{ width: '100%', height: 'auto', display: 'block' }} />
        <p style={{ margin: '8px 0 20px', fontSize: 12 }}>{palette} / {look.label}</p>
      </div>))}
    </div>
  </div>
}
