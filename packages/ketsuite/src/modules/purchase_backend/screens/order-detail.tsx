import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  FormCluster,
  FormPage,
  formatMoney,
  inline,
  linkButton,
  RecordActions,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { ActionVariant, FormField, Frame } from '../../../ui/index.ts'
import { formatDateTime } from '../../../ui/format.ts'
import { PurchaseOrderHelp } from './order-help.tsx'
import { labelOf, purchaseOrderPath, rejection } from './shared.tsx'

type PurchaseDetailRow = Record<string, unknown>

export type PurchaseOrderDetail = PurchaseDetailRow & {
  id?: unknown
  name?: unknown
  state?: unknown
  locked?: unknown
  partnerId?: unknown
  partnerName?: unknown
  datePlanned?: unknown
  invoiceStatus?: unknown
  amountTotal?: unknown
  currency?: unknown
  lines?: PurchaseDetailRow[]
  moves?: PurchaseDetailRow[]
  bills?: PurchaseDetailRow[]
}

export type PurchaseOrderDetailScreenOptions = {
  frame: Frame
  order: PurchaseOrderDetail
  actionPath?: string
  /** The order's record modal, where an open RFQ's lines are edited in one grid; null when it may not open. */
  linesHref?: string | null
  billFields: FormField[]
  printActions?: JSXChild
  invalid?: string | null
  /** Picks the page guide's language. */
  lang?: 'vi' | 'en'
  /** The company's timezone, which the planned date is read in, as in the record modal. */
  timezone?: string
}

type PurchaseOrderAction = {
  value: string
  label: string
  variant?: ActionVariant
}

const detailActions = (_: Translator, order: PurchaseOrderDetail): PurchaseOrderAction[] => {
  const state = String(order.state)
  const actions: PurchaseOrderAction[] = []
  if (state === 'draft') actions.push({ value: 'send', label: _('purchase_backend.action.send') })
  if (['draft', 'sent'].includes(state)) {
    actions.push({ value: 'confirm', label: _('purchase_backend.action.confirm'), variant: 'primary' })
    actions.push({ value: 'request-approval', label: _('purchase_backend.action.requestApproval') })
  }
  if (state === 'to approve')
    actions.push({ value: 'approve', label: _('purchase_backend.action.approve'), variant: 'primary' })
  // Approving is not the only answer to a request under review, and refusing it
  // should not mean destroying it.
  if (['sent', 'to approve'].includes(state))
    actions.push({ value: 'reset', label: _('purchase_backend.action.resetToDraft') })
  if (state === 'purchase') {
    actions.push({ value: 'sync', label: _('purchase_backend.action.syncReceipts'), variant: 'primary' })
    actions.push({
      value: order.locked ? 'unlock' : 'lock',
      label: order.locked ? _('purchase_backend.action.unlock') : _('purchase_backend.action.lock'),
    })
  }
  // A locked order refuses cancellation, so offering the button only produced a
  // rejection notice.
  if (state !== 'cancel' && !order.locked)
    actions.push({ value: 'cancel', label: _('purchase_backend.action.cancel'), variant: 'destructive' })
  return actions
}

const stateTone = (state: string) =>
  state === 'purchase' || state === 'done'
    ? 'positive'
    : state === 'cancel'
      ? 'danger'
      : state === 'to approve'
        ? 'warning'
        : state === 'sent'
          ? 'info'
          : 'neutral'

// The lines read here; they are edited in the order's line grid (DS: no form controls in a table).
const lineTable = (_: Translator, options: PurchaseOrderDetailScreenOptions): TemplateResult => {
  const lines = options.order.lines ?? []
  return lines.length
    ? dataTable(_, {
        rows: lines,
        id: (row) => String(row.id),
        columns: [
          {
            key: 'name',
            label: _('purchase_backend.field.product'),
            cell: (row) => String(row.name),
            priority: 'primary',
          },
          {
            key: 'ordered',
            label: _('purchase_backend.field.productQty'),
            cell: (row) => String(row.productQty),
          },
          {
            key: 'received',
            label: _('purchase_backend.field.qtyReceived'),
            cell: (row) => String(row.qtyReceived),
          },
          {
            key: 'billed',
            label: _('purchase_backend.field.qtyInvoiced'),
            cell: (row) => String(row.qtyInvoiced),
          },
          {
            key: 'price',
            label: _('purchase_backend.field.priceUnit'),
            cell: (row) => formatMoney(_, row.priceUnit, options.order.currency),
            align: 'end',
            kind: 'currency',
          },
          {
            key: 'subtotal',
            label: _('purchase_backend.field.subtotal'),
            cell: (row) => formatMoney(_, row.priceSubtotal, options.order.currency),
            align: 'end',
            kind: 'currency',
          },
        ],
      })
    : emptyState(_('purchase_backend.lines.empty'), _('purchase_backend.lines.emptyHint'))
}

const receiptTable = (_: Translator, rows: PurchaseDetailRow[]): TemplateResult =>
  dataTable(_, {
    rows,
    id: (row) => String(row.id),
    columns: [
      {
        key: 'origin',
        label: _('purchase_backend.field.name'),
        cell: (row) =>
          linkButton({
            label: String(row.origin ?? row.id),
            href: `/admin/stock/transfers/${String(row.pickingId)}`,
            variant: 'tertiary',
          }),
        priority: 'primary',
      },
      {
        key: 'state',
        label: _('purchase_backend.field.state'),
        cell: (row) => badge(labelOf(_, 'moveState', row.state), 'neutral'),
      },
      {
        key: 'quantity',
        label: _('purchase_backend.field.qtyReceived'),
        cell: (row) => String(row.quantity),
      },
    ],
  })

const billTable = (_: Translator, rows: PurchaseDetailRow[], orderCurrency: unknown): TemplateResult =>
  dataTable(_, {
    rows,
    id: (row) => String(row.id),
    columns: [
      {
        key: 'name',
        label: _('purchase_backend.field.name'),
        cell: (row) =>
          linkButton({
            label: String(row.name),
            href: `/admin/accounting/vendor-bills/${String(row.id)}`,
            variant: 'tertiary',
          }),
        priority: 'primary',
      },
      {
        key: 'state',
        label: _('purchase_backend.field.state'),
        cell: (row) => badge(labelOf(_, 'billState', row.state), 'neutral'),
      },
      {
        key: 'total',
        label: _('purchase_backend.field.amountTotal'),
        cell: (row) => formatMoney(_, row.amountTotal, row.currency ?? orderCurrency),
        align: 'end',
        kind: 'currency',
      },
    ],
  })

export const purchaseOrderDetailScreen = (
  _: Translator,
  options: PurchaseOrderDetailScreenOptions,
): TemplateResult => {
  const { order } = options
  const path = options.actionPath ?? purchaseOrderPath(order)
  const state = String(order.state)
  const editable = ['draft', 'sent'].includes(state) && !order.locked
  const actions = detailActions(_, order)
  const headerActions: JSXChild[] = [
    ...(actions.length
      ? [<RecordActions action={path} label={_('purchase_backend.detail.title')} actions={actions} />]
      : []),
    ...(options.printActions === undefined ? [] : [options.printActions]),
  ]
  // Who the order is with and when it is due: the record's identity, in its facts strip.
  const identity = [
    String(order.partnerName ?? order.partnerId),
    order.datePlanned
      ? `${_('purchase_backend.field.datePlanned')}: ${formatDateTime(
          _.locale,
          new Date(String(order.datePlanned)),
          {
            dateStyle: 'medium',
            ...(options.timezone ? { timeZone: options.timezone } : {}),
          },
        )}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const moves = order.moves ?? []
  const bills = order.bills ?? []
  const page = (
    <FormPage
      variant="operational"
      frame={options.frame}
      scope="purchase-order-form-page"
      title={String(order.name)}
      status={badge(labelOf(_, 'state', state), stateTone(state), state)}
      actions={
        headerActions.length ? (
          <FormCluster label={_('purchase_backend.detail.title')} forms={headerActions} />
        ) : undefined
      }
      meta={inline([
        identity,
        badge(
          `${_('purchase_backend.field.invoiceStatus')}: ${labelOf(_, 'invoiceStatus', order.invoiceStatus)}`,
          order.invoiceStatus === 'to invoice' ? 'warning' : 'neutral',
        ),
        badge(
          `${_('purchase_backend.field.amountTotal')}: ${formatMoney(_, order.amountTotal, order.currency)}`,
          'info',
        ),
      ])}
      body={stack(
        [
          rejection(_, options.invalid),
          <Section
            title={_('purchase_backend.lines.title')}
            actions={
              editable && options.linesHref
                ? linkButton({
                    label: _('purchase_backend.lines.editInGrid'),
                    href: options.linesHref,
                    variant: 'secondary',
                  })
                : undefined
            }
            body={lineTable(_, options)}
          />,
          state === 'purchase' && order.invoiceStatus === 'to invoice' ? (
            <Section
              title={_('purchase_backend.bill.title')}
              body={
                <Surface
                  body={
                    <RecordForm
                      action={path}
                      submit={_('purchase_backend.action.createBill')}
                      submitVariant="primary"
                      hidden={{ action: 'bill' }}
                      fields={options.billFields}
                    />
                  }
                />
              }
            />
          ) : null,
          moves.length ? (
            <Section title={_('purchase_backend.receipts.title')} body={receiptTable(_, moves)} />
          ) : null,
          bills.length ? (
            <Section title={_('purchase_backend.bills.title')} body={billTable(_, bills, order.currency)} />
          ) : null,
        ],
        'loose',
      )}
      slots={{ header: 'purchase.order-header', body: 'purchase.order-body' }}
    />
  )

  return shell(
    _,
    String(order.name),
    <>
      {page}
      <PurchaseOrderHelp lang={options.lang ?? 'vi'} />
    </>,
    { ...options.frame, topbar: false, titled: false },
  )
}
