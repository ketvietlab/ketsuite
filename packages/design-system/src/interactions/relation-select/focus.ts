type FocusTarget = { isConnected: boolean; focus(options?: { preventScroll?: boolean }): void }
type ActiveTarget = { isConnected: boolean }
// Preserve a consumer's deliberate focus move. A removed option/body focus
// instead returns to the connected field trigger without moving its scroll.
export const restoreRelationSelectionFocus = <Active extends ActiveTarget>(
  trigger: FocusTarget | null,
  active: Active | null,
  body: Active,
  popup: { contains(target: Active): boolean } | null,
): boolean => {
  if (!trigger?.isConnected) return false
  if (active && active !== body && active.isConnected && !popup?.contains(active)) return false
  trigger.focus({ preventScroll: true })
  return true
}
