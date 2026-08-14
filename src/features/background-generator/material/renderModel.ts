import type { PresetConfig } from 'shaders/js'
import { META_SYMBOL_PATH } from '@/core/metaSymbol'
import {
  materialBaseColor,
  materialHighlightColor,
  subjectTransformFor,
  type BackgroundRecipeV2,
} from '@/features/background-generator/recipe'
import { STAINLESS_STEEL_PRESET } from './stainlessSteel'

export const META_SHAPE = JSON.stringify({ type: 'svg', svgUrl: '/icon-fill.svg' })
export const META_SDF = '/meta-symbol.sdf.bin'
export const META_PATH = META_SYMBOL_PATH

const STAINLESS_CONTROL_BASELINE = {
  intensity: 0.65,
  light: 0.5,
  depth: 0.35,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360
}

export function materialRenderModel(recipe: BackgroundRecipeV2) {
  const material = recipe.material
  const transform = subjectTransformFor(recipe, 'material')
  const lightColor = materialHighlightColor(recipe)
  const darkColor = materialBaseColor(recipe)
  const center = {
    x: Math.max(0, Math.min(1, 0.5 + transform.x * 0.5)),
    y: Math.max(0, Math.min(1, 0.5 + transform.y * 0.5)),
  }

  return {
    id: material.id,
    darkColor,
    solid: { color: darkColor },
    metal: {
      center,
      scale: transform.scale,
      rotation: transform.rotation,
      shape: META_SHAPE,
      shapeType: 'svg',
      shapeSdfUrl: META_SDF,
      lightColor,
      darkColor,
      turbulence: material.id === 'liquid' ? 1.2 : 0.35,
      ripple: material.id === 'liquid' ? 5 : 2,
      warp: material.id === 'liquid' ? 1.2 : 0.25,
      sharpness: material.id === 'metal' ? 0.9 : 0.55,
      environment: 0.5 + material.intensity * 1.5,
      envRotation: material.light * 360,
      dispersion: material.depth * 0.35,
      speed: 0,
      opacity: 1,
    },
    stainlessSteel: {
      background: {
        ...STAINLESS_STEEL_PRESET.source.studioBackground,
        color: darkColor,
      },
      glass: {
        ...STAINLESS_STEEL_PRESET.source.glass,
        center,
        scale: transform.scale,
        rotation: transform.rotation,
        shapeSdfUrl: META_SDF,
        highlight: clamp(
          STAINLESS_STEEL_PRESET.source.glass.highlight
            + (material.intensity - STAINLESS_CONTROL_BASELINE.intensity) * 0.6,
          0,
          2,
        ),
        thickness: clamp(
          STAINLESS_STEEL_PRESET.source.glass.thickness
            + (material.depth - STAINLESS_CONTROL_BASELINE.depth) * 1.2,
          0.1,
          1,
        ),
        lightAngle: wrapDegrees(
          300 + (material.light - STAINLESS_CONTROL_BASELINE.light) * 360,
        ),
        highlightColor: lightColor,
        fresnelColor: lightColor,
        opacity: 1,
      },
      swirl: {
        ...STAINLESS_STEEL_PRESET.source.swirl,
        colorA: darkColor,
        colorB: lightColor,
      },
      grain: {
        ...STAINLESS_STEEL_PRESET.source.filmGrain,
      },
    },
    glass: {
      center,
      scale: transform.scale,
      rotation: transform.rotation,
      shape: META_SHAPE,
      shapeType: 'svg',
      shapeSdfUrl: META_SDF,
      refraction: 0.35 + material.intensity,
      blur: material.depth * 8,
      thickness: material.depth,
      highlight: material.intensity,
      lightAngle: material.light * 360,
      tintColor: lightColor,
      tintIntensity: material.intensity * 0.3,
    },
    film: {
      strength: 0.25 + material.intensity * 0.75,
      halation: material.light * 0.7,
      halationRadius: 8 + material.depth * 48,
      weave: 0,
    },
    grain: {
      strength: material.intensity,
      bias: material.depth * 5,
      animated: false,
    },
    pixel: {
      scale: Math.round(18 + (1 - material.depth) * 96),
      gap: material.intensity * 0.25,
      roundness: material.light,
    },
    crt: {
      pixelSize: 48 + material.depth * 160,
      colorShift: material.intensity * 2,
      scanlineIntensity: material.intensity,
      scanlineFrequency: 120 + material.depth * 360,
      brightness: 0.8 + material.light * 0.5,
      contrast: 0.9 + material.intensity * 0.6,
      vignetteIntensity: material.depth,
      vignetteRadius: 0.35 + material.depth * 0.45,
    },
  }
}

export function materialPresetFor(recipe: BackgroundRecipeV2): PresetConfig | null {
  const model = materialRenderModel(recipe)
  if (model.id === 'clean') return null

  if (model.id === 'metal') {
    return {
      components: [
        {
          type: 'StudioBackground',
          id: 'stainless-steel-background',
          props: model.stainlessSteel.background,
        },
        {
          type: 'Glass',
          id: 'stainless-steel-glass',
          props: model.stainlessSteel.glass,
          children: [{
            type: 'Swirl',
            id: 'stainless-steel-swirl',
            props: model.stainlessSteel.swirl,
          }],
        },
        {
          type: 'FilmGrain',
          id: 'stainless-steel-film-grain',
          props: model.stainlessSteel.grain,
        },
      ],
    }
  }

  const source = [
    { type: 'SolidColor', id: 'material-background', props: model.solid },
    { type: 'LiquidMetal', id: 'material-metal', props: model.metal },
  ]
  if (model.id === 'glass') {
    return {
      components: [
        { type: 'SolidColor', id: 'material-background', props: model.solid },
        { type: 'Glass', id: 'material-glass', props: model.glass },
      ],
    }
  }
  if (model.id === 'film') {
    return {
      components: [{
        type: 'FilmStock',
        id: 'material-film',
        props: model.film,
        children: [{
          type: 'FilmGrain',
          id: 'material-grain',
          props: model.grain,
          children: source,
        }],
      }],
    }
  }
  if (model.id === 'pixel') {
    return {
      components: [{
        type: 'Pixelate',
        id: 'material-pixel',
        props: model.pixel,
        children: source,
      }],
    }
  }
  if (model.id === 'crt') {
    return {
      components: [{
        type: 'CRTScreen',
        id: 'material-crt',
        props: model.crt,
        children: source,
      }],
    }
  }
  return { components: source }
}
