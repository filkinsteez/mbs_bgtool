import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const MATERIAL_MODEL_MERGE_TOLERANCE = 1e-6

export function prepareMaterialGeometry(
  source: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const geometry = mergeVertices(source, MATERIAL_MODEL_MERGE_TOLERANCE)
  geometry.computeTangents()
  return geometry
}

export function createMaterialSurface(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ dithering: true })
}
