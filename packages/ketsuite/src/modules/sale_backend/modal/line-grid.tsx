import { Button, KET_GRID_NO_CHANGES, Notice, Stack } from '@ketvietlab/design-system'
import { quotationWithHistory } from './history.ts'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import type { SaleOrderModalData } from './order-modal-view.tsx'
import { ketGridLocale } from './line-grid-labels.ts'

type Context = RecordModalContext<SaleOrderModalData>
const formId = 'sale-line-grid-form'

export const canUseSaleLineGrid = (c: Context) =>
  c.data.permissions.applyLineGrid &&
  ['draft', 'sent', 'sale'].includes(String(c.data.record.state)) &&
  !c.data.record.locked &&
  (!c.data.record.orderAuthority || c.data.record.orderAuthority === 'local')

export const saleLineGridConfig = (c: Context): KetGridIslandConfig => {
  const t = (key: string) => c.t(`sale_backend.${key}`)
  const confirmed = c.data.record.state === 'sale'
  // Saved lines of a quotation that already carries deliveries or invoices keep their product and place.
  const history = !confirmed && quotationWithHistory(c)
  const settled = confirmed || history
  // On a confirmed order only a delivered or invoiced line, or a combo's, keeps its product (D33b).
  const fixed = (line: (typeof c.data.record.lines)[number]) =>
    history ||
    (confirmed &&
      (Number(line.qtyDelivered ?? 0) > 0 ||
        Number(line.qtyInvoiced ?? 0) > 0 ||
        !!line.comboParentId ||
        line.comboBasePrice != null))
  const showMargin = !confirmed && c.data.permissions?.getLineCosts === true
  const compact = showMargin || settled
  const costs = new Map((c.data.lineCosts ?? []).map((cost) => [String(cost.lineId), cost]))
  const margin = (as?: 'percent') => ({
    multiply: ['productUomQty', 'priceUnit'],
    percentOff: 'discount',
    less: ['productUomQty', 'unitCost'],
    ...(as ? { as } : {}),
    solve: { field: 'priceUnit', digits: 0 },
  })
  const products = new Map(
    (c.data.choices.variants ?? []).map((row) => [
      String(row.id),
      {
        value: String(row.id),
        label: String(row.defaultCode || row.displayName || row.name),
        description: String(row.displayName ?? row.name),
      },
    ]),
  )
  for (const line of c.data.record.lines)
    if (line.productId && !products.has(String(line.productId)))
      products.set(String(line.productId), {
        value: String(line.productId),
        label: String(line.productCode || line.name),
        description: String(line.name),
      })
  const comboOptions: Record<string, string[]> = {}
  for (const line of c.data.record.lines) {
    if (!line.comboChoiceId) continue
    const options = Array.isArray(line.comboOptions)
      ? (line.comboOptions as { id: string; name: string; code?: string }[])
      : []
    comboOptions[String(line.comboChoiceId)] = options.map((option) => option.id)
    for (const option of options)
      products.set(option.id, {
        value: option.id,
        label: option.code || option.name,
        description: option.name,
      })
  }
  const units = new Map(
    c.data.record.lines
      .filter((line) => line.productUomId)
      .map((line) => [
        String(line.productUomId),
        { value: String(line.productUomId), label: String(line.productUomName ?? line.productUomId) },
      ]),
  )
  return {
    label: t('modal.lines'),
    tiers: {
      key: 'productId',
      with: 'productUomId',
      by: 'productUomQty',
      stepsField: 'priceSteps',
      lockedBy: ['priceManual', 'priceHistory'],
    },
    ...ketGridLocale(c.data.lang),
    currency: String(c.data.record.currency ?? 'VND'),
    kindField: 'displayType',
    fullWidthKey: 'name',
    fullWidthTag: { field: 'optionalSection', label: t('grid.optional') },
    columns: [
      {
        key: 'productId',
        lockedBy: 'identityLocked',
        label: t('field.product'),
        type: 'combobox',
        editable: true,
        width: compact ? 100 : 128,
        options: [...products.values()],
        writeSets: { priceAutomatic: true, priceManual: false },
        resets: [
          'productUomId',
          'priceUnit',
          'priceSteps',
          ...(showMargin ? ['unitCost', 'marginLocked'] : []),
        ],
        optionsBy: { field: 'comboChoiceId', values: comboOptions },
        search: {
          listFunction: 'product.listVariants',
          listInput: { saleOk: true },
          labelField: 'defaultCode',
          labelFallbackField: 'displayName',
          descriptionField: 'displayName',
        },
      },
      {
        key: 'name',
        label: t('grid.description'),
        type: 'text',
        editable: true,
        lockedBy: 'descriptionLocked',
        width: compact ? 180 : 250,
        placeholder: t('grid.freeDescription'),
      },
      {
        key: 'productUomId',
        lockedBy: 'unitLocked',
        // A line with no product has no unit to choose, and the server refuses one (#1815).
        requires: 'productId',
        label: t('field.uom'),
        type: 'combobox',
        editable: true,
        width: compact ? 80 : 100,
        options: [...units.values()],
        writeSets: { priceAutomatic: true, priceManual: false },
        resets: ['priceUnit', 'priceSteps', ...(showMargin ? ['unitCost', 'marginLocked'] : [])],
        search:
          showMargin && c.data.permissions.listLinePricing
            ? {
                listFunction: 'sale.listLinePricing',
                listInput: { orderId: c.id },
                listInputFields: { productId: 'productId', quantity: 'productUomQty' },
                labelField: 'name',
                setsFrom: {
                  unitCost: 'unitCost',
                  priceUnit: 'priceUnit',
                  discount: 'discount',
                  marginLocked: 'marginLocked',
                  priceSteps: 'priceSteps',
                },
              }
            : c.data.permissions?.listLinePrices
              ? {
                  listFunction: 'sale.listLinePrices',
                  listInput: { orderId: c.id },
                  listInputFields: { productId: 'productId', quantity: 'productUomQty' },
                  labelField: 'name',
                  setsFrom: { priceUnit: 'priceUnit', discount: 'discount', priceSteps: 'priceSteps' },
                }
              : {
                  listFunction: 'sale.listLineUnits',
                  listInputFields: { productId: 'productId' },
                  labelField: 'name',
                },
      },
      {
        key: 'productUomQty',
        lockedBy: 'commercialLocked',
        label: t('field.quantity'),
        type: 'number',
        editable: true,
        required: true,
        min: 0,
        width: 116,
      },
      // Keep exact decimal strings: financial input must not round-trip through a binary Number.
      {
        key: 'priceUnit',
        lockedBy: 'priceLocked',
        label: t('field.priceUnit'),
        type: 'text',
        editable: true,
        placeholder: t('grid.automaticPrice'),
        writeSets: { priceAutomatic: false, priceManual: true },
        width: compact ? 112 : 140,
        align: 'end',
      },
      {
        key: 'discount',
        writeSets: { priceAutomatic: false, priceManual: true },
        lockedBy: 'priceLocked',
        label: t('field.discount'),
        type: 'percent',
        editable: true,
        min: 0,
        max: 100,
        width: compact ? 80 : 100,
      },
      {
        key: 'taxId',
        label: t('field.tax'),
        type: 'combobox',
        editable: true,
        lockedBy: 'taxesLocked',
        width: compact ? 112 : 150,
        options: [
          { value: '', label: t('grid.noTax') },
          ...(c.data.choices.taxes ?? []).map((tax) => ({ value: String(tax.id), label: String(tax.name) })),
        ],
      },
      ...(settled
        ? [
            {
              key: 'qtyDelivered',
              label: t('field.delivered'),
              type: 'number' as const,
              editable: false,
              width: 100,
            },
            {
              key: 'qtyInvoiced',
              label: t('field.invoiced'),
              type: 'number' as const,
              editable: false,
              width: 100,
            },
          ]
        : []),
      ...(showMargin
        ? [
            {
              key: 'margin',
              label: t('grid.margin'),
              type: 'money' as const,
              editable: true,
              lockedBy: 'marginLocked',
              writeSets: { priceAutomatic: false, priceManual: true },
              compute: margin(),
              width: 100,
            },
            {
              key: 'marginPercent',
              label: t('grid.marginPercent'),
              type: 'percent' as const,
              editable: true,
              lockedBy: 'marginLocked',
              writeSets: { priceAutomatic: false, priceManual: true },
              compute: margin('percent'),
              width: 96,
            },
          ]
        : []),
    ],
    rows: c.data.record.lines.map((line) => ({
      id: line.id,
      displayType: line.displayType ?? null,
      optionalSection: line.optionalSection === true,
      productId: line.productId,
      identityLocked: fixed(line) || ['discount', 'reward'].includes(String(line.lineKind)),
      unitLocked:
        fixed(line) || !!line.comboParentId || ['discount', 'reward'].includes(String(line.lineKind)),
      descriptionLocked:
        !!line.comboParentId ||
        ['discount', 'reward'].includes(String(line.lineKind)) ||
        (settled && line.comboBasePrice != null),
      priceLocked:
        !!line.comboParentId ||
        ['discount', 'reward'].includes(String(line.lineKind)) ||
        (settled && line.comboBasePrice != null),
      qtyDelivered: Number(line.qtyDelivered ?? 0),
      qtyInvoiced: Number(line.qtyInvoiced ?? 0),
      commercialLocked: !!line.comboParentId || ['discount', 'reward'].includes(String(line.lineKind)),
      ...(showMargin
        ? {
            unitCost:
              costs.get(String(line.id))?.currency === c.data.record.currency
                ? (costs.get(String(line.id))?.unitCost ?? null)
                : null,
            marginLocked:
              ['discount', 'reward'].includes(String(line.lineKind)) ||
              !line.productId ||
              !!line.comboParentId ||
              line.comboBasePrice != null ||
              costs.get(String(line.id))?.unitCost == null ||
              costs.get(String(line.id))?.currency !== c.data.record.currency,
          }
        : {}),
      name: line.name,
      taxId: line.taxId ?? '',
      taxesLocked:
        (settled && line.comboBasePrice != null) ||
        ['discount', 'reward'].includes(String(line.lineKind)) ||
        !!line.comboParentId ||
        (Array.isArray(line.taxIds) && line.taxIds.length > 1),
      productUomId: line.productUomId,
      priceAutomatic: line.priceAutomatic === true,
      priceSteps: line.priceSteps,
      priceManual: line.priceAutomatic !== true,
      priceHistory:
        settled ||
        !!line.comboParentId ||
        line.comboBasePrice != null ||
        Number(line.qtyDelivered ?? 0) > 0 ||
        Number(line.qtyInvoiced ?? 0) > 0,
      productUomQty: Number(line.productUomQty),
      priceUnit: String(line.comboBasePrice ?? line.priceUnit),
      comboParentId: line.comboParentId ? String(line.comboParentId) : null,
      comboChoiceId: line.comboChoiceId ? String(line.comboChoiceId) : null,
      discount: Number(line.discount ?? 0),
    })),
    newRows: [
      {
        label: t('action.addLine'),
        row: {
          displayType: null,
          ...(showMargin ? { unitCost: null, marginLocked: true } : {}),
          productId: null,
          name: '',
          productUomId: null,
          productUomQty: 1,
          priceUnit: null,
          priceAutomatic: true,
          discount: 0,
          taxId: '',
        },
      },
      // New lines of a quotation with history follow the saved ones: no section or note between them.
      ...(history
        ? []
        : [
            { label: t('grid.addSection'), row: { displayType: 'section', name: '', productUomQty: 0 } },
            { label: t('grid.addNote'), row: { displayType: 'note', name: '', productUomQty: 0 } },
          ]),
    ],
    removable: !history,
    reorderable: !history,
    readOnly: c.busy,
    visibleRows: 6,
    name: 'lines',
    draftFlags: ['priceAutomatic'],
    form: formId,
    // The draft's first value is the grid's own clean one: an empty default would read as an
    // edit, and the page would ask to discard it on Back.
    carry: c.draft('lines', KET_GRID_NO_CHANGES),
  }
}
export const SaleLineGrid = ({ context: c }: { context: Context }) => (
  <RecordModalForm
    kind={c.kind}
    id={formId}
    command="saveLines"
    fields={[]}
    body={
      <Stack
        items={[
          c.fieldError('lines') ? (
            <Notice title={c.t('recordModal.errorTitle')} message={c.fieldError('lines')!} tone="danger" />
          ) : null,
          recordIsland('backend.ket-grid', { id: `sale-line-grid-${c.id}`, config: saleLineGridConfig(c) }),
        ]}
      />
    }
    actions={[
      <Button type="submit" label={c.t('sale_backend.grid.save')} variant="primary" disabled={c.busy} />,
    ]}
  />
)
export const postedLineGrid = (form: FormData): unknown => {
  try {
    const parsed: unknown = JSON.parse(String(form.get('lines') ?? ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    // Learned labels are form-draft presentation metadata, never business input.
    const { optionLabels: _labels, ...changes } = parsed as Record<string, unknown>
    // Protected lookup facts are presentation-only. The writer accepts the derived price, never a posted cost,
    // and prices a line from its pricelist itself: the steps a picked product brings are for display.
    const strip = (entries: unknown) =>
      Array.isArray(entries)
        ? entries.map((entry) => {
            if (!entry || typeof entry !== 'object' || !entry.values || typeof entry.values !== 'object')
              return entry
            const {
              unitCost: _cost,
              marginLocked: _lock,
              priceManual: _manual,
              priceHistory: _history,
              priceSteps: _steps,
              ...values
            } = entry.values
            return { ...entry, values }
          })
        : entries
    return { ...changes, added: strip(changes.added), updated: strip(changes.updated) }
  } catch {
    return null
  }
}
