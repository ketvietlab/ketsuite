import { applyConfirmedGrid } from './confirmed-grid.ts'
import { validSaleLine } from './free-lines.ts'
import { randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { exactDecimal } from '../account/money.ts'
import { ours } from './scope.ts'
import { claimRevision, SaleRefused } from './functions/shared.ts'
import { replaceQuotationLines, writeQuotationLine } from './functions/lines.ts'

const invalid = (field: string, code: string) => ({ ok: false, errors: [{ field, code }] })
const fields = new Set([
  'displayType',
  'productId',
  'productUomId',
  'productUomQty',
  'priceUnit',
  'priceAutomatic',
  'discount',
  'name',
  'taxIds',
  'taxId',
])
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const decimal = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 })
    : value

/** A grid is a patch to this quotation only; amounts, tax calculation and company remain server-owned. */
export async function applyQuotationGrid(ctx: Ctx, args: Row, inTransaction = false) {
  const changes = args.changes
  if (
    !object(changes) ||
    !['added', 'updated', 'removed', 'order'].every((key) => key in changes) ||
    Object.keys(changes).some((key) => !['added', 'updated', 'removed', 'order'].includes(key)) ||
    !Array.isArray(changes.added) ||
    !Array.isArray(changes.updated) ||
    !Array.isArray(changes.removed) ||
    (changes.order !== null && !Array.isArray(changes.order))
  )
    return invalid('changes', 'sale.error.gridInvalid')
  const added = changes.added as unknown[]
  const updated = changes.updated as unknown[]
  const removed = changes.removed as unknown[]
  if (added.length + updated.length + removed.length > 200)
    return invalid('changes', 'sale.error.gridTooMany')
  const entries = [...added, ...updated]
  if (
    entries.some(
      (entry) =>
        !object(entry) ||
        typeof entry.id !== 'string' ||
        !entry.id ||
        !object(entry.values) ||
        Object.keys(entry.values).some((key) => !fields.has(key)),
    ) ||
    removed.some((id) => typeof id !== 'string')
  )
    return invalid('changes', 'sale.error.gridFields')
  const typedAdded = added as { id: string; index: number; values: Row }[]
  const typedUpdated = updated as { id: string; values: Row }[]
  const removedIds = removed as string[]
  for (const entry of [...typedAdded, ...typedUpdated]) {
    for (const [key, value] of Object.entries(entry.values)) {
      if (key === 'priceAutomatic') {
        if (value != null && typeof value !== 'boolean') return invalid('changes', 'sale.error.gridFields')
      } else if (key === 'displayType') {
        if (value != null && value !== 'section' && value !== 'note')
          return invalid('changes', 'sale.error.gridFields')
      } else if (key === 'name') {
        if (typeof value !== 'string' || value.length > 500)
          return invalid('changes', 'sale.error.freeLineRequired')
      } else if (key === 'taxIds') {
        if (!Array.isArray(value) || value.length > 20 || value.some((id) => typeof id !== 'string' || !id))
          return invalid('changes', 'sale.error.gridFields')
      } else if (key === 'productId' || key === 'productUomId' || key === 'taxId') {
        if (value != null && typeof value !== 'string')
          return invalid('changes', 'sale.error.gridProductUnit')
      } else if (value != null && value !== '') {
        try {
          exactDecimal(decimal(value))
        } catch {
          return invalid('changes', 'sale.error.gridDecimal')
        }
      }
    }
  }
  const touched = [...typedAdded.map((row) => row.id), ...typedUpdated.map((row) => row.id), ...removedIds]
  if (new Set(touched).size !== touched.length) return invalid('changes', 'sale.error.gridDuplicate')
  try {
    const save = async (tx: Ctx) => {
      const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (
        !order ||
        !['draft', 'sent', 'sale'].includes(String(order.state)) ||
        order.locked ||
        (order.orderAuthority != null && order.orderAuthority !== 'local')
      )
        return invalid('id', 'sale.error.lineNotEditable')
      if (Number(order.revision) !== Number(args.expectedRevision))
        return invalid('expectedRevision', 'sale.error.orderChanged')
      const lines = (await ours(tx, 'sale.OrderLine', { orderId: order.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      )
      const known = new Map(lines.map((line) => [String(line.id), line]))
      if (
        [...typedUpdated.map((row) => row.id), ...removedIds].some((id) => !known.has(id)) ||
        typedAdded.some((row) => known.has(row.id))
      )
        return invalid('changes', 'sale.error.gridOwnership')
      if (!touched.length && changes.order === null)
        return { ok: true, id: order.id, revision: order.revision }
      if (order.state === 'sale') return await applyConfirmedGrid(tx, order, lines, changes)
      // The grid replaces lines atomically, which would detach fulfilment and invoice references. A
      // quotation with that history keeps every saved line instead: they change as a confirmed order's
      // do, and new product lines follow them.
      for (const line of lines) {
        if (
          (await tx.db.select('stock.Move', { saleLineId: line.id })).length ||
          (await tx.db.select('account.MoveLine', { saleLineId: line.id })).length
        )
          return await applyHistoryGrid(tx, order, lines, changes, typedAdded)
      }
      const merged: Row[] = lines
        .filter((line) => !removedIds.includes(String(line.id)))
        .map((line) => {
          const patch = typedUpdated.find((item) => item.id === line.id)?.values ?? {}
          if (Object.hasOwn(patch, 'displayType') && patch.displayType !== line.displayType)
            throw new SaleRefused(invalid('changes', 'sale.error.gridFields'))
          const changedProduct = patch.productId !== undefined && patch.productId !== line.productId
          const changedUnit = patch.productUomId !== undefined && patch.productUomId !== line.productUomId
          return {
            ...line,
            ...patch,
            priceAutomatic:
              Object.hasOwn(patch, 'priceUnit') && (patch.priceUnit == null || patch.priceUnit === '')
                ? true
                : (patch.priceAutomatic ??
                  (Object.hasOwn(patch, 'priceUnit')
                    ? false
                    : changedProduct || changedUnit
                      ? true
                      : line.priceAutomatic)),
            ...(Object.hasOwn(patch, 'taxId') ? { taxIds: patch.taxId ? [patch.taxId] : [] } : {}),
            ...(changedProduct && patch.productId && !Object.hasOwn(patch, 'name')
              ? { name: undefined }
              : {}),
            ...((changedProduct || changedUnit) && !Object.hasOwn(patch, 'priceUnit')
              ? { priceUnit: undefined }
              : {}),
          }
        })
      const aliases = new Map<string, string>()
      for (const entry of typedAdded) {
        if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index > merged.length)
          return invalid('changes', 'sale.error.gridOrder')
        const id = randomUUID()
        aliases.set(entry.id, id)
        merged.splice(entry.index, 0, {
          id,
          ...entry.values,
          ...(Object.hasOwn(entry.values, 'taxId')
            ? { taxIds: entry.values.taxId ? [entry.values.taxId] : [] }
            : {}),
        } as (typeof merged)[number])
      }
      if (merged.length > 100) return invalid('changes', 'sale.error.gridTooMany')
      if (merged.some((line) => !validSaleLine(line))) return invalid('changes', 'sale.error.gridRequired')
      let ordered = merged
      if (changes.order !== null) {
        const ids = (changes.order as unknown[]).map((id) =>
          typeof id === 'string' ? (aliases.get(id) ?? id) : '',
        )
        const byId = new Map(merged.map((line) => [String(line.id), line]))
        if (
          ids.length !== merged.length ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !byId.has(id))
        )
          return invalid('changes', 'sale.error.gridOrder')
        ordered = ids.map((id) => byId.get(id)!)
      }
      if (!(await claimRevision(tx, order, args.expectedRevision)))
        throw new SaleRefused(invalid('expectedRevision', 'sale.error.orderChanged'))
      await replaceQuotationLines(
        tx,
        order.id,
        ordered.map((line) => ({
          ...line,
          productUomQty: decimal(line.productUomQty),
          priceUnit: line.priceUnit == null || line.priceUnit === '' ? undefined : decimal(line.priceUnit),
          discount: line.discount == null || line.discount === '' ? undefined : decimal(line.discount),
        })),
      )
      const saved = (await ours(tx, 'sale.Order', { id: order.id }))[0]!
      return { ok: true, id: order.id, revision: Number(saved.revision) }
    }
    return inTransaction ? await save(ctx) : await ctx.tx(save)
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
}

/**
 * A draft or sent quotation whose lines already have deliveries or invoices. Saved lines keep their
 * IDs, product and unit (`applyConfirmedGrid`); nothing is removed or reordered; added product lines
 * are written after the last one, in the grid's order. Caller owns the transaction.
 */
async function applyHistoryGrid(
  tx: Ctx,
  order: Row,
  lines: Row[],
  changes: Row,
  added: { id: string; values: Row }[],
) {
  if (
    (changes.removed as unknown[]).length ||
    changes.order !== null ||
    added.some((entry) => entry.values.displayType)
  )
    return invalid('changes', 'sale.error.historyGridStructure')
  if (lines.length + added.length > 100) return invalid('changes', 'sale.error.gridTooMany')
  // Line writes bump the revision unconditionally, so claim the reader's revision first: a concurrent
  // save from the same revision waits on this row and is then refused.
  if (!(await claimRevision(tx, order, order.revision)))
    throw new SaleRefused(invalid('expectedRevision', 'sale.error.orderChanged'))
  const claimed = { ...order, revision: Number(order.revision) + 1 }
  const updated = await applyConfirmedGrid(tx, claimed, lines, { ...changes, added: [] })
  if (updated.ok !== true || !added.length) return updated
  let sequence = Math.max(0, ...lines.map((line) => Number(line.sequence) || 0))
  for (const entry of added) {
    const { priceAutomatic: _automatic, taxId, ...values } = entry.values
    const result = await writeQuotationLine(tx, {
      ...values,
      id: randomUUID(),
      orderId: order.id,
      productUomQty: decimal(values.productUomQty),
      priceUnit: values.priceUnit == null || values.priceUnit === '' ? undefined : decimal(values.priceUnit),
      discount: values.discount == null || values.discount === '' ? undefined : decimal(values.discount),
      ...(taxId ? { taxId } : {}),
      sequence: (sequence += 10),
    })
    if (result.ok !== true) throw new SaleRefused(result as Row)
  }
  const saved = (await ours(tx, 'sale.Order', { id: order.id }))[0]!
  return { ok: true, id: order.id, revision: Number(saved.revision) }
}
