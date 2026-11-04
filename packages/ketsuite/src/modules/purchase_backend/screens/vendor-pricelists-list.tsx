import type { Translator } from '@ketvietlab/ketjs'
import { Badge } from '@ketvietlab/design-system'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  collectionActions,
  collectionControls,
  collectionTable,
  Disclosure,
  emptyState,
  formatMoney,
  inline,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { Column, DataTable, FormField, Frame } from '../../../ui/index.ts'
import { formatDateTime } from '../../../ui/format.ts'
import { missingSetup, rejection } from './shared.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { VendorPricelistHelp } from './vendor-pricelist-help.tsx'
import type { SupplierValidity } from '../../purchase/supplier-validity.ts'

export type VendorPricelistRow = {
  id: string
  partnerId: string
  partnerName?: string | null
  productTemplateId: string
  productNameDisplay?: string | null
  minQty: string | number
  price: string | number
  discount: string | number
  delay: string | number
  dateStart?: string | null
  dateEnd?: string | null
  /** The validity in the company's calendar, as `purchase.listSupplierInfo` answers: inclusive days, null when open. */
  validFrom?: string | null
  validUntil?: string | null
  /** Whether the price applies today in that calendar. */
  validity?: SupplierValidity
}

const VALIDITY_TONES = { current: 'positive', upcoming: 'info', expired: 'danger' } as const

export type VendorPricelistsListScreenOptions = {
  frame: Frame
  rows: VendorPricelistRow[]
  methodFields: FormField[]
  /** Locale-aware list and policy POST endpoint. */
  action: string
  /** Locale-aware `/admin/purchase/vendor-pricelists/new` URL. */
  createHref: string | null
  canSetMethod?: boolean
  currency?: unknown
  invalid?: string | null
  setup?: { pickingTypes: number; vendors: number }
  table?: Partial<DataTable<VendorPricelistRow>>
}

/** A validity day (YYYY-MM-DD) as the viewer writes dates. */
const shortDay = (_: Translator, value: string) =>
  formatDateTime(_.locale, new Date(`${value}T00:00:00Z`), { dateStyle: 'short', timeZone: 'UTC' })

const validityRange = (_: Translator, row: VendorPricelistRow): string => {
  const start = row.validFrom
  const end = row.validUntil
  if (start && end) return `${shortDay(_, start)} – ${shortDay(_, end)}`
  if (start) return `${_('purchase_backend.validity.from')} ${shortDay(_, start)}`
  if (end) return `${_('purchase_backend.validity.until')} ${shortDay(_, end)}`
  return _('purchase_backend.validity.always')
}

export const vendorPricelistColumns = (
  _: Translator,
  currency?: unknown,
): Array<Column<VendorPricelistRow>> => [
  {
    key: 'vendor',
    label: _('purchase_backend.field.vendor'),
    cell: (row) => String(row.partnerName ?? row.partnerId),
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'product',
    label: _('purchase_backend.field.product'),
    cell: (row) => String(row.productNameDisplay ?? row.productTemplateId),
    priority: 'secondary',
  },
  {
    key: 'min',
    label: _('purchase_backend.field.minQty'),
    cell: (row) => String(row.minQty),
    kind: 'number',
  },
  {
    key: 'price',
    label: _('purchase_backend.field.priceUnit'),
    cell: (row) => formatMoney(_, row.price, currency),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'discount',
    label: _('purchase_backend.field.discount'),
    cell: (row) => `${String(row.discount)}%`,
    kind: 'number',
  },
  {
    key: 'delay',
    label: _('purchase_backend.field.delay'),
    cell: (row) => String(row.delay),
    kind: 'number',
  },
  {
    key: 'validity',
    label: _('purchase_backend.field.validity'),
    cell: (row) => {
      const state = row.validity ?? 'current'
      return inline([
        <Badge label={_(`purchase_backend.validity.${state}`)} tone={VALIDITY_TONES[state]} value={state} />,
        validityRange(_, row),
      ])
    },
    kind: 'status',
  },
]

export const vendorPricelistsListScreen = (
  _: Translator,
  options: VendorPricelistsListScreenOptions,
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    options.frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      columns: vendorPricelistColumns(_, options.currency),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  const table =
    options.rows.length || options.table?.groups?.length
      ? collectionTable(_, collection.table)
      : options.setup && (!options.setup.vendors || !options.setup.pickingTypes)
        ? null
        : emptyState(_('purchase_backend.empty'), _('purchase_backend.emptyHint'))
  const lang = _.locale === 'en' ? 'en' : 'vi'

  return shell(
    _,
    _('purchase_backend.pricelists.title'),
    <>
      <ListPage
        variant="operational"
        frame={collection.frame}
        title={_('purchase_backend.pricelists.title')}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('purchase_backend.action.addVendorPrice')}
              href={options.createHref}
              variant="primary"
            />
          ) : undefined
        }
        actions={collectionActions(_, collection.frame)}
        controls={collectionControls(_, _('purchase_backend.pricelists.title'), collection.frame)}
        footer={`${_('purchase_backend.dashboard.records')}: ${String(options.rows.length)}`}
        body={stack(
          [
            rejection(_, options.invalid),
            options.setup ? missingSetup(_, options.setup) : null,
            options.canSetMethod ? (
              <Disclosure
                summary={_('purchase_backend.method.title')}
                body={
                  <Section
                    title={_('purchase_backend.method.title')}
                    body={
                      <Surface
                        body={
                          <RecordForm
                            action={options.action}
                            submit={_('purchase_backend.action.saveMethod')}
                            submitVariant="primary"
                            hidden={{ action: 'method' }}
                            fields={options.methodFields}
                          />
                        }
                      />
                    }
                  />
                }
              />
            ) : null,
            table,
          ],
          'loose',
        )}
      />
      <VendorPricelistHelp lang={lang} />
    </>,
    {
      ...collection.frame,
      chrome: null,
      topbar: false,
      ...(collection.frame.applications
        ? { applications: { ...collection.frame.applications, helpLabel: HELP[lang].trigger } }
        : {}),
    },
  )
}
