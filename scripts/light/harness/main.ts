import {
  buildMask,
  compareImages,
  DEFAULT_FIT_WEIGHTS,
  fitLoss,
  prepareFitTarget,
  type AuditMetrics,
  type FitLossParts,
  type FitTarget,
  type FitWeights,
  type RgbaImage,
  type RowProfiles,
} from '../../../src/light/audit'
import { exportPreset, type ExportRequest } from '../../../src/light/engine/export'
import { LightRenderer } from '../../../src/light/engine/renderer'
import type { SceneInput } from '../../../src/light/engine/resolve'
import { getRecipe, RECIPE_LIST } from '../../../src/light/recipes'
import type { IgnoreRect } from '../../../src/light/references'
import { isRecipeId, type Preset, type RecipeProgram } from '../../../src/light/scene'
import { TEST_PROGRAMS } from './testPrograms'

/** A recipe scene (with `recipe`) or a test program scene (with `program`). */
export type HarnessScene = SceneInput & { recipe?: string; program?: string }

export interface RenderRequest {
  scene: HarnessScene
  width: number
  height: number
  supersample?: 1 | 2 | 3 | 4
  dither?: boolean
  tileSize?: number
  /** Upload the RGBA bytes to the Node side under this key. */
  upload?: string
}

export interface AuditRequest extends RenderRequest {
  targetKey: string
  ignore: IgnoreRect[]
  cornerRadius: number
  heatmapUpload: string
}

export interface FitSetupRequest {
  targetKey: string
  ignore: IgnoreRect[]
  cornerRadius: number
  width: number
  height: number
}

const canvas = document.createElement('canvas')
const renderer = new LightRenderer(canvas)
let fit: { prepared: FitTarget; width: number; height: number } | null = null

function programFor(scene: HarnessScene): RecipeProgram {
  if (scene.program) {
    const program = TEST_PROGRAMS[scene.program]
    if (!program) throw new Error(`Unknown test program: ${scene.program}`)
    return program
  }
  if (!scene.recipe || !isRecipeId(scene.recipe)) throw new Error(`Unknown recipe: ${scene.recipe}`)
  return getRecipe(scene.recipe)
}

function renderImage(request: RenderRequest): { image: RgbaImage; ms: number } {
  const start = performance.now()
  renderer.renderProgram(programFor(request.scene), request.scene, {
    width: request.width,
    height: request.height,
    supersample: request.supersample ?? 2,
    dither: request.dither ?? true,
    tileSize: request.tileSize,
  })
  const data = renderer.readPixels()
  return { image: { width: request.width, height: request.height, data }, ms: performance.now() - start }
}

async function upload(key: string, bytes: Uint8Array | Uint8ClampedArray): Promise<void> {
  const body = new Blob([new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)])
  const response = await fetch(`/__light/upload/${encodeURIComponent(key)}`, { method: 'POST', body })
  if (!response.ok) throw new Error(`Upload ${key} failed: ${response.status}`)
}

async function download(key: string): Promise<RgbaImage> {
  const response = await fetch(`/__light/blob/${encodeURIComponent(key)}`)
  if (!response.ok) throw new Error(`Download ${key} failed: ${response.status}`)
  const width = Number(response.headers.get('x-width'))
  const height = Number(response.headers.get('x-height'))
  return { width, height, data: new Uint8Array(await response.arrayBuffer()) }
}

const api = {
  ready: true,

  info() {
    const gl = renderer.gpu.gl
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
      recipes: RECIPE_LIST.map((recipe) => ({
        id: recipe.id,
        mood: recipe.mood,
        colorSlots: recipe.colorSlots,
        defaultColors: recipe.defaultColors,
        params: recipe.params,
        lens: recipe.lens ?? {},
        output: recipe.output ?? {},
      })),
    }
  },

  async render(request: RenderRequest): Promise<{ ms: number; uploadMs: number }> {
    const { image, ms } = renderImage(request)
    const start = performance.now()
    if (request.upload) await upload(request.upload, image.data)
    return { ms, uploadMs: performance.now() - start }
  },

  async audit(
    request: AuditRequest,
  ): Promise<{ metrics: AuditMetrics; rows: RowProfiles; renderMs: number; metricsMs: number; downloadMs: number; uploadMs: number }> {
    const downloadStart = performance.now()
    const target = await download(request.targetKey)
    const downloadMs = performance.now() - downloadStart
    if (target.width !== request.width || target.height !== request.height) {
      throw new Error(`Target is ${target.width}x${target.height}, render request is ${request.width}x${request.height}`)
    }
    const { image, ms } = renderImage(request)
    const start = performance.now()
    const mask = buildMask(request.width, request.height, request.ignore, request.cornerRadius)
    const comparison = compareImages(target, image, mask)
    const metricsMs = performance.now() - start
    const uploadStart = performance.now()
    await Promise.all([
      request.upload ? upload(request.upload, image.data) : Promise.resolve(),
      upload(request.heatmapUpload, comparison.heatmap.data),
    ])
    const uploadMs = performance.now() - uploadStart
    return { metrics: comparison.metrics, rows: comparison.rows, renderMs: ms, metricsMs, downloadMs, uploadMs }
  },

  /** Runs the real export path (own offscreen renderer, PNG encode) and uploads the PNG bytes. */
  async exportPng(preset: Preset, request: ExportRequest, uploadKey: string): Promise<{ fileName: string; width: number; height: number; ms: number }> {
    const start = performance.now()
    const result = await exportPreset(preset, request)
    const ms = performance.now() - start
    await upload(uploadKey, new Uint8Array(await result.blob.arrayBuffer()))
    return { fileName: result.fileName, width: result.width, height: result.height, ms }
  },

  async fitSetup(request: FitSetupRequest): Promise<{ width: number; height: number }> {
    const target = await download(request.targetKey)
    const mask = buildMask(target.width, target.height, request.ignore, request.cornerRadius)
    fit = { prepared: prepareFitTarget(target, mask, request.width, request.height), width: request.width, height: request.height }
    return { width: request.width, height: request.height }
  },

  /** Renders each scene at the fit size (1x, no dither, no grain) and returns its loss. */
  fitLoss(scenes: HarnessScene[], weights: FitWeights = DEFAULT_FIT_WEIGHTS): FitLossParts[] {
    const state = fit
    if (!state) throw new Error('Call fitSetup first.')
    return scenes.map((scene) => {
      const output = { ...scene.output, grain: 0 }
      const { image } = renderImage({ scene: { ...scene, output }, width: state.width, height: state.height, supersample: 1, dither: false })
      return fitLoss(state.prepared, image, weights)
    })
  },
}

export type HarnessApi = typeof api

declare global {
  interface Window {
    lightHarness: HarnessApi
  }
}

window.lightHarness = api
document.documentElement.dataset.harness = 'ready'
