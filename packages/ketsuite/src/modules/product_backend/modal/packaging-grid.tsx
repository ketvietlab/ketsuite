import { LinkButton, Notice, Section } from '@ketvietlab/design-system'
import type { KetGridIslandConfig, KetGridPosted } from '@ketvietlab/design-system'
import type { PackagingGridData } from '../../product/packaging-grid.ts'
import { recordIsland, type RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import type { TemplateModalData } from './product-modal-view.tsx'
export type { PackagingGridData }
type Context = RecordModalContext<TemplateModalData>
const emptyChanges = JSON.stringify({
  added: [],
  updated: [],
  removed: [],
  order: null,
} satisfies KetGridPosted)
const lockField = '_sharedBarcodeLocked'

export function packagingGridConfig(c: Context, formId: string): KetGridIslandConfig {
  const data = c.data.packagingGrid!
  const t = (key: string) => c.t(`product_backend.ws.${key}`)
  const format = new Intl.NumberFormat(c.data.lang, { maximumFractionDigits: 3 })
  const variants = [
    { value: '*', label: t('allVariants') },
    ...(c.data.variants ?? []).map((row) => ({ value: row.id, label: row.label })),
  ]
  return {
    label: t('packagings'),
    ...ketGridLocale(c.data.lang),
    columns: [
      {
        key: 'uomId',
        label: t('packagingUnit'),
        type: 'combobox',
        editable: true,
        required: true,
        width: 240,
        options: data.units.map((unit) => ({
          value: unit.value,
          label: `${unit.label} · ${format.format(unit.quantity)} ${c.data.uomName ?? ''}`.trim(),
        })),
      },
      ...(!data.singleProductId
        ? [
            {
              key: 'productId',
              label: t('supplierVariant'),
              type: 'combobox' as const,
              editable: true,
              required: true,
              width: 220,
              options: variants,
              sets: Object.fromEntries(
                variants.map((option) => [
                  option.value,
                  {
                    [lockField]: option.value === '*',
                    ...(option.value === '*' ? { barcode: '' } : {}),
                  },
                ]),
              ),
            },
          ]
        : []),
      {
        key: 'barcode',
        label: t('packagingBarcode'),
        type: 'text',
        editable: true,
        width: 180,
        lockedBy: lockField,
      },
    ],
    rows: data.rows.map((row) => ({ ...row, [lockField]: !data.singleProductId && row.productId === '*' })),
    newRow: { uomId: '', productId: '*', barcode: '', [lockField]: !data.singleProductId },
    removable: data.editable,
    reorderable: data.editable,
    readOnly: c.busy || !data.editable,
    visibleRows: 6,
    name: 'packagingChanges',
    form: formId,
    carry: c.draft('packagingChanges', emptyChanges),
  }
}

export function ProductPackagingGrid({ context: c, formId }: { context: Context; formId: string }) {
  return (
    <Section
      title={c.t('product_backend.ws.packagings')}
      actions={
        c.data.links?.uoms ? (
          <LinkButton
            label={c.t('product_backend.ws.manageUoms')}
            href={c.data.links.uoms}
            variant="tertiary"
          />
        ) : undefined
      }
      description={c.t('product_backend.ws.packagingGridHelp')}
      body={[
        c.data.packagingGrid!.legacyOverlap ? (
          <Notice
            tone="info"
            title={c.t('product_backend.ws.packagingLegacyTitle')}
            message={c.t('product_backend.ws.packagingLegacyHelp')}
          />
        ) : null,
        c.fieldError('packagings') ? (
          <Notice
            tone="danger"
            title={c.t('product_backend.ws.packagings')}
            actions={
              c.data.links?.uoms ? (
                <LinkButton
                  label={c.t('product_backend.ws.manageUoms')}
                  href={c.data.links.uoms}
                  variant="tertiary"
                />
              ) : undefined
            }
            message={c.fieldError('packagings')!}
          />
        ) : null,
        recordIsland('backend.ket-grid', {
          id: `product-packaging-grid-${c.id}`,
          config: packagingGridConfig(c, formId),
        }),
      ]}
    />
  )
}

/** Transport-only labels/locks never become domain input. Scope rules remain server-owned. */
export function packagingGridInput(form: FormData, c: Context): { packagings?: unknown } {
  if (!c.data.packagingGrid?.editable || !form.has('packagingChanges')) return {}
  try {
    const parsed = JSON.parse(String(form.get('packagingChanges') ?? ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { packagings: null }
    const { optionLabels: _labels, ...changes } = parsed
    for (const key of ['added', 'updated'])
      if (Array.isArray(changes[key]))
        for (const entry of changes[key]) if (entry?.values) delete entry.values[lockField]
    if (
      ['added', 'updated', 'removed'].every(
        (key) => Array.isArray(changes[key]) && changes[key].length === 0,
      ) &&
      changes.order === null
    )
      return {}
    return { packagings: changes }
  } catch {
    return { packagings: null }
  }
}
