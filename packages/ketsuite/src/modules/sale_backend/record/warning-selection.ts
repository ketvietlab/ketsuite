type Row = Record<string, unknown>
/** Only identifiers leave the draft; server-owned warning text is always read afresh. */
export function saleWarningSelection(
  record: Row & { lines: Row[] },
  draft: (key: string, fallback: string) => string,
) {
  let rows = new Map(record.lines.map((line) => [String(line.id), { ...line }]))
  try {
    const changes = JSON.parse(draft('lines', '{}'))
    for (const id of changes.removed ?? []) rows.delete(String(id))
    for (const entry of changes.updated ?? [])
      if (rows.has(String(entry.id)))
        rows.set(String(entry.id), { ...rows.get(String(entry.id)), ...entry.values })
    for (const entry of changes.added ?? []) rows.set(String(entry.id), { ...entry.values })
    if (Array.isArray(changes.order)) {
      const ordered = changes.order
        .map((id: unknown) => [String(id), rows.get(String(id))] as const)
        .filter((entry: readonly [string, Row | undefined]) => entry[1])
      for (const [id] of ordered) rows.delete(id)
      rows = new Map([...ordered, ...rows].filter((entry): entry is [string, Row] => Boolean(entry[1])))
    }
  } catch {
    /* Malformed drafts retain the saved advisory; the line writer reports errors. */
  }
  return {
    partnerId: draft('partnerId', String(record.partnerId ?? '')) || undefined,
    productIds: [
      ...new Set(
        [...rows.values()]
          .filter((row) => !row.displayType && row.productId)
          .map((row) => String(row.productId)),
      ),
    ],
  }
}
