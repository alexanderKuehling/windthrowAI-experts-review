// Zoom + pan for the review canvases. The view is pure data, applied as a CSS
// transform on each canvas inside an overflow-hidden viewport, so the pixel
// math in paintAt/updateProbe (which goes through getBoundingClientRect) keeps
// working unchanged at any zoom.

export const MIN_ZOOM = 1
export const MAX_ZOOM = 16

// `zoom`× magnification, with (x, y) the tile point (0–1) shown at the
// viewport's top-left corner. One view is shared by every panel.
export interface ZoomView {
  zoom: number
  x: number
  y: number
}

export const FIT_VIEW: ZoomView = { zoom: 1, x: 0, y: 0 }

// Keep the zoom in range and the tile covering the whole viewport.
function clampView(v: ZoomView): ZoomView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom))
  const max = 1 - 1 / zoom
  return { zoom, x: Math.min(max, Math.max(0, v.x)), y: Math.min(max, Math.max(0, v.y)) }
}

// Zoom by `factor` around the viewport point (ax, ay), both 0–1, so the tile
// pixel under the cursor stays under the cursor.
export function zoomAt(v: ZoomView, factor: number, ax = 0.5, ay = 0.5): ZoomView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
  return clampView({ zoom, x: v.x + ax / v.zoom - ax / zoom, y: v.y + ay / v.zoom - ay / zoom })
}

// Move the view by (dx, dy), in fractions of the viewport.
export function panBy(v: ZoomView, dx: number, dy: number): ZoomView {
  return clampView({ ...v, x: v.x + dx / v.zoom, y: v.y + dy / v.zoom })
}

// Percent translations are of the canvas's own size, which equals the viewport's.
export function viewTransform(v: ZoomView): string | undefined {
  if (v.zoom === 1) return undefined
  return `scale(${v.zoom}) translate(${-v.x * 100}%, ${-v.y * 100}%)`
}
