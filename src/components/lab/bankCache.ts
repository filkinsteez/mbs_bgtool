import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { resolveBank } from '@/core/lab/markBank'
import type { LookVersion, MarkBankId } from '@/core/lab/types'

const cache = new Map<string, ShapeProto[]>()

export function resolveBankCached(
  id: MarkBankId,
  version: LookVersion = 'v2',
): ShapeProto[] {
  const key = `${version}:${id}`
  const cached = cache.get(key)
  if (cached) return cached
  const bank = resolveBank(id, version)
  cache.set(key, bank)
  return bank
}
