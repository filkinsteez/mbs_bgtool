import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react'
import { LightRenderer } from '@/light/engine/renderer'
import type { Scene } from '@/light/scene'

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

interface Surface {
  canvas: HTMLCanvasElement
  renderer: LightRenderer | null
}

export interface RenderedPixels {
  width: number
  height: number
  data: Uint8Array<ArrayBuffer>
}

export interface LightCanvasOptions {
  /** The element that holds the render canvas. */
  host: RefObject<HTMLDivElement | null>
  /** Nothing renders while this is null. */
  scene: Scene | null
  width: number
  height: number
  supersample: 1 | 2
  canvasClass: string
  /** Called after each successful render. */
  onRendered?: () => void
}

export interface LightCanvas {
  /** Message of the last failed render; null after a good one. */
  error: string | null
  /** RGBA pixels of the last render, top row first. */
  readPixels: () => RenderedPixels | null
}

function createCanvas(className: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.className = className
  return canvas
}

/**
 * Renders `scene` on a canvas placed inside `host`, at most once per
 * animation frame. Every mount gets a new canvas: dispose() loses the WebGL
 * context, and a canvas keeps its lost context for good.
 */
export function useLightCanvas({ host, scene, width, height, supersample, canvasClass, onRendered }: LightCanvasOptions): LightCanvas {
  const surface = useRef<Surface | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rendered = useEffectEvent(() => onRendered?.())

  useEffect(() => {
    const element = host.current
    if (!element) return
    const current: Surface = { canvas: createCanvas(canvasClass), renderer: null }
    element.appendChild(current.canvas)
    surface.current = current
    return () => {
      current.renderer?.dispose()
      current.canvas.remove()
      surface.current = null
    }
  }, [host, canvasClass])

  useEffect(() => {
    if (!scene) return
    const frame = requestAnimationFrame(() => {
      const current = surface.current
      if (!current) return
      try {
        if (current.renderer?.gpu.isLost) {
          current.renderer.dispose()
          current.renderer = null
          const fresh = createCanvas(canvasClass)
          current.canvas.replaceWith(fresh)
          current.canvas = fresh
        }
        current.renderer ??= new LightRenderer(current.canvas)
        current.renderer.render(scene, { width, height, supersample, present: true })
        setError(null)
        rendered()
      } catch (cause) {
        setError(errorMessage(cause))
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [scene, width, height, supersample, canvasClass])

  const readPixels = useCallback((): RenderedPixels | null => {
    const renderer = surface.current?.renderer
    if (!renderer || renderer.width === 0) return null
    return { width: renderer.width, height: renderer.height, data: renderer.readPixels() }
  }, [])

  return { error, readPixels }
}

export interface Flash {
  /** The flashed text while `key` is flashing, else `idle`. */
  label: (key: string, idle: string) => string
  show: (key: string, text: string) => void
}

/** Short-lived button text ("Saved", an error message) that reverts after `duration` ms. */
export function useFlash(duration = 1500): Flash {
  const [flash, setFlash] = useState<{ key: string; text: string } | null>(null)

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), duration)
    return () => window.clearTimeout(timer)
  }, [flash, duration])

  return {
    label: (key, idle) => (flash?.key === key ? flash.text : idle),
    show: (key, text) => setFlash({ key, text }),
  }
}
