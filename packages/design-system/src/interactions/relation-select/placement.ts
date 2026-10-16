type Box = { left: number; top: number; width: number; height: number }
type Anchor = { left: number; right: number; top: number; bottom: number }
export type RelationMenuPlacementInput = {
  anchor: Anchor
  viewport: Box
  width: number
  height: number
  gap: number
  inset: number
  rtl: boolean
}

/** The relation picker owns its anchor, viewport inset and available scrolling height. */
export const relationMenuPlacement = ({
  anchor,
  viewport,
  width,
  height,
  gap,
  inset,
  rtl,
}: RelationMenuPlacementInput) => {
  const start = Math.ceil(viewport.left + inset)
  const end = Math.floor(viewport.left + viewport.width - inset)
  const topEdge = Math.ceil(viewport.top + inset)
  const bottomEdge = Math.floor(viewport.top + viewport.height - inset)
  const fittedWidth = Math.max(0, Math.min(Math.floor(width), end - start))
  const below = Math.max(0, bottomEdge - Math.round(anchor.bottom + gap))
  const above = Math.max(0, Math.round(anchor.top - gap) - topEdge)
  const opensBelow = height <= below || below >= above
  const maxHeight = opensBelow ? below : above
  return {
    left: Math.max(
      start,
      Math.min(Math.round(rtl ? anchor.right - fittedWidth : anchor.left), end - fittedWidth),
    ),
    top: opensBelow
      ? Math.max(topEdge, Math.round(anchor.bottom + gap))
      : Math.max(topEdge, Math.round(anchor.top - gap - Math.min(height, maxHeight))),
    width: fittedWidth,
    maxHeight,
  }
}
