import type { LookId } from '@/core/lab/looks'

export type LookSystem = 'field' | 'bitmap' | 'press' | 'lattice' | 'flux'

export function lookSystemForId(id: LookId): LookSystem {
  switch (id) {
    case 'frame':
      return 'field'
    case 'pixels':
    case 'scanlines':
      return 'bitmap'
    case 'brushwork':
      return 'press'
    case 'quilt':
    case 'weave':
    case 'beads':
      return 'lattice'
    case 'streams':
    case 'marks':
    case 'trails':
      return 'flux'
    default:
      return 'field'
  }
}

export function systemIndex(system: LookSystem): number {
  switch (system) {
    case 'field':
      return 0
    case 'bitmap':
      return 1
    case 'press':
      return 2
    case 'lattice':
      return 3
    case 'flux':
      return 4
    default:
      return 0
  }
}
