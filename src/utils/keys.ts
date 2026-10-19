// Shortcut labels in the platform's own notation: ⌘Z on a Mac, Ctrl+Z elsewhere.
// The handlers accept both modifiers everywhere; this is only what we show.
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)
export const UNDO_KEYS = IS_MAC ? "⌘Z" : "Ctrl+Z"
export const REDO_KEYS = IS_MAC ? "⇧⌘Z" : "Ctrl+Y"
export const ZOOM_MOD = IS_MAC ? "⌘" : "Ctrl"

// Keys typed into a text box belong to the box, not to the page's shortcuts.
export function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) return !["range", "checkbox", "radio", "button"].includes(target.type)
  return target instanceof HTMLElement && target.isContentEditable
}
