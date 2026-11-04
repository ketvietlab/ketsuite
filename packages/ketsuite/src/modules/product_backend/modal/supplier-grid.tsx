import { Button, KET_GRID_NO_CHANGES, Notice, Surface } from '@ketvietlab/design-system'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { recordIsland, type RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import type { TemplateModalData } from './product-modal-view.tsx'

export type ProductSuppliers = {
  revision: string
  currency: string
  money: boolean
  editable: boolean
  rows: Array<{
    id: string
    partnerId: string
    vendor: string
    productId: string
    productCode: string
    minQty: string
    price: string | null
    delay: number
  }>
}
type Context = RecordModalContext<TemplateModalData>
const formId = 'product-supplier-grid-form'
export const supplierGridConfig = (c: Context): KetGridIslandConfig => {
  const data = c.data.suppliers!
  const t = (key: string) => c.t(`product_backend.ws.${key}`)
  const partners = new Map(
    data.rows.map((row) => [row.partnerId, { value: row.partnerId, label: row.vendor }]),
  )
  return {
    label: t('vendors'),
    ...ketGridLocale(c.data.lang),
    currency: data.currency,
    columns: [
      {
        key: 'partnerId',
        label: t('vendor'),
        type: 'combobox',
        editable: true,
        required: true,
        width: 240,
        options: [...partners.values()],
        search: { listFunction: 'purchase.listSupplierPartners', labelField: 'name' },
      },
      {
        key: 'productId',
        label: t('supplierVariant'),
        type: 'combobox',
        editable: true,
        width: 200,
        options: [
          { value: '*', label: t('allVariants') },
          ...(c.data.variants ?? [])
            .filter(
              (row) => row.active !== false || data.rows.some((supplier) => supplier.productId === row.id),
            )
            .map((row) => ({ value: row.id, label: row.label })),
        ],
      },
      { key: 'productCode', label: t('vendorCode'), type: 'text', editable: true, width: 150 },
      { key: 'minQty', label: t('minQty'), type: 'number', editable: true, min: 0, width: 120 },
      ...(data.money
        ? [
            {
              key: 'price',
              label: `${t('purchasePrice')} (${data.currency})`,
              type: 'text' as const,
              editable: true,
              align: 'end' as const,
              width: 150,
            },
          ]
        : []),
      {
        key: 'delay',
        label: t('supplierDays'),
        type: 'number',
        editable: true,
        min: 0,
        max: 365,
        width: 120,
      },
    ],
    rows: data.rows.map((row) => ({ ...row, productId: row.productId || '*' })),
    newRow: {
      partnerId: null,
      productId: '*',
      productCode: '',
      minQty: 0,
      delay: 0,
      ...(data.money ? { price: '0' } : {}),
    },
    removable: data.editable,
    reorderable: data.editable,
    readOnly: c.busy || !data.editable,
    visibleRows: 6,
    // Only a grid that can post carries a field: read only, there is no form for it, and a named
    // field would read as an open control. The draft starts at the grid's own "no changes".
    ...(data.editable
      ? { name: 'supplierChanges', form: formId, carry: c.draft('supplierChanges', KET_GRID_NO_CHANGES) }
      : {}),
  }
}

export const ProductSupplierGrid = ({ context: c }: { context: Context }) => {
  const grid = recordIsland('backend.ket-grid', {
    id: `product-supplier-grid-${c.id}`,
    config: supplierGridConfig(c),
  })
  return (
    <Surface
      title={c.t('product_backend.ws.vendors')}
      description={c.t('product_backend.ws.supplierHelp')}
      body={
        c.data.suppliers!.editable ? (
          <RecordModalForm
            id={formId}
            kind={c.kind}
            command="saveSuppliers"
            fields={[]}
            body={[
              c.fieldError('supplierChanges') ? (
                <Notice
                  tone="danger"
                  title={c.t('product_backend.ws.vendors')}
                  message={c.fieldError('supplierChanges')!}
                />
              ) : null,
              grid,
            ]}
            actions={[
              <Button
                type="submit"
                label={c.t('product_backend.ws.saveSuppliers')}
                variant="primary"
                disabled={c.busy}
              />,
            ]}
          />
        ) : (
          grid
        )
      }
    />
  )
}

export function postedSupplierGrid(form: FormData): unknown {
  try {
    const parsed = JSON.parse(String(form.get('supplierChanges') ?? ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const { optionLabels: _labels, ...changes } = parsed
    for (const group of ['added', 'updated'])
      if (Array.isArray(changes[group]))
        for (const entry of changes[group]) {
          if (entry?.values?.productId === '*') entry.values.productId = null
        }
    return changes
  } catch {
    return null
  }
}
