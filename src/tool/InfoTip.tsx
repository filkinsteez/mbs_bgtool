import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent, type Ref } from 'react'
import { createPortal } from 'react-dom'

/** Space between the tip and the icon, which its pointer crosses. */
const GAP = 8
/** How far the tip beside the icon reaches below the icon: little enough to stay above the row under the icon. */
const DROP = 2
/** The tip's widest (tool.css `.tool-info-tip`). */
const TIP_WIDTH = 232
/** The least room the tip keeps from the window's edge. */
const EDGE = 8
/** How long the tip stays after the pointer leaves it, the icon and the way between them. */
const CLOSE_MS = 150

export type TipSide = 'beside' | 'below'

export interface TipPlace {
  side: TipSide
  style: CSSProperties
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Where the tip opens, next to the icon (owner, 2026-11-13: "can you float the tool tip closer to the actual i?"): just
 * left of it on its row, pointing at it, its bottom just under the icon's, so it grows upward and covers nothing under
 * the icon (the pack strips); under the icon when the window has no room on its left.
 */
export function placeTip(icon: Box, windowWidth: number): TipPlace {
  if (icon.left - GAP - TIP_WIDTH >= EDGE) return { side: 'beside', style: { top: icon.bottom + DROP, left: icon.left - GAP } }
  return { side: 'below', style: { top: icon.bottom + GAP, right: windowWidth - icon.right } }
}

/** The way between the icon and the tip, which keeps the tip open while the pointer crosses it. */
export function tipPath(side: TipSide, icon: Box, tip: Box): Box {
  switch (side) {
    case 'beside':
      return { left: tip.right, top: icon.top - 4, right: icon.right, bottom: icon.bottom + 4 }
    case 'below':
      return { left: icon.left - 4, top: icon.top, right: icon.right + 4, bottom: tip.top }
    default: {
      const unknown: never = side
      return unknown
    }
  }
}

const inside = (box: Box, x: number, y: number) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom

const subscribeNothing = () => () => {}

interface TipBubbleProps {
  id: string
  textId: string
  text: string
  href: string
  place: TipPlace | null
  open: boolean
  ref?: Ref<HTMLDivElement>
  linkRef?: Ref<HTMLAnchorElement>
  onPointerEnter?: (event: PointerEvent<HTMLDivElement>) => void
  onLinkKeyDown?: (event: KeyboardEvent<HTMLAnchorElement>) => void
  onLinkBlur?: (event: FocusEvent<HTMLAnchorElement>) => void
}

/** The tip: its text, which links to the documentation when there is one. */
export function TipBubble({ id, textId, text, href, place, open, ref, linkRef, onPointerEnter, onLinkKeyDown, onLinkBlur }: TipBubbleProps) {
  return (
    <div ref={ref} id={id} role="tooltip" className="tool-info-tip" data-side={place?.side} style={place?.style} hidden={!open} onPointerEnter={onPointerEnter}>
      <p id={textId}>
        {href === '' ? (
          text
        ) : (
          <a ref={linkRef} className="tool-info-link" href={href} target="_blank" rel="noreferrer" onKeyDown={onLinkKeyDown} onBlur={onLinkBlur}>
            {text}
          </a>
        )}
      </p>
    </div>
  )
}

/**
 * An "i in a circle" that shows `text` in a tip on hover and on keyboard focus, and on a tap on touch screens; Enter or
 * Space on the focused icon closes and opens it again. Escape, leaving it or moving focus away closes the tip. With
 * `href` the tip's text is a link, which the pointer and Tab both reach.
 */
export function InfoTip({ label, text, href }: { label: string; text: string; href: string }) {
  const id = useId()
  const textId = `${id}-text`
  const client = useSyncExternalStore(subscribeNothing, () => true, () => false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<HTMLAnchorElement>(null)
  const closeTimer = useRef<number | null>(null)
  const pointerType = useRef('')
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [place, setPlace] = useState<TipPlace | null>(null)
  const open = (hovered || focused || pinned) && place !== null

  const findPlace = () => {
    const button = buttonRef.current
    if (!button) return null
    return placeTip(button.getBoundingClientRect(), window.innerWidth)
  }
  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const closeAll = () => {
    cancelClose()
    setHovered(false)
    setFocused(false)
    setPinned(false)
  }
  const focusAfterButton = () => {
    const tabbable = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter(
      (element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0 && !tipRef.current?.contains(element),
    )
    const button = buttonRef.current
    tabbable[button ? tabbable.indexOf(button) + 1 : -1]?.focus()
  }

  useEffect(() => {
    if (!open) return
    const closeSoon = () => {
      if (closeTimer.current !== null) return
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null
        setHovered(false)
      }, CLOSE_MS)
    }
    const onMove = (event: globalThis.PointerEvent) => {
      if (!hovered || event.pointerType === 'touch') return
      const button = buttonRef.current?.getBoundingClientRect()
      const tip = tipRef.current?.getBoundingClientRect()
      if (!button || !tip || !place) return
      const near = inside(button, event.clientX, event.clientY) || inside(tip, event.clientX, event.clientY) || inside(tipPath(place.side, button, tip), event.clientX, event.clientY)
      if (near) cancelClose()
      else closeSoon()
    }
    const onOut = (event: globalThis.PointerEvent) => {
      if (hovered && event.relatedTarget === null) closeSoon()
    }
    const onDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node
      if (pinned && !buttonRef.current?.contains(target) && !tipRef.current?.contains(target)) setPinned(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeAll()
    }
    const onLayout = () => setPlace(findPlace())
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onLayout)
    window.addEventListener('scroll', onLayout, true)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onLayout)
      window.removeEventListener('scroll', onLayout, true)
    }
  })

  function handleButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeAll()
    } else if (event.key === 'Tab' && !event.shiftKey && open && linkRef.current) {
      event.preventDefault()
      linkRef.current.focus()
    }
  }

  function handleLinkKey(event: KeyboardEvent<HTMLAnchorElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAll()
      buttonRef.current?.focus()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      if (event.shiftKey) buttonRef.current?.focus()
      else {
        closeAll()
        focusAfterButton()
      }
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="tool-info"
        aria-label={label}
        aria-describedby={textId}
        onPointerEnter={(event) => {
          if (event.pointerType === 'touch') return
          cancelClose()
          setPlace(findPlace())
          setHovered(true)
        }}
        onPointerDown={(event) => void (pointerType.current = event.pointerType)}
        onClick={(event) => {
          if (pointerType.current === 'touch') {
            setPlace(findPlace())
            setPinned((was) => !was)
          } else if (event.detail === 0) {
            setPlace(findPlace())
            setFocused((was) => !was)
          }
          pointerType.current = ''
        }}
        onFocus={(event) => {
          if (!event.currentTarget.matches(':focus-visible')) return
          setPlace(findPlace())
          setFocused(true)
        }}
        onBlur={(event) => {
          if (!tipRef.current?.contains(event.relatedTarget as Node | null)) setFocused(false)
        }}
        onKeyDown={handleButtonKey}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" />
          <path d="M10 9v5" />
          <circle className="tool-info-dot" cx="10" cy="6.25" r="1" />
        </svg>
      </button>
      {client &&
        createPortal(
          <TipBubble
            ref={tipRef}
            linkRef={linkRef}
            id={`${id}-tip`}
            textId={textId}
            text={text}
            href={href}
            place={place}
            open={open}
            onPointerEnter={(event) => {
              if (event.pointerType === 'touch') return
              cancelClose()
              setHovered(true)
            }}
            onLinkKeyDown={handleLinkKey}
            onLinkBlur={(event) => {
              if (event.relatedTarget !== buttonRef.current) setFocused(false)
            }}
          />,
          document.body,
        )}
    </>
  )
}
