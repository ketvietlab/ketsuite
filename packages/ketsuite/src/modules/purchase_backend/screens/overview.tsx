import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  CardGrid,
  WorkspacePage,
  linkButton,
  Metric,
  shell,
  stack,
  Section,
  dataTable,
  emptyState,
  formatMoney,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import { PurchaseOverviewHelp } from './overview-help.tsx'
import { missingSetup } from './shared.tsx'

/** The two order facts that feed the purchase workflow counters. */
export type PurchaseOverviewOrder = {
  state?: unknown
  id?: unknown
  name?: unknown
  partnerName?: unknown
  invoiceStatus?: unknown
  /** Set on a request a stock reorder rule drafted (#1737). */
  replenishmentGroup?: unknown
  /** The warehouse its receipt delivers to. */
  warehouseName?: unknown
  amountTotal?: unknown
  currency?: unknown
}

/** Requests from reorder rules that nobody has confirmed yet. */
const DEMAND_STATES = ['draft', 'sent', 'to approve']

export type PurchaseOverviewSetup = {
  pickingTypes: number
  vendors: number
  createHref?: string | null
  rowHref?: (row: PurchaseOverviewOrder) => string
}

/**
 * The purchase landing page is a specialized workflow overview, not a record
 * list or an editing form: each card is a distinct operational queue and the
 * primary action hands the reader to the RFQ task surface.
 */
export const purchaseOverviewScreen = (
  _: Translator,
  orders: PurchaseOverviewOrder[],
  frame: Frame,
  locale = '',
  setup?: PurchaseOverviewSetup,
): TemplateResult => {
  const count = (states: string[]) => orders.filter((row) => states.includes(String(row.state))).length
  const demands = orders.filter((row) => row.replenishmentGroup && DEMAND_STATES.includes(String(row.state)))
  const lang = _.locale === 'en' ? 'en' : 'vi'
  return shell(
    _,
    _('purchase_backend.dashboard.title'),
    <>
      <WorkspacePage
        variant="operational"
        frame={frame}
        title={_('purchase_backend.dashboard.title')}
        actions={
          setup?.createHref
            ? linkButton({
                label: _('purchase_backend.action.createRfq'),
                href: setup.createHref,
                variant: 'primary',
              })
            : undefined
        }
        body={stack([
          setup ? missingSetup(_, setup) : null,
          <CardGrid
            items={[
              {
                id: 'draft',
                title: _('purchase_backend.dashboard.toSend'),
                value: count(['draft']),
                href: localized('/admin/purchase/rfqs?preset=draft', locale),
              },
              {
                id: 'waiting',
                title: _('purchase_backend.dashboard.waiting'),
                value: count(['sent']),
                href: localized('/admin/purchase/rfqs?preset=sent', locale),
              },
              {
                id: 'approval',
                title: _('purchase_backend.dashboard.toApprove'),
                value: count(['to approve']),
                href: localized('/admin/purchase/rfqs?preset=to-approve', locale),
              },
              {
                id: 'orders',
                title: _('purchase_backend.menu.orders'),
                value: count(['purchase']),
                href: localized('/admin/purchase/orders', locale),
              },
              {
                id: 'bill',
                title: _('purchase_backend.dashboard.toBill'),
                value: orders.filter((row) => row.invoiceStatus === 'to invoice').length,
                href: localized('/admin/purchase/orders?preset=to-invoice', locale),
              },
            ]}
            id={(item) => item.id}
            card={(item) => <Metric label={item.title} value={String(item.value)} href={item.href} />}
          />,
          <Section
            title={_('purchase_backend.dashboard.approvalQueue')}
            body={
              orders.some((row) => row.state === 'to approve')
                ? dataTable(_, {
                    rows: orders.filter((row) => row.state === 'to approve').slice(0, 10),
                    id: (row) => String(row.id),
                    rowHref: setup?.rowHref,
                    columns: [
                      {
                        key: 'name',
                        label: _('purchase_backend.field.name'),
                        cell: (row) => String(row.name),
                      },
                      {
                        key: 'partner',
                        label: _('purchase_backend.field.vendor'),
                        cell: (row) => String(row.partnerName ?? '—'),
                      },
                    ],
                  })
                : emptyState(_('purchase_backend.dashboard.queueEmpty'), '')
            }
          />,
          <Section
            title={_('purchase_backend.dashboard.replenishment')}
            body={
              demands.length
                ? dataTable(_, {
                    rows: demands.slice(0, 20),
                    id: (row) => String(row.id),
                    rowHref: setup?.rowHref,
                    columns: [
                      {
                        key: 'name',
                        label: _('purchase_backend.field.name'),
                        cell: (row) => String(row.name),
                        priority: 'primary',
                      },
                      {
                        key: 'partner',
                        label: _('purchase_backend.field.vendor'),
                        cell: (row) => String(row.partnerName ?? '—'),
                      },
                      {
                        key: 'warehouse',
                        label: _('purchase_backend.dashboard.warehouse'),
                        cell: (row) => String(row.warehouseName ?? '—'),
                      },
                      {
                        key: 'total',
                        label: _('purchase_backend.field.amountTotal'),
                        cell: (row) => formatMoney(_, row.amountTotal, row.currency),
                        align: 'end',
                        kind: 'currency',
                      },
                      {
                        key: 'state',
                        label: _('purchase_backend.field.state'),
                        cell: (row) => _(`purchase_backend.state.${String(row.state)}`),
                        kind: 'status',
                      },
                    ],
                  })
                : emptyState(
                    _('purchase_backend.dashboard.replenishmentEmpty'),
                    _('purchase_backend.dashboard.replenishmentHint'),
                  )
            }
          />,
        ])}
      />
      <PurchaseOverviewHelp lang={lang} />
    </>,
    { ...frame, topbar: false },
  )
}
