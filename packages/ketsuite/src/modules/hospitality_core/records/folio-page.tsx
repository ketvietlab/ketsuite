import { chargeDescription, chargeReason } from './charge-description.ts'
import {
  ActionGroup,
  Badge,
  Button,
  DescriptionList,
  KetTable,
  LinkButton,
  Notice,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import {
  createRecordPage,
  RecordDialogTrigger,
  RecordModalForm,
  recordIsland,
} from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { MANUAL_CHARGE_TYPES } from '../types.ts'
import { compareDecimals } from '../../account/money.ts'

type Row = Record<string, unknown>
type Page = { rows: Row[]; page: number; pages: number; total: number }
export type FolioPageData = {
  record: Row
  finance: Row | null
  can: Record<string, boolean>
  locale: string
  commandKey: string
  backHref: string
  refreshHref: string
  scope: string
}
type Context = RecordModalContext<FolioPageData>
const row = (v: unknown) => (v ?? {}) as Row
const shown = (v: unknown) => (v == null || v === '' ? '—' : String(v))
const tr = (c: Context, key: string) => c.t(`hospitality_core.${key}`)
const bill = (c: Context, key: string) => c.t(`hospitality_billing.workspace.${key}`)
const label = (c: Context, key: string) => tr(c, `folioPage.${key}`)
const money = (c: Context, v: unknown) =>
  new Intl.NumberFormat(c.data.locale, {
    style: 'currency',
    currency: String(c.data.record.currency),
    maximumFractionDigits: 2,
  }).format(Number(v ?? 0))
const time = (c: Context, v: unknown) =>
  v
    ? new Intl.DateTimeFormat(c.data.locale, {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: String(row(c.data.record.property).timezone),
      }).format(new Date(String(v)))
    : '—'
const selected = (c: Context) => row(c.data.record.selectedCharge)
const url = (c: Context, params: Record<string, string>) => {
  const target = new URL(c.data.refreshHref, 'http://hospitality.local')
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
  return target.pathname + target.search
}
const receipt = (c: Context, action: string) => ({
  folioId: c.id,
  expectedVersion: Number(c.data.record.version ?? 0),
  requestKey: `${c.data.commandKey}:${action}`,
})
const allowed = (c: Context, action: string) => {
  if (!c.data.can[action] || row(c.data.record.property).closingDate) return false
  if (action === 'invoice')
    return c.data.record.state === 'closed' && c.data.finance && !c.data.finance.moveId
  if (action === 'payment')
    return (
      c.data.record.state !== 'cancelled' &&
      c.data.finance &&
      c.data.finance.balanceKnown !== false &&
      compareDecimals(String(c.data.finance.balance ?? '0'), '0') > 0
    )
  return c.data.record.state === 'open'
}
const chargeName = (c: Context, charge: Row) =>
  chargeDescription(c.t, { type: String(charge.type), description: shown(charge.description) })
const tableLabels = (c: Context, region: string) => ({
  region,
  selectAll: label(c, 'selectAll'),
  selectRow: label(c, 'selectRow'),
  sortedAscending: label(c, 'ascending'),
  sortedDescending: label(c, 'descending'),
  previousPage: label(c, 'previous'),
  nextPage: label(c, 'next'),
  loading: c.t('recordModal.loading'),
  loadError: c.t('recordModal.loadFailed'),
  retry: c.t('recordModal.retry'),
  empty: label(c, 'empty'),
  emptyHint: label(c, 'emptyHint'),
})
const pagination = (c: Context, key: string, data: Page) => (
  <ActionGroup
    actions={[
      data.page > 1 ? (
        <LinkButton label={label(c, 'previous')} href={url(c, { [key]: String(data.page - 1) })} />
      ) : (
        <Button label={label(c, 'previous')} disabled />
      ),
      <Text>
        {data.page} / {data.pages} · {data.total}
      </Text>,
      data.page < data.pages ? (
        <LinkButton label={label(c, 'next')} href={url(c, { [key]: String(data.page + 1) })} />
      ) : (
        <Button label={label(c, 'next')} disabled />
      ),
    ]}
  />
)
const field = (c: Context, name: string, title: string, extra: Partial<FieldProps> = {}): FieldProps => ({
  id: `folio-${name}`,
  name,
  label: title,
  value: c.draft(name, ''),
  error: c.fieldError(name),
  ...extra,
})
const journalPicker = (c: Context) =>
  recordIsland('backend.relation-select', {
    id: 'folio-journal-picker',
    config: {
      name: 'journalId',
      ariaLabel: bill(c, 'journal'),
      value: c.draft('journalId', '') || null,
      options: [],
      labels: Object.fromEntries(
        [
          'choose',
          'search',
          'more',
          'noRecords',
          'loading',
          'loadError',
          'dialogTitle',
          'close',
          'select',
          'create',
          'edit',
          'cancel',
          'remove',
          'confirmRemove',
          'retry',
          'clear',
          'chosen',
        ].map((key) => [key, tr(c, `collection.lookup.${key}`)]),
      ),
      manager: {
        listFunction: 'hospitality_billing.lookupFolioJournals',
        listInput: { folioId: c.id },
        requestQuery: c.data.scope,
        searchInDropdown: true,
        limit: 20,
        resolveParam: 'id',
        idField: 'id',
        labelField: 'name',
      },
    },
  })
const form = (c: Context, action: string, fields: FieldProps[]) => (
  <RecordModalForm kind={c.kind} id={`folio-${action}-form`} fields={fields} />
)
const submit = (c: Context, action: string) =>
  allowed(c, action) ? (
    <Button
      form={`folio-${action}-form`}
      type="submit"
      name="__command"
      value={action}
      label={label(c, action)}
      variant="primary"
      disabled={c.busy}
    />
  ) : null
const trigger = (c: Context, action: string) =>
  allowed(c, action) ? (
    <RecordDialogTrigger dialog={action}>
      <Button label={label(c, action)} disabled={c.busy} />
    </RecordDialogTrigger>
  ) : null

export const folioPage = createRecordPage<FolioPageData>(
  {
    kind: 'hospitality.folio',
    cache: false,
    size: 'large',
    context: {
      route: (id) => `/admin/hospitality/folios/${encodeURIComponent(id)}/workspace-context`,
      query: [
        'company',
        'companies',
        'branch',
        'branches',
        'lang',
        'returnTo',
        'chargePage',
        'stayPage',
        'paymentPage',
        'chargeId',
      ],
    },
    title: (c) => c.t('hospitality_core.folio.detail.title', { code: shown(c.data.record.code) }),
    status: (c) => <Badge label={tr(c, `folioState.${c.data.record.state}`)} />,
    pageActions: (c) => (
      <ActionGroup
        actions={[
          <LinkButton href={c.data.backHref} label={label(c, 'back')} />,
          trigger(c, 'charge'),
          trigger(c, 'invoice'),
          trigger(c, 'payment'),
        ]}
      />
    ),
    body: (c) => {
      const charges = c.data.record.charges as Page,
        stays = c.data.record.stays as Page,
        finance = c.data.finance
      return (
        <Stack
          items={[
            <Surface
              title={tr(c, 'folio.section.information')}
              body={
                <DescriptionList
                  items={[
                    { id: 'guest', label: label(c, 'guest'), value: shown(row(c.data.record.partner).name) },
                    {
                      id: 'property',
                      label: label(c, 'property'),
                      value: shown(row(c.data.record.property).name),
                    },
                    {
                      id: 'opened',
                      label: tr(c, 'folio.field.openedAt'),
                      value: time(c, c.data.record.openedAt),
                    },
                    {
                      id: 'closed',
                      label: tr(c, 'folio.field.closedAt'),
                      value: time(c, c.data.record.closedAt),
                    },
                    {
                      id: 'total',
                      label: tr(c, 'folio.metric.activeTotal'),
                      value: money(c, c.data.record.amountTotal),
                    },
                  ]}
                />
              }
            />,
            finance ? (
              <Surface
                title={bill(c, 'title')}
                body={
                  <Stack
                    items={[
                      <DescriptionList
                        items={[
                          {
                            id: 'invoice',
                            label: bill(c, 'invoice'),
                            value: finance.moveName ? shown(finance.moveName) : bill(c, 'notInvoiced'),
                          },
                          {
                            id: 'received',
                            label: bill(c, 'received'),
                            value: finance.balanceKnown === false ? '—' : money(c, finance.paid),
                          },
                          {
                            id: 'balance',
                            label: bill(c, 'balance'),
                            value: finance.balanceKnown === false ? '—' : money(c, finance.balance),
                          },
                          { id: 'buyer', label: bill(c, 'buyer'), value: shown(row(finance.buyer).name) },
                        ]}
                      />,
                      finance.balanceKnown === false ? (
                        <Notice
                          tone="warning"
                          title={bill(c, 'unknownBalance')}
                          message={bill(c, 'unknownBalanceHint')}
                        />
                      ) : null,
                      !finance.moveId ? <Text>{bill(c, 'ledgerHint')}</Text> : null,
                    ]}
                  />
                }
              />
            ) : null,
            <Surface
              title={tr(c, 'folio.section.charges')}
              body={
                <Stack
                  items={[
                    <KetTable
                      labels={tableLabels(c, tr(c, 'folio.section.charges'))}
                      rows={charges.rows}
                      id={(r) => String(r.id)}
                      responsive="stack"
                      columns={[
                        {
                          key: 'date',
                          label: tr(c, 'folio.charge.occurredAt'),
                          cell: (r) => time(c, r.occurredAt),
                        },
                        {
                          key: 'description',
                          label: tr(c, 'folio.charge.description'),
                          cell: (r) => (
                            <Stack
                              gap="tight"
                              items={[
                                <Text>{chargeName(c, r)}</Text>,
                                (MANUAL_CHARGE_TYPES as readonly string[]).includes(String(r.type)) ? (
                                  <Text variant="bodySm">{tr(c, `charge.${r.type}`)}</Text>
                                ) : null,
                                r.voidReason || r.adjustmentReason ? (
                                  <Text variant="bodySm">
                                    {label(c, 'reason')}:{' '}
                                    {chargeReason(c.t, shown(r.voidReason || r.adjustmentReason))}
                                  </Text>
                                ) : null,
                              ]}
                            />
                          ),
                        },
                        {
                          key: 'quantity',
                          label: tr(c, 'folio.charge.quantity'),
                          cell: (r) => shown(r.quantity),
                        },
                        {
                          key: 'unitPrice',
                          label: tr(c, 'folio.charge.unitPrice'),
                          cell: (r) => money(c, r.unitPrice),
                        },
                        { key: 'amount', label: label(c, 'amount'), cell: (r) => money(c, r.amount) },
                        {
                          key: 'state',
                          label: label(c, 'state'),
                          cell: (r) => <Badge label={tr(c, `chargeState.${r.state}`)} />,
                        },
                        ...(charges.rows.some(
                          (r) =>
                            (allowed(c, 'void') && r.canVoid === true) ||
                            (allowed(c, 'adjust') && r.canAdjust === true),
                        )
                          ? [
                              {
                                key: 'actions',
                                label: label(c, 'actions'),
                                cell: (r: Row) => (
                                  <ActionGroup
                                    actions={['void', 'adjust'].map((action) =>
                                      allowed(c, action) &&
                                      r[action === 'void' ? 'canVoid' : 'canAdjust'] === true ? (
                                        <LinkButton
                                          label={label(c, action)}
                                          href={url(c, { dialog: action, chargeId: String(r.id) })}
                                        />
                                      ) : null,
                                    )}
                                  />
                                ),
                              },
                            ]
                          : []),
                      ]}
                    />,
                    pagination(c, 'chargePage', charges),
                  ]}
                />
              }
            />,
            finance ? (
              <Surface
                title={label(c, 'payments')}
                body={
                  <Stack
                    items={[
                      <KetTable
                        labels={tableLabels(c, label(c, 'payments'))}
                        rows={(finance.payments as Page).rows}
                        id={(r) => String(r.id)}
                        responsive="stack"
                        columns={[
                          { key: 'date', label: bill(c, 'date'), cell: (r) => time(c, r.date) },
                          { key: 'kind', label: bill(c, 'kind'), cell: (r) => bill(c, String(r.kind)) },
                          { key: 'journal', label: bill(c, 'journal'), cell: (r) => shown(r.journal) },
                          { key: 'amount', label: bill(c, 'amount'), cell: (r) => money(c, r.amount) },
                          { key: 'reference', label: bill(c, 'reference'), cell: (r) => shown(r.reference) },
                          {
                            key: 'state',
                            label: bill(c, 'state'),
                            cell: (r) =>
                              bill(c, r.active === false ? 'released' : r.posted ? 'posted' : 'notPosted'),
                          },
                        ]}
                      />,
                      pagination(c, 'paymentPage', finance.payments as Page),
                    ]}
                  />
                }
              />
            ) : null,
            <Surface
              title={tr(c, 'folio.section.stays')}
              body={
                <Stack
                  items={[
                    <DescriptionList
                      items={stays.rows.map((stay) => ({
                        id: String(stay.id),
                        label: shown(stay.code),
                        value: (
                          <LinkButton
                            label={`${time(c, stay.checkIn)} – ${time(c, stay.checkOut)}`}
                            href={`/admin/hospitality/stays/${encodeURIComponent(String(stay.id))}?${c.data.scope}`}
                          />
                        ),
                      }))}
                    />,
                    pagination(c, 'stayPage', stays),
                  ]}
                />
              }
            />,
          ]}
        />
      )
    },
    commands: {
      charge: {
        fn: 'hospitality_core.postFolioServiceCharge',
        input: (f, c) => ({
          ...receipt(c, 'charge'),
          description: String(f.get('description') ?? ''),
          type: String(f.get('type') ?? 'laundry'),
          quantity: String(f.get('quantity') ?? '1'),
          unitPrice: String(f.get('unitPrice') ?? '0'),
        }),
        after: 'reload',
      },
      void: {
        fn: 'hospitality_core.voidCharge',
        input: (f, c) => ({
          ...receipt(c, 'void'),
          id: selected(c).id,
          reason: String(f.get('reason') ?? ''),
        }),
        after: 'reload',
      },
      adjust: {
        fn: 'hospitality_core.adjustCharge',
        input: (f, c) => ({
          ...receipt(c, 'adjust'),
          chargeId: selected(c).id,
          amount: String(f.get('amount') ?? '0'),
          reason: String(f.get('reason') ?? ''),
        }),
        after: 'reload',
      },
      invoice: {
        fn: 'hospitality_billing.invoiceFolio',
        input: (f, c) => ({
          ...receipt(c, 'invoice'),
          buyerType: String(f.get('buyerType') ?? 'guest'),
          buyerName: String(f.get('buyerName') ?? ''),
          buyerTaxCode: String(f.get('buyerTaxCode') ?? ''),
          buyerAddress: String(f.get('buyerAddress') ?? ''),
          buyerEmail: String(f.get('buyerEmail') ?? ''),
        }),
        after: 'reload',
      },
      payment: {
        fn: 'hospitality_billing.recordFolioPayment',
        input: (f, c) => ({
          ...receipt(c, 'payment'),
          id: `folio-payment:${c.data.commandKey}`,
          amount: String(f.get('amount') ?? '0'),
          journalId: String(f.get('journalId') ?? ''),
          reference: String(f.get('reference') ?? ''),
          memo: String(f.get('memo') ?? ''),
        }),
        after: 'reload',
      },
    },
    dialogs: {
      charge: {
        title: (c) => label(c, 'charge'),
        size: 'default',
        view: (c) =>
          allowed(c, 'charge') ? (
            <Stack
              items={[
                form(c, 'charge', [
                  field(c, 'type', tr(c, 'folio.charge.type'), {
                    type: 'select',
                    required: true,
                    value: c.draft('type', 'laundry'),
                    options: MANUAL_CHARGE_TYPES.map((value) => ({ value, label: tr(c, `charge.${value}`) })),
                  }),
                  field(c, 'quantity', tr(c, 'folio.charge.quantity'), {
                    type: 'number',
                    min: '1',
                    max: '20',
                    step: '1',
                    required: true,
                    value: c.draft('quantity', '1'),
                  }),
                  field(c, 'unitPrice', tr(c, 'folio.charge.unitPrice'), {
                    type: 'number',
                    min: '1',
                    max: '50000000',
                    step: '1',
                    required: true,
                  }),
                  field(c, 'description', tr(c, 'folio.charge.description'), {
                    type: 'textarea',
                    required: true,
                    maxLength: 500,
                    help: label(c, 'chargeNoteHint'),
                  }),
                ]),
                <Notice
                  tone="info"
                  title={label(c, 'chargeRuleTitle')}
                  message={label(c, 'chargeRuleHint')}
                />,
                <Notice tone="warning" title={label(c, 'stockTitle')} message={label(c, 'stockHint')} />,
              ]}
            />
          ) : (
            <Text>{label(c, 'unavailable')}</Text>
          ),
        actions: (c) => submit(c, 'charge'),
      },
      void: {
        title: (c) => label(c, 'void'),
        view: (c) =>
          allowed(c, 'void') && selected(c).canVoid === true ? (
            form(c, 'void', [
              field(c, 'reason', tr(c, 'folio.field.voidReason'), {
                type: 'textarea',
                required: true,
                maxLength: 2000,
              }),
            ])
          ) : (
            <Text>{label(c, 'unavailable')}</Text>
          ),
        confirmation: {
          message: (c) =>
            `${label(c, 'voidHint')} ${chargeName(c, selected(c))} · ${money(c, selected(c).amount)}`,
          label: (c) => label(c, 'void'),
          cancelLabel: (c) => label(c, 'back'),
          form: () => 'folio-void-form',
          command: 'void',
          variant: 'destructive',
          disabled: (c) => c.busy || !allowed(c, 'void') || selected(c).canVoid !== true,
        },
      },
      adjust: {
        title: (c) => label(c, 'adjust'),
        size: 'default',
        view: (c) =>
          allowed(c, 'adjust') && selected(c).canAdjust === true ? (
            <Stack
              items={[
                <Text>{label(c, 'adjustHint')}</Text>,
                form(c, 'adjust', [
                  field(c, 'amount', label(c, 'amount'), { type: 'number', step: 'any', required: true }),
                  field(c, 'reason', label(c, 'reason'), {
                    type: 'textarea',
                    required: true,
                    maxLength: 2000,
                  }),
                ]),
              ]}
            />
          ) : (
            <Text>{label(c, 'unavailable')}</Text>
          ),
        actions: (c) => (selected(c).canAdjust === true ? submit(c, 'adjust') : null),
      },
      invoice: {
        title: (c) => label(c, 'invoice'),
        size: 'large',
        view: (c) =>
          allowed(c, 'invoice') ? (
            <Stack
              items={[
                ...((c.data.finance?.blockers ?? []) as Row[]).map((item) => (
                  <Text>
                    {c.t(`hospitality_billing.blocker.${item.code}`, {
                      types: Array.isArray(row(item.params).types)
                        ? (row(item.params).types as string[])
                            .map((type) => tr(c, `charge.${type}`))
                            .join(', ')
                        : '',
                    })}
                  </Text>
                )),
                form(c, 'invoice', [
                  field(c, 'buyerType', bill(c, 'buyerType'), {
                    type: 'select',
                    value: c.draft('buyerType', 'guest'),
                    options: ['guest', 'company'].map((value) => ({ value, label: bill(c, value) })),
                  }),
                  field(c, 'buyerName', bill(c, 'buyerName'), {
                    required: true,
                    maxLength: 200,
                    value: c.draft('buyerName', String(row(c.data.record.partner).name ?? '')),
                  }),
                  field(c, 'buyerTaxCode', bill(c, 'buyerTaxCode')),
                  field(c, 'buyerAddress', bill(c, 'buyerAddress'), { type: 'textarea' }),
                  field(c, 'buyerEmail', bill(c, 'buyerEmail'), { type: 'email' }),
                ]),
              ]}
            />
          ) : (
            <Text>{label(c, 'unavailable')}</Text>
          ),
        actions: (c) =>
          !(c.data.finance?.blockers as Row[] | undefined)?.length ? submit(c, 'invoice') : null,
      },
      payment: {
        title: (c) => label(c, 'payment'),
        size: 'default',
        view: (c) =>
          allowed(c, 'payment') ? (
            form(c, 'payment', [
              field(c, 'amount', bill(c, 'amount'), {
                type: 'number',
                step: 'any',
                min: '1',
                max: String(c.data.finance?.balance),
                required: true,
                value: c.draft('amount', String(c.data.finance?.balance)),
              }),
              field(c, 'journalId', bill(c, 'journal'), { required: true, control: journalPicker(c) }),
              field(c, 'reference', bill(c, 'reference')),
              field(c, 'memo', bill(c, 'note'), { type: 'textarea' }),
            ])
          ) : (
            <Text>{label(c, 'unavailable')}</Text>
          ),
        actions: (c) => submit(c, 'payment'),
      },
    },
  },
  { path: (id) => `/admin/hospitality/folios/${encodeURIComponent(id)}` },
)
