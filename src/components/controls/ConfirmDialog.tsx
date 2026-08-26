'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

// A real modal for destructive confirms — one component for every
// "are you sure", so the answer always arrives the same way.
//
// Portaled to <body> so no panel's overflow can clip it, and the portal
// host carries `dialkit-root` because the --dial-* tokens are scoped to
// that class (a portal outside it renders unstyled).
//
// Keyboard contract, the same as any dialog: Escape cancels, focus
// lands on the confirm button and returns to whatever
// opened it, and Tab cycles inside the dialog instead of escaping into
// the page behind.

export type ConfirmDialogProps = {
  open: boolean
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      // keep focus inside: the dialog owns the keyboard while it is up
      const focusables = cardRef.current?.querySelectorAll<HTMLElement>('button')
      if (!focusables?.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    // capture: this beats the editor's window-level canvas shortcuts,
    // so Enter/Escape/Delete cannot reach the artboard behind the modal
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [open, onConfirm, onCancel])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="dialkit-root modal-scrim"
      onPointerDown={(e) => {
        // click-outside cancels; presses inside the card do not
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        ref={cardRef}
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
      >
        <h2 className="modal-title" id={titleId}>{title}</h2>
        {body ? <div className="modal-body" id={bodyId}>{body}</div> : null}
        <div className="modal-actions">
          <button type="button" className="ctl-action" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="ctl-action primary"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
