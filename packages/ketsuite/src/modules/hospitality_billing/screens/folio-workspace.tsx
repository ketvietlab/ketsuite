import type { FieldProps } from '@ketvietlab/design-system'
import { randomUUID } from 'node:crypto'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import {
  ActionGroup,
  Dialog,
  EmptyState,
  KetTable,
  LinkButton,
  Notice,
  RecordForm,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import { DefinitionList, formatMoney } from '../../../ui/index.ts'
import { compareDecimals } from '../../account/money.ts'
import { hospitalityScopedHref } from '../../hospitality_core/screens/scoped-href.ts'

type Item = Record<string, unknown>
type Folio = { id: string; code: string; state: string; version: number; partner?: { name?: string } | null }

/** Optional billing composition: core remains usable without the Accounting module or its grants. */
export async function loadFolioFinancialWorkspace(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  folio: Folio,
  errors: readonly string[] = [],
  draft: Record<string, string | undefined> = {},
) {
  if (!(await ctx.allows('hospitality_billing.getFolioBilling', url, req))) return null
  const data = (await ctx.call(
    'hospitality_billing.getFolioBilling',
    { folioId: folio.id },
    url,
    req,
  )) as Item | null
  if (!data) return null
  const _ = ctx.translate(ctx.localeOf(url, req)),
    t = (key: string) => _(`hospitality_billing.workspace.${key}`)
  const [canInvoice, canPay] = await Promise.all([
    ctx.allows('hospitality_billing.invoiceFolio', url, req),
    ctx.allows('hospitality_billing.recordFolioPayment', url, req),
  ])
  const base = new URL(url)
  for (const key of ['action', 'status', 'finance']) base.searchParams.delete(key)
  const here = (step?: string) => {
    const next = new URL(base)
    if (step) next.searchParams.set('finance', step)
    return next.pathname + next.search
  }
  const journals = data.journals as Item[],
    payments = data.payments as Item[],
    blockers = data.blockers as Item[],
    buyer = data.buyer as Item | null
  const balance = String(data.balance ?? data.amountDue ?? '0'),
    step = url.searchParams.get('finance') ?? url.searchParams.get('action'),
    key = draft.requestKey || randomUUID()
  const hidden = {
    folioId: folio.id,
    expectedVersion: String(data.version ?? folio.version),
    requestKey: key,
  }
  const value = (name: string, fallback = '') => draft[name] ?? fallback
  const invalid = new Set((draft._invalid ?? '').split(','))
  const field = (props: FieldProps): FieldProps => ({
    ...props,
    error: invalid.has(props.name ?? '') ? (errors[0] ?? '') : undefined,
  })
  const operations = []
  if (canInvoice && !data.moveId && folio.state === 'closed')
    operations.push(<LinkButton href={here('invoice')} label={t('invoice')} variant="primary" />)
  if (
    data.balanceKnown !== false &&
    canPay &&
    folio.state !== 'cancelled' &&
    compareDecimals(balance, '0') > 0
  )
    operations.push(
      <LinkButton
        href={here('payment')}
        label={t(data.moveId ? 'payment' : 'advance')}
        variant={folio.state === 'open' || data.moveId ? 'primary' : 'secondary'}
      />,
    )
  const feedback = ['paid', 'invoiced'].includes(url.searchParams.get('status') ?? '') ? (
    <Notice tone="positive" title={t('title')} message={t(url.searchParams.get('status')!)} />
  ) : null
  const money = (
    <Section
      title={t('title')}
      actions={<ActionGroup actions={operations} />}
      body={
        <Stack
          items={[
            <DefinitionList
              title={t('title')}
              items={[
                {
                  key: 'invoice',
                  term: t('invoice'),
                  value: data.moveName ? String(data.moveName) : t('notInvoiced'),
                },
                { key: 'paid', term: t('received'), value: formatMoney(_, String(data.paid ?? '0')) },
                {
                  key: 'balance',
                  term: t('balance'),
                  value: data.balanceKnown === false ? '—' : formatMoney(_, balance),
                },
                {
                  key: 'buyer',
                  term: t('buyer'),
                  value: buyer?.name ? `${buyer.name}${buyer.taxCode ? ` · ${buyer.taxCode}` : ''}` : '—',
                },
              ]}
            />,
            data.balanceKnown === false ? (
              <Notice tone="warning" title={t('unknownBalance')} message={t('unknownBalanceHint')} />
            ) : null,
            !data.moveId ? <Notice tone="info" title={t('advanceHint')} message={t('ledgerHint')} /> : null,
            blockers.length && folio.state === 'closed' && !data.moveId ? (
              <Notice
                tone="warning"
                title={t('blocked')}
                message={blockers
                  .map((blocker) =>
                    _(`hospitality_billing.blocker.${String(blocker.code)}`, {
                      types: Array.isArray((blocker.params as Item | undefined)?.types)
                        ? ((blocker.params as Item).types as string[])
                            .map((type) => _(`hospitality_billing.chargeType.${type}`))
                            .join(', ')
                        : '',
                    }),
                  )
                  .join(' · ')}
                actions={
                  <LinkButton
                    href={hospitalityScopedHref(url, '/admin/hospitality/billing/rules')}
                    label={t('rules')}
                  />
                }
              />
            ) : null,
            payments.length ? (
              <KetTable
                labels={{
                  region: t('title'),
                  selectAll: _('backend.table.selectAll'),
                  selectRow: _('backend.table.selectRow'),
                  sortedAscending: _('backend.table.sortAscending'),
                  sortedDescending: _('backend.table.sortDescending'),
                  previousPage: _('backend.chrome.previous'),
                  nextPage: _('backend.chrome.next'),
                  loading: _('backend.relation.loading'),
                  loadError: _('backend.error.failed.title'),
                  retry: _('backend.relation.retry'),
                  empty: t('empty'),
                  emptyHint: t('emptyHint'),
                }}
                rows={payments}
                id={(row) => String(row.id)}
                responsive="stack"
                columns={[
                  {
                    key: 'date',
                    label: t('date'),
                    cell: (row) =>
                      new Intl.DateTimeFormat(ctx.localeOf(url, req), {
                        dateStyle: 'short',
                        timeZone: String(data.timezone ?? 'Asia/Ho_Chi_Minh'),
                      }).format(new Date(String(row.date))),
                  },
                  { key: 'kind', label: t('kind'), cell: (row) => t(String(row.kind)) },
                  { key: 'journal', label: t('journal'), cell: (row) => String(row.journal ?? '—') },
                  { key: 'amount', label: t('amount'), cell: (row) => formatMoney(_, String(row.amount)) },
                  { key: 'reference', label: t('reference'), cell: (row) => String(row.reference ?? '—') },
                  {
                    key: 'state',
                    label: t('state'),
                    cell: (row) => t(row.active === false ? 'released' : row.posted ? 'posted' : 'notPosted'),
                  },
                ]}
              />
            ) : (
              <EmptyState visual="start" title={t('empty')} message={t('emptyHint')} />
            ),
          ]}
        />
      }
    />
  )
  const dialogs = []
  if (step === 'invoice' && canInvoice && !data.moveId && folio.state === 'closed')
    dialogs.push(
      <Dialog
        id="folio-finance-step"
        title={`${t('invoice')} · ${folio.code}`}
        closeHref={here()}
        closeLabel={t('cancel')}
        body={
          <RecordForm
            action={here('invoice')}
            method="post"
            submitLabel={t('issue')}
            submitDisabled={blockers.length > 0}
            errors={errors}
            hidden={{ ...hidden, operation: 'invoice-folio' }}
            fields={[
              field({
                id: 'folio-buyerType',
                name: 'buyerType',
                type: 'select',
                label: t('buyerType'),
                value: value('buyerType', 'guest'),
                options: ['guest', 'company'].map((value) => ({ value, label: t(value) })),
              }),
              field({
                id: 'folio-buyerName',
                name: 'buyerName',
                label: t('buyerName'),
                value: value('buyerName', folio.partner?.name ?? ''),
                required: true,
                maxLength: 200,
              }),
              field({
                id: 'folio-buyerTaxCode',
                name: 'buyerTaxCode',
                label: t('buyerTaxCode'),
                value: value('buyerTaxCode'),
              }),
              field({
                id: 'folio-buyerAddress',
                name: 'buyerAddress',
                type: 'textarea',
                label: t('buyerAddress'),
                value: value('buyerAddress'),
              }),
              field({
                id: 'folio-buyerEmail',
                name: 'buyerEmail',
                type: 'email',
                label: t('buyerEmail'),
                value: value('buyerEmail'),
              }),
            ]}
          />
        }
      />,
    )
  if (
    data.balanceKnown !== false &&
    step === 'payment' &&
    canPay &&
    folio.state !== 'cancelled' &&
    compareDecimals(balance, '0') > 0
  )
    dialogs.push(
      <Dialog
        id="folio-finance-step"
        title={`${t(data.moveId ? 'payment' : 'advance')} · ${folio.code}`}
        closeHref={here()}
        closeLabel={t('cancel')}
        body={
          <Stack
            items={[
              journals.length ? null : (
                <Notice tone="warning" title={t('noJournal')} message={t('noJournalHint')} />
              ),
              <RecordForm
                action={here('payment')}
                method="post"
                submitLabel={t('record')}
                submitDisabled={!journals.length}
                errors={errors}
                hidden={{ ...hidden, operation: 'record-payment' }}
                fields={[
                  field({
                    id: 'folio-payment-amount',
                    name: 'amount',
                    type: 'number',
                    label: t('amount'),
                    value: value('amount', balance),
                    min: '1',
                    max: balance,
                    step: 'any',
                    required: true,
                  }),
                  field({
                    id: 'folio-payment-journal',
                    name: 'journalId',
                    type: 'select',
                    label: t('journal'),
                    value: value('journalId'),
                    required: true,
                    options: [
                      { value: '', label: t('chooseJournal') },
                      ...journals.map((row) => ({
                        value: String(row.id),
                        label: `${row.code} · ${row.name}`,
                      })),
                    ],
                  }),
                  field({
                    id: 'folio-payment-reference',
                    name: 'reference',
                    label: t('reference'),
                    value: value('reference'),
                  }),
                  field({
                    id: 'folio-payment-note',
                    name: 'memo',
                    type: 'textarea',
                    label: t('note'),
                    value: value('memo'),
                  }),
                ]}
              />,
            ]}
          />
        }
      />,
    )
  return <Stack items={[feedback, money, ...dialogs]} />
}
