export type LookId = 'diffusion' | 'halo' | 'flow' | 'smear'

export type GradientLook = {
  id: LookId
  label: string
}

export const GRADIENT_LOOKS: readonly GradientLook[] = [
  { id: 'diffusion', label: 'Diffusion' },
  { id: 'halo', label: 'Halo' },
  { id: 'flow', label: 'Flow' },
  { id: 'smear', label: 'Smear' },
]

export const GRADIENT_IDS = new Set<LookId>(
  GRADIENT_LOOKS.map((look) => look.id),
)
