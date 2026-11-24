/** What the toast after Share says. */
export const LINK_COPIED = 'Link copied'
export const LINK_NOT_COPIED = "Couldn't copy link"

/** The link to a tool state: the page's origin and path, then "?" and the state's query (`toQuery`). */
export function shareLink(page: Pick<Location, 'origin' | 'pathname'>, query: string): string {
  return `${page.origin}${page.pathname}?${query}`
}

/** Copies text with the copy command from a text field out of sight, giving focus back after. Whether it copied. */
function copyWithField(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  // Fixed, so selecting it doesn't scroll the page.
  field.style.position = 'fixed'
  field.style.top = '0'
  field.style.left = '0'
  field.style.opacity = '0'
  field.style.pointerEvents = 'none'
  const focused = document.activeElement
  document.body.append(field)
  let copied = false
  try {
    field.select()
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    field.remove()
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
  }
  return copied
}

/**
 * Copies text to the clipboard: with the clipboard API, or where the page has none or it refuses (a page over plain
 * http from another machine, or a browser that blocks it), with the copy command. Whether either copied it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyWithField(text)
  }
}
