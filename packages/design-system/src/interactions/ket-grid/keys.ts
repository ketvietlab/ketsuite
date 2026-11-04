// What a key means to the grid, decided apart from the DOM so the keyboard contract is testable.
// Positions are view coordinates: `row` -1 is the header, `col` counts the data columns.

export type GridPoint = { row: number; col: number }
export type GridRect = { top: number; left: number; bottom: number; right: number }

export type GridKey = {
  key: string
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  isComposing?: boolean
}

export type GridCommand =
  | { type: 'move'; rows: number; cols: number; extend: boolean }
  | { type: 'edge'; rows: -1 | 0 | 1; cols: -1 | 0 | 1; extend: boolean }
  | { type: 'page'; direction: -1 | 1; extend: boolean }
  | { type: 'tab'; backwards: boolean }
  | { type: 'edit' }
  | { type: 'type' }
  | { type: 'toggle' }
  | { type: 'clear' }
  | { type: 'selectAll' }
  | { type: 'fillDown' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'moveRows'; direction: -1 | 1 }
  | { type: 'insertRow' }
  | { type: 'removeRows' }
  | { type: 'collapse' }

const arrows: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

/** The command for a key pressed on a cell that is not being edited, or null to let it through. */
export const gridCommand = (event: GridKey): GridCommand | null => {
  if (event.isComposing) return null
  const mod = event.ctrlKey === true || event.metaKey === true
  const shift = event.shiftKey === true
  const alt = event.altKey === true
  const arrow = arrows[event.key]
  if (arrow) {
    if (alt && !mod && arrow[1] === 0) return { type: 'moveRows', direction: arrow[0] as -1 | 1 }
    if (alt) return null
    if (mod)
      return { type: 'edge', rows: arrow[0] as -1 | 0 | 1, cols: arrow[1] as -1 | 0 | 1, extend: shift }
    return { type: 'move', rows: arrow[0], cols: arrow[1], extend: shift }
  }
  switch (event.key) {
    case 'Home':
      return mod
        ? { type: 'edge', rows: -1, cols: -1, extend: shift }
        : { type: 'edge', rows: 0, cols: -1, extend: shift }
    case 'End':
      return mod
        ? { type: 'edge', rows: 1, cols: 1, extend: shift }
        : { type: 'edge', rows: 0, cols: 1, extend: shift }
    case 'PageUp':
      return { type: 'page', direction: -1, extend: shift }
    case 'PageDown':
      return { type: 'page', direction: 1, extend: shift }
    case 'Tab':
      return mod || alt ? null : { type: 'tab', backwards: shift }
    case 'Enter':
      if (mod) return { type: 'insertRow' }
      return shift || alt ? null : { type: 'edit' }
    case 'F2':
      return { type: 'edit' }
    case 'Escape':
      return { type: 'collapse' }
    case 'Delete':
    case 'Backspace':
      if (mod) return { type: 'removeRows' }
      return alt ? null : { type: 'clear' }
    case ' ':
      return mod || alt ? null : { type: 'toggle' }
    case 'Process':
      return { type: 'type' }
  }
  if (mod && !alt) {
    const key = event.key.toLowerCase()
    if (key === 'a') return { type: 'selectAll' }
    if (key === 'd') return { type: 'fillDown' }
    if (key === 'z') return shift ? { type: 'redo' } : { type: 'undo' }
    if (key === 'y') return { type: 'redo' }
    return null
  }
  // A printable character starts editing; the browser then types it into the editor.
  if (event.key.length === 1) return { type: 'type' }
  return null
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/** Moves a point and keeps it on the grid; the header row is reachable only when there is one. */
export const movePoint = (
  point: GridPoint,
  rows: number,
  cols: number,
  bounds: { rows: number; cols: number; header: boolean },
): GridPoint => ({
  row: clamp(point.row + rows, bounds.header ? -1 : 0, Math.max(bounds.header ? -1 : 0, bounds.rows - 1)),
  col: clamp(point.col + cols, 0, Math.max(0, bounds.cols - 1)),
})

export const edgePoint = (
  point: GridPoint,
  rows: -1 | 0 | 1,
  cols: -1 | 0 | 1,
  bounds: { rows: number; cols: number },
): GridPoint => ({
  row: rows === 0 ? point.row : rows < 0 ? 0 : Math.max(0, bounds.rows - 1),
  col: cols === 0 ? point.col : cols < 0 ? 0 : Math.max(0, bounds.cols - 1),
})

export const rectOf = (a: GridPoint, b: GridPoint): GridRect => ({
  top: Math.min(a.row, b.row),
  left: Math.min(a.col, b.col),
  bottom: Math.max(a.row, b.row),
  right: Math.max(a.col, b.col),
})

export const inRect = (rect: GridRect, row: number, col: number): boolean =>
  row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right

/**
 * The next cell Tab reaches: the next editable cell in reading order, or null at the end of the
 * grid so Tab leaves it. `editable` answers for one cell.
 */
export const tabTarget = (
  point: GridPoint,
  backwards: boolean,
  bounds: { rows: number; cols: number },
  editable: (row: number, col: number) => boolean,
): GridPoint | null => {
  const total = bounds.rows * bounds.cols
  let index = Math.max(0, point.row) * bounds.cols + point.col
  for (let step = 0; step < total; step += 1) {
    index += backwards ? -1 : 1
    if (index < 0 || index >= total) return null
    const row = Math.floor(index / bounds.cols)
    const col = index % bounds.cols
    if (editable(row, col)) return { row, col }
  }
  return null
}
