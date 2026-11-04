/** Presentation adapter only: Stock keeps its existing isStorable/tracking contract. */
export function inventoryTrackingValue(record: { isStorable: boolean; tracking: string }): string {
  if (record.tracking === 'serial') return 'serial'
  return record.isStorable ? (record.tracking === 'lot' ? 'lot' : 'quantity') : 'none'
}

export function inventoryTrackingInput(mode: string): { isStorable: boolean; tracking: string } {
  return { isStorable: mode !== 'none', tracking: mode === 'quantity' || mode === 'none' ? 'none' : mode }
}
