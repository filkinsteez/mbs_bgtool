import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createMaterialSurface,
  MATERIAL_MODEL_MERGE_TOLERANCE,
  prepareMaterialGeometry,
} from './materialModelProcessing'

function createSeamedQuad(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ], 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0, 1,
    0, 0,
    1, 0,
    0, 1,
  ], 2))
  return geometry
}

describe('material model processing', () => {
  it('indexes geometry, preserves UV seams, and computes finite tangents', () => {
    const source = createSeamedQuad()
    const geometry = prepareMaterialGeometry(source)

    expect(MATERIAL_MODEL_MERGE_TOLERANCE).toBe(1e-6)
    expect(source.index).toBeNull()
    expect(geometry.index?.count).toBe(6)
    expect(geometry.getAttribute('position').count).toBe(5)
    expect(geometry.getAttribute('normal').count).toBe(5)
    expect(geometry.getAttribute('uv').count).toBe(5)

    const tangents = geometry.getAttribute('tangent')
    expect(tangents.count).toBe(5)
    for (let index = 0; index < tangents.count; index += 1) {
      expect(Number.isFinite(tangents.getX(index))).toBe(true)
      expect(Number.isFinite(tangents.getY(index))).toBe(true)
      expect(Number.isFinite(tangents.getZ(index))).toBe(true)
      expect(Number.isFinite(tangents.getW(index))).toBe(true)
      expect(Math.hypot(
        tangents.getX(index),
        tangents.getY(index),
        tangents.getZ(index),
      )).toBeCloseTo(1, 5)
    }

    source.dispose()
    geometry.dispose()
  })

  it('enables material dithering', () => {
    const surface = createMaterialSurface()

    expect(surface.dithering).toBe(true)

    surface.dispose()
  })
})
