import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureMaterialFrame,
  registerMaterialFrameCapture,
  type MaterialFrameCapture,
} from './materialFrameCapture'

const cleanups: (() => void)[] = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function register(capture: MaterialFrameCapture): () => void {
  const cleanup = registerMaterialFrameCapture(capture)
  cleanups.push(cleanup)
  return cleanup
}

describe('material frame capture registration', () => {
  it('rejects capture before a viewer registers', async () => {
    await expect(captureMaterialFrame(320, 180)).rejects.toThrow('3D view is not ready')
  })

  it('forwards exact output dimensions and capture failures', async () => {
    const frame = {} as HTMLCanvasElement
    const capture = vi.fn().mockResolvedValue(frame)
    register(capture)

    await expect(captureMaterialFrame(3840, 2160)).resolves.toBe(frame)
    expect(capture).toHaveBeenCalledWith(3840, 2160)

    const failure = new Error('capture failed')
    register(vi.fn().mockRejectedValue(failure))
    await expect(captureMaterialFrame(100, 100)).rejects.toBe(failure)
  })

  it('keeps the newest registration when an older viewer unmounts', async () => {
    const firstCleanup = register(vi.fn().mockResolvedValue({ id: 1 } as unknown as HTMLCanvasElement))
    const newest = vi.fn().mockResolvedValue({ id: 2 } as unknown as HTMLCanvasElement)
    register(newest)

    firstCleanup()
    await captureMaterialFrame(10, 20)
    expect(newest).toHaveBeenCalledWith(10, 20)
  })
})
