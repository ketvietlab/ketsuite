/** Viewport coordinates in CSS pixels; works with the mobile visual viewport too. */
type Box = { left: number; top: number; right: number; bottom: number }

/** Prefer above the selection, fall below near the top, and keep wrapped controls visible. */
export function floatingToolbarPosition(
  anchor: Box,
  toolbar: { width: number; height: number },
  viewport: Box,
  gap: number,
): { left: number; top: number } {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, Math.max(min, max)))
  const above = anchor.top - toolbar.height - gap
  return {
    left: clamp(
      (anchor.left + anchor.right - toolbar.width) / 2,
      viewport.left + gap,
      viewport.right - toolbar.width - gap,
    ),
    top: clamp(
      above >= viewport.top + gap ? above : anchor.bottom + gap,
      viewport.top + gap,
      viewport.bottom - toolbar.height - gap,
    ),
  }
}
