'use client'

import { useState } from 'react'
import { PacksView } from './PacksView'
import { ReferencesView } from './ReferencesView'
import styles from './lab.module.css'

type View = 'references' | 'packs'

export default function LabClient() {
  const [view, setView] = useState<View>('references')
  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <button type="button" className={styles.tab} aria-pressed={view === 'references'} onClick={() => setView('references')}>
          References
        </button>
        <button type="button" className={styles.tab} aria-pressed={view === 'packs'} onClick={() => setView('packs')}>
          Packs
        </button>
      </div>
      <ReferencesView active={view === 'references'} />
      <PacksView active={view === 'packs'} />
    </div>
  )
}
