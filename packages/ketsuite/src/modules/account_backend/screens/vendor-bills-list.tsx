import type { Translator } from '@ketvietlab/ketjs'
import { Badge } from '@ketvietlab/design-system'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  formatMoney,
  icon,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { labelOf, moveTitle } from './shared.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { VendorBillHelp } from './vendor-bill-help.tsx'

export type VendorBillListRow = Record<string, unknown>

export type VendorBillListSummary = {
  total: number
  draft: number
  posted: number
  unpaid: number
}

export type VendorBillsListScreenOptions = {
  frame: Frame
  rows: VendorBillListRow[]
  createHref: string
  rowHref: (row: VendorBillListRow) => string
  partnerLabel: (row: VendorBillListRow) => string
  summary: VendorBillListSummary
  /** Each shown bill's purchase order matching, when Purchasing is composed and readable (#1737). */
  matches?: ReadonlyMap<string, VendorBillMatchState>
  table?: Partial<DataTable<VendorBillListRow>>
}

export type VendorBillMatchState = { status: 'none' | 'ok' | 'mismatch'; held: boolean }

const matchCell = (_: Translator, state: VendorBillMatchState | undefined) =>
  state?.held ? (
    <Badge label={_('account_backend.billMatch.held')} tone="warning" value="held" />
  ) : state?.status === 'mismatch' ? (
    <Badge label={_('account_backend.billMatch.mismatch')} tone="danger" value="mismatch" />
  ) : state?.status === 'ok' ? (
    <Badge label={_('account_backend.billMatch.matched')} tone="positive" value="ok" />
  ) : (
    '—'
  )

const paymentTone = (state: unknown) => {
  if (state === 'paid') return 'positive' as const
  if (state === 'partial') return 'warning' as const
  return 'neutral' as const
}

export const vendorBillListColumns = (
  _: Translator,
  partnerLabel: (row: VendorBillListRow) => string,
  matches?: ReadonlyMap<string, VendorBillMatchState>,
) => [
  {
    key: 'name',
    label: _('account_backend.field.name'),
    priority: 'primary' as const,
    width: 'wide' as const,
    cell: (row: VendorBillListRow) => moveTitle(_, row),
  },
  {
    key: 'partner',
    label: _('account_backend.field.partnerId'),
    width: 'wide' as const,
    cell: partnerLabel,
  },
  {
    key: 'date',
    label: _('account_backend.field.date'),
    cell: (row: VendorBillListRow) => String(row.accountingDate ?? row.date).slice(0, 10),
  },
  {
    key: 'type',
    label: _('account_backend.field.moveType'),
    cell: (row: VendorBillListRow) => labelOf(_, 'moveType', row.moveType),
  },
  {
    key: 'state',
    label: _('account_backend.field.state'),
    kind: 'status' as const,
    cell: (row: VendorBillListRow) =>
      badge(
        labelOf(_, 'moveState', row.state),
        row.state === 'posted' ? 'positive' : 'neutral',
        String(row.state),
      ),
  },
  {
    key: 'payment',
    label: _('account_backend.field.paymentState'),
    kind: 'status' as const,
    cell: (row: VendorBillListRow) =>
      badge(
        labelOf(_, 'paymentState', row.paymentState),
        paymentTone(row.paymentState),
        String(row.paymentState),
      ),
  },
  ...(matches
    ? [
        {
          key: 'matching',
          label: _('account_backend.billMatch.column'),
          kind: 'status' as const,
          cell: (row: VendorBillListRow) => matchCell(_, matches.get(String(row.id))),
        },
      ]
    : []),
  {
    key: 'total',
    label: _('account_backend.field.amountTotal'),
    cell: (row: VendorBillListRow) => formatMoney(_, row.amountTotal, row.currency),
    align: 'end' as const,
    kind: 'currency' as const,
  },
]

export const vendorBillsListScreen = (
  _: Translator,
  options: VendorBillsListScreenOptions,
): TemplateResult => {
  const status = [
    `${_('account_backend.vendorBill.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.vendorBill.summary.draft')}: ${String(options.summary.draft)}`,
    `${_('account_backend.vendorBill.summary.posted')}: ${String(options.summary.posted)}`,
    `${_('account_backend.vendorBill.summary.unpaid')}: ${String(options.summary.unpaid)}`,
  ].join(' · ')
  const collection = prepareCollectionTable(_, options.frame, {
    rows: options.rows,
    id: (row) => String(row.id),
    rowHref: options.rowHref,
    columns: vendorBillListColumns(_, options.partnerLabel, options.matches),
    ...options.table,
  })
  const table =
    options.rows.length || options.table?.groups?.length ? (
      collectionTable(_, collection.table)
    ) : (
      <Surface
        padding="compact"
        body={emptyState(_('account_backend.vendorBill.empty'), _('account_backend.vendorBill.emptyHint'), {
          icon: icon('banknote'),
        })}
      />
    )

  const lang = _.locale === 'en' ? 'en' : 'vi'
  return shell(
    _,
    _('account_backend.vendorBills.title'),
    <>
      <ListPage
        variant="operational"
        frame={collection.frame}
        title={_('account_backend.vendorBills.title')}
        headerActions={
          <LinkButton
            label={_('account_backend.action.create')}
            href={options.createHref}
            variant="primary"
          />
        }
        actions={collectionActions(_, collection.frame)}
        controls={collectionControls(_, _('account_backend.vendorBills.title'), collection.frame)}
        footer={status}
        body={table}
      />
      <VendorBillHelp lang={lang} />
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
