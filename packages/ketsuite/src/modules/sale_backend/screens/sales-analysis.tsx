import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  code,
  collectionTable,
  designSystem,
  emptyState,
  formatMoney,
  icon,
  ListPage,
  prepareCollectionTable,
  shell,
} from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'
import { SalesAnalysisHelp } from './sales-analysis-help.tsx'

/** One variant's sales in the window; revenue is null for a reader without money. */
export type SalesAnalysisRow = {
  id: string
  variant: string
  code: string
  quantity: number
  revenue: number | null
  orders: number
  lastAt: string | null
  /** The orders that sold it. */
  href: string
}

export type SalesAnalysisOptions = {
  /** Null when the page was opened without a product it can read. */
  product: { name: string; href: string | null } | null
  days: number
  rows: SalesAnalysisRow[]
  /** Whether the reader may see revenue (the product's money rule, P16). */
  money: boolean
  lang: 'vi' | 'en'
}

const quantity = (_: Translator, value: number): string =>
  new Intl.NumberFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 3 }).format(value)

const columns = (_: Translator, money: boolean): Array<Column<SalesAnalysisRow>> => [
  {
    key: 'variant',
    label: _('sale_backend.analysis.col.variant'),
    cell: (row) => row.variant,
    priority: 'primary',
  },
  {
    key: 'code',
    label: _('sale_backend.analysis.col.code'),
    cell: (row) => (row.code ? code(row.code, 'identifier') : '—'),
    priority: 'secondary',
  },
  {
    key: 'quantity',
    label: _('sale_backend.analysis.col.quantity'),
    cell: (row) => quantity(_, row.quantity),
    kind: 'number',
    align: 'end',
  },
  ...(money
    ? [
        {
          key: 'revenue',
          label: _('sale_backend.analysis.col.revenue'),
          cell: (row: SalesAnalysisRow) => formatMoney(_, row.revenue, 'VND'),
          kind: 'number' as const,
          align: 'end' as const,
        },
      ]
    : []),
  {
    key: 'orders',
    label: _('sale_backend.analysis.col.orders'),
    cell: (row) => String(row.orders),
    kind: 'number',
    align: 'end',
  },
  {
    key: 'lastAt',
    label: _('sale_backend.analysis.col.lastAt'),
    cell: (row) => (row.lastAt ? row.lastAt.slice(0, 10) : '—'),
    priority: 'secondary',
  },
]

/**
 * What one product sold, a row per variant (P32): the Sold card on the product page
 * opens it. Each row opens the orders
 * that sold that variant.
 */
export const salesAnalysisScreen = (
  _: Translator,
  options: SalesAnalysisOptions,
  frame: Frame,
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    {
      columns: columns(_, options.money),
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.href,
    },
    { paginate: false },
  )
  const body = !options.product
    ? emptyState(_('sale_backend.analysis.missing'), _('sale_backend.analysis.missingHint'), {
        icon: icon('package'),
      })
    : options.rows.length
      ? collectionTable(_, collection.table)
      : emptyState(_('sale_backend.analysis.empty'), _('sale_backend.analysis.emptyHint'), {
          icon: icon('shopping-bag'),
        })
  return shell(
    _,
    _('sale_backend.analysis.title'),
    <>
      <ListPage
        variant="operational"
        frame={collection.frame}
        title={_('sale_backend.analysis.title')}
        headerActions={
          options.product?.href ? (
            <designSystem.LinkButton
              href={options.product.href}
              label={_('sale_backend.analysis.back')}
              variant="secondary"
            />
          ) : null
        }
        controls={
          options.product
            ? _('sale_backend.analysis.context', {
                product: options.product.name,
                days: String(options.days),
              })
            : null
        }
        body={body}
      />
      <SalesAnalysisHelp lang={options.lang} />
    </>,
    { ...collection.frame, chrome: null, topbar: false },
  )
}
