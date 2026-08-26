import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { resolveBank } from '@/core/lab/markBank'
import type { MarkBankId } from '@/core/lab/types'

const cache = new Map<MarkBankId, ShapeProto[]>()

export function resolveBankCached(id: MarkBankId): ShapeProto[] {
  const cached = cache.get(id)
  if (cached) return cached
  const bank = resolveBank(id)
  cache.set(id, bank)
  return bank
}
