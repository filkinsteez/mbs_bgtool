'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

// A real modal for destructive confirms — one component for every
// "are you sure", so the answer always arrives the same way.
//
// Keyboard contract, the same as any dialog: Escape cancels, focus
// lands on Cancel and returns to whatever
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
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancelRef.current()
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
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="modal-scrim"
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
          <button
            ref={cancelRef}
            type="button"
            className="ctl-action"
            autoFocus
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
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
