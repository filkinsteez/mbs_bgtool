'use client'

import '@/styles/dialkit.css'
import '@/styles/dial-panel.css'
import { DialRoot } from 'dialkit'
import { useRef, useState } from 'react'
import { PacksView } from './PacksView'
import { ReferencesView } from './ReferencesView'
import styles from './lab.module.css'

type View = 'references' | 'packs'

export default function LabClient() {
  const [view, setView] = useState<View>('references')
  const panelRoot = useRef<HTMLElement>(null)
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
      <div className={styles.view}>
        {view === 'references' ? <ReferencesView panelRoot={panelRoot} /> : <PacksView panelRoot={panelRoot} />}
        <aside ref={panelRoot} className={`${styles.side} dial-column`}>
          <DialRoot mode="inline" theme="dark" />
        </aside>
      </div>
    </div>
  )
}
