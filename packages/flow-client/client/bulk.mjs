// Batch ok means processing completed. Individual refusals remain selected.
export function normalizeBulkOutcome(value, attempted) {
  const ids = [...new Set(attempted)]
  if (
    value?.ok !== true ||
    !Number.isInteger(value.applied) ||
    value.applied < 0 ||
    !Array.isArray(value.refused)
  )
    return null
  const refused = value.refused
  if (
    refused.some((r) => !r || !ids.includes(r.id) || typeof r.code !== 'string' || !r.code) ||
    new Set(refused.map((r) => r.id)).size !== refused.length ||
    value.applied + refused.length !== ids.length
  )
    return null
  return { applied: value.applied, refused: refused.map(({ id, code }) => ({ id, code })) }
}

export function selectionAfterBulk(selected, attempted, outcome) {
  if (!outcome) return [...selected]
  const refused = new Set(outcome.refused.map((r) => r.id))
  const requested = new Set(attempted)
  return selected.filter((id) => !requested.has(id) || refused.has(id))
}

export function bulkReasonKey(code, extensionErrors = {}) {
  const reason = String(code).replace(/^flow\.error\./, '')
  return (
    extensionErrors[reason] ??
    (['blocked', 'forbidden', 'notFound', 'validation', 'conflict'].includes(reason)
      ? `flow.bulk.reason.${reason}`
      : 'flow.bulk.reason.other')
  )
}
