import { KET_GRID_NO_CHANGES } from '@ketvietlab/design-system'
import type { KetGridIslandColumn, KetGridIslandConfig } from '@ketvietlab/design-system'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { ketGridLocale } from '../../sale_backend/modal/line-grid-labels.ts'
import type { BomData } from './bom-view.tsx'

type Row = Record<string, unknown>
type Posted = {
  added?: { id: string; index?: number; values: Row }[]
  updated?: { id: string; values: Row }[]
  removed?: string[]
  order?: string[] | null
}

export const BOM_FORM = 'manufacturing-bom-form'
export const TIME_MODES = ['quantity', 'fixed'] as const

/**
 * The rows a grid posted, merged onto the saved ones in the order the reader left them.
 * A row added here gets an id under its BOM, so two saves never mint the same one.
 */
export function postedRows(posted: string | null | undefined, saved: Row[], bomId: string): Row[] {
  const draft = JSON.parse(posted || KET_GRID_NO_CHANGES) as Posted
  const rows: Row[] = saved.map((row) => ({ ...row }))
  for (const change of draft.updated ?? []) {
    const row = rows.find((candidate) => String(candidate.id) === change.id)
    if (row) Object.assign(row, change.values)
  }
  // A grid numbers its new rows afresh on every load, so they get ids of their own here.
  const minted = new Map<string, string>()
  for (const added of [...(draft.added ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const id = `${bomId}:${globalThis.crypto.randomUUID()}`
    minted.set(added.id, id)
    rows.splice(Math.min(added.index ?? rows.length, rows.length), 0, { ...added.values, id })
  }
  const removed = new Set((draft.removed ?? []).map((id) => minted.get(id) ?? id))
  const kept = rows.filter((row) => !removed.has(String(row.id)))
  if (draft.order?.length) {
    const order = draft.order.map((id) => minted.get(id) ?? id)
    const rank = (row: Row) => {
      const at = order.indexOf(String(row.id))
      return at === -1 ? order.length : at
    }
    kept.sort((a, b) => rank(a) - rank(b))
  }
  return kept.map((row, index) => ({ ...row, sequence: (index + 1) * 10 }))
}

const options = (rows: Row[] | undefined, label = 'name') =>
  (rows ?? []).map((row) => ({ value: String(row.id), label: String(row[label] ?? row.name ?? row.id) }))

export function operationsGrid(c: RecordModalContext<BomData>): KetGridIslandConfig {
  const t = (key: string) => c.t(`manufacturing_backend.${key}`)
  const columns: KetGridIslandColumn[] = [
    { key: 'name', label: t('field.operation'), type: 'text', editable: true },
    {
      key: 'workCenterId',
      label: t('field.workCenter'),
      type: 'select',
      editable: true,
      options: [{ value: '', label: '—' }, ...options(c.data.choices.workCenters)],
    },
    {
      key: 'durationExpected',
      label: t('field.minutes'),
      type: 'number',
      editable: true,
      min: 0,
      fractionDigits: 0,
    },
    {
      key: 'timeMode',
      label: t('field.timeMode'),
      type: 'select',
      editable: true,
      options: TIME_MODES.map((mode) => ({ value: mode, label: t(`timeMode.${mode}`) })),
    },
  ]
  const row = (operation: Row) => ({
    id: String(operation.id ?? ''),
    name: String(operation.name ?? ''),
    workCenterId: String(operation.workCenterId ?? ''),
    durationExpected: Number(operation.durationExpected ?? 0),
    timeMode: String(operation.timeMode ?? 'fixed'),
  })
  return {
    label: t('bom.operations'),
    ...ketGridLocale(c.data.lang),
    columns,
    rows: ((c.data.record.operations as Row[]) ?? []).map(row),
    name: 'operations',
    form: BOM_FORM,
    carry: c.draft('operations', KET_GRID_NO_CHANGES),
    readOnly: c.busy || !c.data.can.save,
    removable: true,
    reorderable: true,
    visibleRows: 5,
    newRows: [{ label: t('bom.addOperation'), row: row({ durationExpected: 0, timeMode: 'quantity' }) }],
  }
}

export function linesGrid(c: RecordModalContext<BomData>): KetGridIslandConfig {
  const t = (key: string) => c.t(`manufacturing_backend.${key}`)
  const operations = (c.data.record.operations as Row[]) ?? []
  const columns: KetGridIslandColumn[] = [
    {
      key: 'productId',
      label: t('field.component'),
      type: 'combobox',
      editable: true,
      options: options(c.data.choices.products, 'displayName'),
      resets: ['productUomId'],
      ...(c.data.can.products
        ? {
            search: {
              listFunction: 'product.listVariants',
              labelField: 'displayName',
              setsFrom: { productUomId: 'uomId' },
            },
          }
        : {}),
    },
    { key: 'productQty', label: t('field.quantity'), type: 'number', editable: true, min: 0 },
    {
      key: 'productUomId',
      label: t('field.uom'),
      type: 'select',
      editable: true,
      options: options(c.data.choices.units),
    },
    { key: 'lossPercent', label: t('field.loss'), type: 'number', editable: true, min: 0, max: 50 },
    {
      key: 'operationId',
      label: t('field.operation'),
      type: 'select',
      editable: true,
      // Saved operations only: an operation added above is offered once the BOM is saved.
      options: [{ value: '', label: '—' }, ...options(operations)],
    },
  ]
  const row = (line: Row) => ({
    id: String(line.id ?? ''),
    productId: String(line.productId ?? ''),
    productQty: Number(line.productQty ?? 0),
    productUomId: String(line.productUomId ?? ''),
    lossPercent: Number(line.lossPercent ?? 0),
    operationId: String(line.operationId ?? ''),
  })
  return {
    label: t('bom.lines'),
    ...ketGridLocale(c.data.lang),
    columns,
    rows: ((c.data.record.lines as Row[]) ?? []).map(row),
    name: 'lines',
    form: BOM_FORM,
    carry: c.draft('lines', KET_GRID_NO_CHANGES),
    readOnly: c.busy || !c.data.can.save,
    removable: true,
    reorderable: true,
    visibleRows: 8,
    newRows: [{ label: t('bom.addLine'), row: row({ productQty: 1, lossPercent: 0 }) }],
  }
}
