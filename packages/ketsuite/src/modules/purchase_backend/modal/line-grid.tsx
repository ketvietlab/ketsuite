import { Button, KET_GRID_NO_CHANGES, Notice, Stack } from '@ketvietlab/design-system'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'

type Row = Record<string, unknown>
type Data = {
  record: Row & { lines: Row[] }
  permissions: Record<string, boolean>
  choices: Record<string, Row[]>
}
type Context = RecordModalContext<Data>
const t = (c: Context, key: string) => c.t(`purchase_backend.${key}`)
/** The unit tree a unit belongs to: units of one tree convert into each other. */
const rootOf = (unit: Row | undefined) =>
  String(unit?.parentPath ?? '')
    .split('/')
    .filter(Boolean)[0] ?? ''
const amount = (value: unknown) => (value == null || value === '' ? null : Number(value))

/** The order's lines are edited in one grid (DS: document lines are a KetGrid), saved at once. */
export const PURCHASE_LINES_FORM = 'purchase-order-lines-form'

/** Whether this reader edits the order's lines in the grid: an RFQ open to changes and some line right. */
export const linesInGrid = (c: Context) =>
  !c.creating &&
  ['draft', 'sent'].includes(String(c.data.record.state)) &&
  !c.data.record.locked &&
  c.data.permissions.saveLines === true &&
  ['addLine', 'updateLine', 'removeLine'].some((fn) => c.data.permissions[fn] === true)

export function purchaseLinesGridConfig(c: Context): KetGridIslandConfig {
  const products = c.data.choices.variants ?? []
  const units = c.data.choices.units ?? []
  const unitById = new Map(units.map((unit) => [String(unit.id), unit]))
  const unitsLike = (unitId: unknown) => {
    const root = rootOf(unitById.get(String(unitId)))
    return units.filter((unit) => root && rootOf(unit) === root).map((unit) => String(unit.id))
  }
  // Saved lines keep their product and the units of their own unit, even when no longer offered.
  const productOptions = new Map<string, { value: string; label: string; description: string }>()
  const unitsByProduct = new Map<string, string[]>()
  for (const line of c.data.record.lines) {
    const id = String(line.productId)
    productOptions.set(id, {
      value: id,
      label: String(line.name),
      description: String(line.name),
    })
    unitsByProduct.set(id, unitsLike(line.productUomId))
  }
  for (const product of products) {
    const id = String(product.id)
    productOptions.set(id, {
      value: id,
      label: String(product.defaultCode || product.name),
      description: String(product.displayName ?? product.name),
    })
    unitsByProduct.set(id, unitsLike(product.uomId))
  }
  const edits = c.data.permissions.updateLine === true
  return {
    label: t(c, 'modal.lines'),
    ...ketGridLocale(typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'),
    currency: String(c.data.record.currency ?? 'VND'),
    columns: [
      {
        key: 'productId',
        label: t(c, 'field.product'),
        type: 'combobox',
        editable: true,
        required: true,
        // A saved line keeps its product; a new one takes the product's own unit.
        lockedBy: 'saved',
        options: [...productOptions.values()],
        sets: Object.fromEntries(
          products.map((product) => [String(product.id), { productUomId: product.uomId ?? null }]),
        ),
        resets: ['productUomId'],
        // The catalogue is searched as the reader types; a found product brings its unit along.
        search: {
          listFunction: 'product.listVariants',
          listInput: { purchaseOk: true },
          labelField: 'defaultCode',
          labelFallbackField: 'displayName',
          descriptionField: 'displayName',
          setsFrom: { productUomId: 'uomId' },
        },
        width: 220,
        grow: 1,
      },
      {
        key: 'productQty',
        label: t(c, 'field.productQty'),
        type: 'number',
        editable: true,
        required: true,
        lockedBy: 'lineLocked',
        min: 0,
        width: 96,
      },
      {
        key: 'productUomId',
        label: t(c, 'field.uom'),
        type: 'select',
        editable: true,
        required: true,
        lockedBy: 'lineLocked',
        options: units.map((unit) => ({ value: String(unit.id), label: String(unit.name) })),
        // A product takes the units its own unit converts into.
        optionsBy: { field: 'productId', values: Object.fromEntries(unitsByProduct) },
        width: 120,
      },
      { key: 'qtyReceived', label: t(c, 'field.qtyReceived'), type: 'number', editable: false, width: 96 },
      {
        key: 'priceUnit',
        label: t(c, 'field.priceUnit'),
        type: 'money',
        editable: true,
        lockedBy: 'lineLocked',
        min: 0,
        // An empty price on a new line takes the vendor pricelist.
        placeholder: t(c, 'lines.vendorPrice'),
        width: 128,
      },
      {
        key: 'discount',
        label: t(c, 'field.discount'),
        type: 'percent',
        editable: true,
        lockedBy: 'lineLocked',
        min: 0,
        max: 100,
        width: 88,
      },
      {
        key: 'taxId',
        label: t(c, 'field.tax'),
        type: 'select',
        editable: true,
        lockedBy: 'lineLocked',
        options: [
          { value: '', label: '—' },
          ...(c.data.choices.taxes ?? []).map((tax) => ({ value: String(tax.id), label: String(tax.name) })),
        ],
        width: 128,
      },
      {
        key: 'subtotal',
        label: t(c, 'field.subtotal'),
        type: 'money',
        editable: false,
        compute: { multiply: ['productQty', 'priceUnit'], percentOff: 'discount' },
        width: 128,
      },
    ],
    rows: c.data.record.lines.map((line) => ({
      id: String(line.id),
      productId: String(line.productId),
      productQty: amount(line.productQty),
      productUomId: line.productUomId == null ? null : String(line.productUomId),
      qtyReceived: amount(line.qtyReceived),
      priceUnit: amount(line.priceUnit),
      discount: amount(line.discount),
      taxId: line.taxId == null ? '' : String(line.taxId),
      saved: true,
      lineLocked: !edits,
    })),
    newRows:
      c.data.permissions.addLine === true
        ? [
            {
              label: t(c, 'action.addLine'),
              row: {
                productId: null,
                productQty: 1,
                productUomId: null,
                qtyReceived: null,
                priceUnit: null,
                discount: 0,
                taxId: '',
                saved: false,
                lineLocked: false,
              },
            },
          ]
        : [],
    removable: c.data.permissions.removeLine === true,
    readOnly: c.busy,
    visibleRows: 8,
    name: 'lines',
    form: PURCHASE_LINES_FORM,
    carry: c.draft('lines', KET_GRID_NO_CHANGES),
  }
}

export const PurchaseLinesGrid = ({ context: c }: { context: Context }) => {
  const error = c.fieldError('lines')
  return (
    <RecordModalForm
      kind={c.kind}
      id={PURCHASE_LINES_FORM}
      command="saveLines"
      fields={[]}
      body={
        <Stack
          items={[
            error ? <Notice tone="danger" title={c.t('recordModal.errorTitle')} message={error} /> : null,
            recordIsland('backend.ket-grid', {
              id: `purchase-lines-${c.id}`,
              config: purchaseLinesGridConfig(c),
            }),
          ]}
        />
      }
      actions={[
        <Button type="submit" label={t(c, 'action.saveLines')} variant="primary" disabled={c.busy} />,
      ]}
    />
  )
}
