import { COLOR_GLSL } from './color'
import { COMMON_GLSL } from './common'
import { DITHER_GLSL } from './dither'
import { FALLOFF_GLSL } from './falloff'
import { HASH_GLSL } from './hash'
import { NOISE_GLSL } from './noise'
import { SAMPLE_GLSL } from './sample'
import { SDF_GLSL } from './sdf'

export { COLOR_GLSL, COMMON_GLSL, DITHER_GLSL, FALLOFF_GLSL, HASH_GLSL, NOISE_GLSL, SAMPLE_GLSL, SDF_GLSL }

/** Every chunk, in dependency order. The engine prepends this to recipe shaders. */
export const CHUNK_LIBRARY = [
  COMMON_GLSL,
  HASH_GLSL,
  NOISE_GLSL,
  DITHER_GLSL,
  FALLOFF_GLSL,
  SDF_GLSL,
  COLOR_GLSL,
  SAMPLE_GLSL,
].join('\n')

export const GLSL_HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`
