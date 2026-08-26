'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ApprovedColorPicker } from './ApprovedColorPicker'

type ApprovedColorPopoverProps = {
  anchor: HTMLElement
  title: string
  selectedColor: string
  onSelect: (color: string) => void
  onClose: () => void
}

export function ApprovedColorPopover({
  anchor,
  title,
  selectedColor,
  onSelect,
  onClose,
}: ApprovedColorPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(344, window.innerWidth - 24)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  const roomBelow = window.innerHeight - rect.bottom - 12
  const openBelow = roomBelow >= Math.min(420, rect.top - 12)
  const position = openBelow
    ? {
        top: rect.bottom + 8,
        maxHeight: Math.max(220, roomBelow - 8),
      }
    : {
        bottom: window.innerHeight - rect.top + 8,
        maxHeight: Math.max(220, rect.top - 20),
      }

  useEffect(() => {
    popoverRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    const closeForOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      anchor.focus({ preventScroll: true })
      onClose()
    }
    const closeForResize = () => onClose()
    document.addEventListener('pointerdown', closeForOutsidePointer, true)
    document.addEventListener('keydown', closeForEscape)
    window.addEventListener('resize', closeForResize)
    return () => {
      document.removeEventListener('pointerdown', closeForOutsidePointer, true)
      document.removeEventListener('keydown', closeForEscape)
      window.removeEventListener('resize', closeForResize)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={popoverRef}
      className="lab-color-popover"
      role="dialog"
      aria-label={title}
      style={{ left, width, ...position }}
    >
      <div className="lab-color-popover-header">
        <h3>{title}</h3>
        <button
          type="button"
          className="lab-icon-button"
          aria-label="Close color picker"
          onClick={() => {
            anchor.focus({ preventScroll: true })
            onClose()
          }}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <ApprovedColorPicker
        selected={[selectedColor]}
        action="Use"
        onSelect={(color) => {
          onSelect(color)
          anchor.focus({ preventScroll: true })
          onClose()
        }}
      />
    </div>,
    document.body,
  )
}
