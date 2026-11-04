// Which rows a scrolled viewport shows. Rows have one height, so the window is arithmetic; the
// header and footer stay in view (sticky), so they cover part of the viewport.

export type ViewportBox = {
  scrollTop: number
  /** The viewport's inner height. */
  height: number
  /** The sticky header's height: the body starts below it. */
  header: number
  /** The sticky footer's height, covering the bottom of the viewport. */
  footer: number
  rowHeight: number
}

/** The rows to draw: [start, end), with `overscan` rows either side so scrolling stays drawn. */
export const visibleRows = (
  box: ViewportBox,
  count: number,
  overscan = 6,
): { start: number; end: number } => {
  if (count <= 0 || box.rowHeight <= 0) return { start: 0, end: 0 }
  const top = Math.max(0, box.scrollTop)
  const visible = Math.max(box.rowHeight, box.height - box.header - box.footer)
  const start = Math.max(0, Math.floor(top / box.rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((top + visible) / box.rowHeight) + overscan)
  return { start, end: Math.max(start, end) }
}

/** The scroll position that brings a row fully into view, or null when it is already. */
export const revealRow = (box: ViewportBox, index: number): number | null => {
  const rowTop = index * box.rowHeight
  const rowBottom = rowTop + box.rowHeight
  const visible = Math.max(box.rowHeight, box.height - box.header - box.footer)
  if (rowTop < box.scrollTop) return rowTop
  if (rowBottom > box.scrollTop + visible) return rowBottom - visible
  return null
}

/** How many rows one Page Up/Down moves. */
export const pageRows = (box: ViewportBox): number =>
  Math.max(1, Math.floor((box.height - box.header - box.footer) / Math.max(1, box.rowHeight)) - 1)
