import { SaleMatrixHelp } from '../screens/matrix-help.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import {
  ActionGroup,
  AppSwitcherHelp,
  Button,
  KET_GRID_NO_CHANGES,
  Notice,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { compareDecimals } from '../../account/money.ts'
import { createRecordModal, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalDefinition, RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { ketGridLocale } from './line-grid-labels.ts'
type Row = Record<string, unknown>
type Axis = { id: string; name: string; values: { id: string; name: string }[] }
type Variant = Row & {
  id: string
  name: string
  values: Record<string, string>
  quantity: string
  unit: string
  price: string | null
  currency: string
}
export type VariantMatrixData = {
  order: Row
  template: { id: string; name: string }
  axes: Axis[]
  rows: Variant[]
  matrixRevision: string
  save: boolean
  orderHref: string
  lang: 'vi' | 'en'
}
type Context = RecordModalContext<VariantMatrixData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t('sale_backend.matrix.' + key)
const formId = 'sale-variant-matrix-form'

/**
 * One row per variant, as a spreadsheet: its attribute values and unit read-only, its price, the quantity to
 * edit and the amount that follows it. Quantities are edited in the DS grid, never in fields set in a table.
 */
export const variantMatrixGridConfig = (c: Context): KetGridIslandConfig => {
  const save = c.data.save
  return {
    label: c.data.template.name,
    ...ketGridLocale(c.data.lang),
    currency: String(c.data.rows[0]?.currency ?? 'VND'),
    columns: [
      ...c.data.axes.map((axis) => ({
        key: 'axis:' + axis.id,
        label: axis.name,
        type: 'text' as const,
        editable: false,
        width: 140,
        // The attribute columns take the dialog's spare width; the figures keep theirs.
        grow: 1,
      })),
      { key: 'unit', label: t(c, 'unit'), type: 'text' as const, editable: false, width: 100 },
      { key: 'price', label: t(c, 'price'), type: 'money' as const, editable: false, width: 120 },
      {
        key: 'quantity',
        label: t(c, 'quantity'),
        type: 'number' as const,
        editable: save,
        min: 0,
        width: 110,
      },
      {
        key: 'amount',
        label: t(c, 'amount'),
        type: 'money' as const,
        compute: { multiply: ['quantity', 'price'] },
        footer: 'sum' as const,
        width: 130,
      },
    ],
    rows: c.data.rows.map((row) => ({
      id: row.id,
      ...Object.fromEntries(
        c.data.axes.map((axis) => [
          'axis:' + axis.id,
          axis.values.find((value) => value.id === row.values[axis.id])?.name ?? '',
        ]),
      ),
      unit: row.unit,
      price: row.price == null ? null : Number(row.price),
      quantity: Number(row.quantity),
    })),
    removable: false,
    reorderable: false,
    readOnly: !save || c.busy,
    visibleRows: Math.min(Math.max(c.data.rows.length, 1), 10),
    ...(save
      ? {
          name: 'quantities',
          form: formId,
          // The grid's own clean value: an empty default would read as an edit and ask to discard it.
          carry: c.draft('quantities', KET_GRID_NO_CHANGES),
        }
      : {}),
  }
}

export const variantMatrixGrid = (c: Context) =>
  recordIsland('backend.ket-grid', { id: `sale-variant-matrix-${c.id}`, config: variantMatrixGridConfig(c) })

/** The quantities the grid changed, as the cells `sale.setVariantMatrix` takes; unchanged ones are left out. */
export const postedVariantQuantities = (form: FormData, rows: Variant[]) => {
  let updated: unknown
  try {
    updated = (JSON.parse(String(form.get('quantities') ?? '')) as { updated?: unknown })?.updated
  } catch {
    return []
  }
  if (!Array.isArray(updated)) return []
  return updated.flatMap((entry) => {
    const row = rows.find((value) => value.id === entry?.id)
    if (!row || !entry.values || !('quantity' in entry.values)) return []
    const quantity = entry.values.quantity == null ? '' : String(entry.values.quantity).trim()
    try {
      if (compareDecimals(quantity || '0', row.quantity) === 0) return []
    } catch {
      /* Server returns a translated validation error without discarding the draft. */
    }
    return [{ productId: row.id, quantity }]
  })
}
export const variantMatrixDefinition: RecordModalDefinition<VariantMatrixData> = {
  kind: 'sale.variantMatrix',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id) => `/admin/sales/variant-matrix/${encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['matrixOrderId', 'company', 'branch'],
  },
  title: (c) => t(c, 'title') + ' · ' + c.data.template.name,
  description: (c) => String(c.data.order.name),
  body: (c) => (
    <Stack
      items={[
        <SaleMatrixHelp lang={c.data.lang} />,
        !c.data.save ? <Notice title={t(c, 'readonly')} message="" /> : null,
        <Text variant="bodySm">{t(c, 'help')}</Text>,
        c.fieldError('quantities') ? (
          <Notice title={c.t('recordModal.errorTitle')} message={c.fieldError('quantities')!} tone="danger" />
        ) : null,
        c.data.save ? (
          <RecordModalForm id={formId} kind={c.kind} command="save" fields={[]} body={variantMatrixGrid(c)} />
        ) : (
          variantMatrixGrid(c)
        ),
      ]}
    />
  ),
  actions: (c) => (
    <ActionGroup
      actions={[
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        c.data.save ? (
          <Button type="submit" form={formId} label={t(c, 'save')} variant="primary" disabled={c.busy} />
        ) : null,
      ]}
    />
  ),
  commands: {
    save: {
      fn: 'sale.setVariantMatrix',
      input: (form, c) => ({
        id: c.data.order.id,
        templateId: c.id,
        expectedRevision: c.data.order.revision,
        matrixRevision: c.data.matrixRevision,
        quantities: postedVariantQuantities(form, c.data.rows),
      }),
      navigate: (_value, c) => c.data.orderHref,
      after: 'stay',
    },
  },
}
export const variantMatrixModal = createRecordModal(variantMatrixDefinition)
