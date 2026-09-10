'use client'
import { create } from 'zustand'
import type { BrushMode } from '@/core/lab/gradients/deformation'

type BrushUI = { enabled: boolean; mode: BrushMode; radius: number; strength: number; set: (patch: Partial<Omit<BrushUI, 'set'>>) => void }
export const useGradientBrush = create<BrushUI>((set) => ({
  enabled: false, mode: 'push', radius: 0.24, strength: 0.65,
  set: (patch) => set(patch),
}))
