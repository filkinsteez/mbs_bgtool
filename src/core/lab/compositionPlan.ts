import { chan, chanGauss } from '@/core/organic/random'

export type CompositionArchetype = 'full' | 'lobe' | 'crossover' | 'sweep'
export type EdgePolicy = 'contained' | 'cross-two' | 'corner-crop' | 'bleed'

export type CompositionAnchor = {
  x: number
  y: number
  radius: number
  strength: number
  angle: number
}

export type QuietShape = {
  x: number
  y: number
  radiusX: number
  radiusY: number
  rotation: number
  softness: number
}

export type CompositionPlan = {
  revision: 1
  archetype: CompositionArchetype
  edgePolicy: EdgePolicy
  latents: {
    energy: number
    openness: number
    directionality: number
    mutation: number
  }
  anchors: readonly CompositionAnchor[]
  quietShapes: readonly QuietShape[]
  scales: {
    macro: number
    meso: number
    motif: number
    micro: number
  }
  rhythm: {
    steps: number
    pulses: number
    phase: number
    swing: number
    pattern: readonly boolean[]
  }
  field: {
    angle: number
    phase: number
    frequencyA: number
    frequencyB: number
    warp: number
  }
}

export type CompositionSample = {
  focus: number
  quiet: number
  wave: number
  pulse: boolean
}

const TAU = Math.PI * 2

const LOOK_ARCHETYPES: Record<string, readonly CompositionArchetype[]> = {
  frame: ['full', 'crossover', 'lobe'],
  pixels: ['full', 'lobe', 'sweep'],
  scanlines: ['sweep', 'crossover', 'lobe'],
  streams: ['sweep', 'crossover', 'full'],
  brushwork: ['sweep', 'lobe', 'crossover'],
  beads: ['full', 'lobe', 'sweep'],
  quilt: ['full', 'lobe', 'sweep'],
  weave: ['sweep', 'full', 'crossover'],
  marks: ['lobe', 'crossover', 'sweep'],
  trails: ['sweep', 'crossover', 'lobe'],
}

const LOOK_EDGE_POLICIES: Record<string, readonly EdgePolicy[]> = {
  frame: ['contained', 'cross-two'],
  pixels: ['bleed', 'cross-two'],
  scanlines: ['bleed', 'cross-two'],
  streams: ['bleed', 'cross-two'],
  brushwork: ['cross-two', 'corner-crop'],
  beads: ['contained', 'bleed'],
  quilt: ['bleed', 'corner-crop'],
  weave: ['bleed', 'cross-two'],
  marks: ['contained', 'corner-crop'],
  trails: ['cross-two', 'bleed'],
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function pick<T>(values: readonly T[], sample: number): T {
  return values[Math.min(values.length - 1, Math.floor(sample * values.length))]
}

function euclideanRhythm(steps: number, pulses: number, rotation: number): boolean[] {
  const pattern = Array.from({ length: steps }, (_, index) =>
    ((index * pulses) % steps) < pulses)
  const offset = ((rotation % steps) + steps) % steps
  return pattern.map((_, index) => pattern[(index - offset + steps) % steps])
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function sampleCompositionPlan(
  plan: CompositionPlan,
  x: number,
  y: number,
  width: number,
  height: number,
): CompositionSample {
  const u = x / Math.max(1, width)
  const v = y / Math.max(1, height)
  let focus = 0
  for (const anchor of plan.anchors) {
    const dx = u - anchor.x
    const dy = v - anchor.y
    const distance = Math.hypot(dx, dy) / Math.max(0.01, anchor.radius)
    focus = Math.max(focus, Math.exp(-distance * distance * 1.6) * anchor.strength)
  }

  let quiet = 0
  for (const shape of plan.quietShapes) {
    const cos = Math.cos(shape.rotation)
    const sin = Math.sin(shape.rotation)
    const dx = u - shape.x
    const dy = v - shape.y
    const localX = (dx * cos + dy * sin) / Math.max(0.01, shape.radiusX)
    const localY = (-dx * sin + dy * cos) / Math.max(0.01, shape.radiusY)
    const distance = Math.hypot(localX, localY)
    quiet = Math.max(
      quiet,
      1 - smoothstep(1 - shape.softness, 1 + shape.softness, distance),
    )
  }

  const directionX = Math.cos(plan.field.angle)
  const directionY = Math.sin(plan.field.angle)
  const along = (u - 0.5) * directionX + (v - 0.5) * directionY
  const across = -(u - 0.5) * directionY + (v - 0.5) * directionX
  const phase = along * plan.field.frequencyA + across * plan.field.frequencyB
  const wave = (
    Math.sin(phase * TAU + plan.field.phase)
    + Math.sin((phase * 0.47 - across * 0.83) * TAU - plan.field.phase * 0.62) * 0.45
  ) / 1.45
  const step = Math.floor(
    ((phase + plan.rhythm.swing * Math.sin(across * TAU) + 16) % 1)
    * plan.rhythm.steps,
  )

  return {
    focus: clamp01(focus),
    quiet: clamp01(quiet),
    wave,
    pulse: plan.rhythm.pattern[step] ?? false,
  }
}

export function artDirectTerritory(
  plan: CompositionPlan,
  source: (x: number, y: number) => number,
  width: number,
  height: number,
): (x: number, y: number) => number {
  const rawWeight = plan.archetype === 'full'
    ? 0.86
    : plan.archetype === 'crossover'
      ? 0.78
      : plan.archetype === 'lobe'
        ? 0.72
        : 0.68
  return (x, y) => {
    const sample = sampleCompositionPlan(plan, x, y, width, height)
    const focalLift = sample.focus * (1 - rawWeight) * 0.95
    const directionalLift = sample.wave * plan.field.warp * 0.12
    const rhythmLift = sample.pulse ? 0.035 * plan.latents.energy : -0.02
    const quietCarve = sample.quiet * (0.18 + plan.latents.openness * 0.2)
    return clamp01(source(x, y) * rawWeight + focalLift + directionalLift + rhythmLift - quietCarve)
  }
}

export function resolveCompositionPlan(input: {
  seed: number
  lookId: string
  complexity: number
  aspect: number
}): CompositionPlan {
  const { seed, lookId } = input
  const complexity = clamp01(input.complexity)
  const aspectBias = Math.max(-1, Math.min(1, Math.log2(Math.max(0.25, input.aspect))))
  const energy = clamp01(0.5 + chanGauss(seed, 0, 'plan.energy') * 0.32)
  const openness = clamp01(0.48 + chanGauss(seed, 0, 'plan.openness') * 0.3)
  const directionality = clamp01(0.54 + chanGauss(seed, 0, 'plan.direction') * 0.34)
  const mutation = clamp01(0.42 + chanGauss(seed, 0, 'plan.mutation') * 0.3)
  const archetypes = LOOK_ARCHETYPES[lookId] ?? ['full', 'lobe', 'sweep']
  const edgePolicies = LOOK_EDGE_POLICIES[lookId] ?? ['contained', 'cross-two']
  const archetype = pick(archetypes, chan(seed, 0, `plan.${lookId}.archetype`))
  const edgePolicy = pick(edgePolicies, chan(seed, 0, `plan.${lookId}.edge`))
  const baseAngle = (
    chan(seed, 0, `plan.${lookId}.angle`) * 0.72
    + (aspectBias + 1) * 0.14
  ) * TAU

  const primary: CompositionAnchor = {
    x: 0.5 + Math.cos(baseAngle) * (0.12 + 0.12 * openness),
    y: 0.5 + Math.sin(baseAngle) * (0.1 + 0.1 * openness),
    radius: 0.2 + 0.14 * (1 - energy),
    strength: 0.78 + energy * 0.22,
    angle: baseAngle,
  }
  const secondaryCount = complexity > 0.66 ? 2 : 1
  const anchors: CompositionAnchor[] = [primary]
  for (let index = 0; index < secondaryCount; index += 1) {
    const angle = baseAngle + Math.PI * (0.72 + index * 0.46)
      + chanGauss(seed, index, `plan.${lookId}.anchor.angle`) * 0.45
    anchors.push({
      x: 0.5 + Math.cos(angle) * (0.24 + 0.14 * chan(seed, index, 'plan.anchor.x')),
      y: 0.5 + Math.sin(angle) * (0.18 + 0.12 * chan(seed, index, 'plan.anchor.y')),
      radius: 0.12 + 0.1 * chan(seed, index, 'plan.anchor.radius'),
      strength: 0.38 + 0.3 * chan(seed, index, 'plan.anchor.strength'),
      angle,
    })
  }

  const quietCount = openness > 0.62 && complexity > 0.45 ? 2 : 1
  const quietShapes: QuietShape[] = []
  for (let index = 0; index < quietCount; index += 1) {
    const angle = baseAngle + Math.PI * (0.5 + index * 0.55)
    const distance = 0.2 + openness * 0.16
    quietShapes.push({
      x: 0.5 + Math.cos(angle) * distance,
      y: 0.5 + Math.sin(angle) * distance,
      radiusX: 0.12 + openness * 0.16,
      radiusY: 0.09 + openness * 0.12,
      rotation: baseAngle + Math.PI / 2,
      softness: 0.18 + (1 - energy) * 0.22,
    })
  }

  const steps = 5 + Math.floor(chan(seed, 0, `plan.${lookId}.rhythm.steps`) * 9)
  const pulses = Math.max(2, Math.min(
    steps - 1,
    Math.round(2 + energy * (steps - 4) + complexity * 2),
  ))
  const rhythmPhase = Math.floor(chan(seed, 0, `plan.${lookId}.rhythm.phase`) * steps)

  return {
    revision: 1,
    archetype,
    edgePolicy,
    latents: { energy, openness, directionality, mutation },
    anchors,
    quietShapes,
    scales: {
      macro: 0.42 + (1 - energy) * 0.28,
      meso: 0.11 + (1 - complexity) * 0.12,
      motif: 0.025 + (1 - complexity) * 0.045,
      micro: 0.004 + (1 - complexity) * 0.008,
    },
    rhythm: {
      steps,
      pulses,
      phase: rhythmPhase,
      swing: chanGauss(seed, 0, `plan.${lookId}.rhythm.swing`) * 0.16,
      pattern: euclideanRhythm(steps, pulses, rhythmPhase),
    },
    field: {
      angle: baseAngle,
      phase: chan(seed, 0, `plan.${lookId}.field.phase`) * TAU,
      frequencyA: 0.65 + directionality * 1.1,
      frequencyB: 1.4 + mutation * 1.8,
      warp: 0.18 + energy * 0.42,
    },
  }
}
