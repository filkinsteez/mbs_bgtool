declare module 'p5.brush/standalone' {
  export const DEGREES: 'degrees'
  export const RADIANS: 'radians'

  export function load(canvas: HTMLCanvasElement | OffscreenCanvas): void
  export function clear(color?: string): void
  export function render(): void
  export function seed(value: number): void
  export function noiseSeed(value: number): void
  export function angleMode(mode: typeof DEGREES | typeof RADIANS): void
  export function push(): void
  export function pop(): void
  export function translate(x: number, y: number): void
  export function rotate(angle: number): void
  export function scale(x: number, y?: number): void
  export function field(name: string): void
  export function noField(): void
  export function refreshField(time: number): void

  export function set(name: string, color: string, weight?: number): void
  export function add(
    name: string,
    options: {
      type?: 'default' | 'marker' | 'custom' | 'spray'
      weight: number
      scatter: number
      sharpness?: number
      grain?: number
      opacity: number
      spacing: number
      pressure:
        | readonly [number, number]
        | readonly [number, number, number]
      rotate?: 'none' | 'natural' | 'random'
      markerTip?: boolean
      noise?: number
    },
  ): void
  export function noStroke(): void
  export function fill(color: string, opacity?: number): void
  export function noFill(): void
  export function fillBleed(
    strength: number,
    direction?: 'out' | 'in',
    angle?: number,
  ): void
  export function fillTexture(
    textureStrength?: number,
    borderIntensity?: number,
    scatter?: boolean,
  ): void
  export function wash(color: string, opacity?: number): void
  export function noWash(): void
  export function noHatch(): void
  export function mass(
    name: string,
    color: string,
    options?: {
      precision?: number
      strength?: number
      gradient?: number
      outline?: boolean
    },
  ): void
  export function noMass(): void
  export function hatchStyle(name: string, color: string, weight?: number): void
  export function hatch(
    distance: number,
    angle: number,
    options?: {
      rand?: number | false
      continuous?: boolean
      gradient?: number | false
    },
  ): void
  export function rect(
    x: number,
    y: number,
    width: number,
    height: number,
    mode?: 'corner' | 'center',
  ): unknown
  export function spline(
    points: readonly (readonly [number, number] | readonly [number, number, number])[],
    curvature?: number,
  ): unknown
  export function flowLine(
    x: number,
    y: number,
    length: number,
    direction: number,
  ): void
  export function polygon(
    points: readonly (readonly [number, number])[],
  ): unknown

  export class Polygon {
    constructor(points: readonly (readonly [number, number])[])
  }

  export function massArray(polygons: readonly Polygon[]): void
}
