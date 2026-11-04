import {
  ActionGroup,
  AppSwitcherHelp,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Link,
  Notice,
  Stack,
  Surface,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import {
  createRecordPage,
  recordIsland,
  RECORD_COMMAND_FIELD,
  type RecordModalContext,
  type RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordActionForm,
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'

type Row = Record<string, unknown>
type LinkTo = { name: string; href: string | null } | null
type Data = {
  record: Row
  lang: 'vi' | 'en'
  draftId: string
  permissions: Record<'save' | 'post' | 'settle' | 'cancel', boolean>
  carrierName: string
  texts: Record<string, string>
  paying: boolean
  lines: Row[]
  links: Record<'feeEntry' | 'paymentEntry', LinkTo>
  today: string
  carriers: { id: string; name: string }[]
  journals: { id: string; name: string }[]
}
type Context = RecordModalContext<Data>

const FORM = 'stock-delivery-statement-form'
const language = () =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'
const t = (c: Context, key: string, params?: Record<string, unknown>) => c.t(`stock_backend.${key}`, params)
const state = (c: Context) => (c.creating ? 'draft' : String(c.data.record.state))
const editable = (c: Context) => state(c) === 'draft' && c.data.permissions.save
const TONES: Record<string, 'neutral' | 'positive' | 'warning'> = {
  draft: 'neutral',
  posted: 'warning',
  paid: 'positive',
  cancel: 'neutral',
}

const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `delivery-statement-${name}`,
  name,
  label: t(c, label),
  value: c.draft(name, String(c.data.record[name] ?? '')),
  error: c.fieldError(name),
  disabled: c.busy,
  locale: c.data.lang,
  ...props,
})

function carrierField(c: Context): FieldProps {
  const base = field(c, 'carrierId', 'delivery.carrier', { required: true })
  const labels = Object.fromEntries(
    ['choose', 'search', 'noRecords', 'close', 'select', 'clear', 'chosen'].map((key) => [
      key,
      c.t(`backend.relation.${key}`),
    ]),
  )
  return {
    ...base,
    control: recordIsland('backend.relation-select', {
      id: base.id,
      config: {
        name: 'carrierId',
        triggerId: base.id,
        ariaLabel: base.label,
        value: base.value || null,
        required: true,
        options: c.data.carriers.map((row) => ({ value: row.id, label: row.name })),
        invalid: Boolean(base.error),
        describedBy: base.error ? `${base.id}-error` : undefined,
        labels: { ...labels, dialogTitle: base.label },
        // A statement keeps its carrier once saved.
        disabled: c.busy || !c.creating,
      },
    }),
  }
}

const draftFields = (c: Context): FieldProps[] => [
  carrierField(c),
  field(c, 'date', 'statement.date', {
    type: 'date',
    value: c.draft('date', String(c.data.record.date ?? '').slice(0, 10) || c.data.today),
    help: t(c, 'statement.dateHelp'),
  }),
  { ...field(c, 'note', 'statement.note', { type: 'textarea' }), span: 'full' },
]

const link = (to: LinkTo) => (to ? to.href ? <Link label={to.name} href={to.href} /> : to.name : null)
type Item = { id: string; label: string; value: unknown }
const items = (list: (Item | null)[]) =>
  list.filter(
    (entry): entry is { id: string; label: string; value: string } =>
      entry !== null && entry.value != null && entry.value !== '',
  )

const lines = (c: Context) => (
  <DataTable<Row>
    emptyTitle={t(c, 'statement.empty')}
    emptyMessage={t(c, 'statement.takes')}
    rows={c.data.lines}
    id={(row) => String(row.id)}
    responsive="stack"
    columns={[
      {
        key: 'name',
        label: t(c, 'shipment.name'),
        kind: 'identifier',
        cell: (row) => <Link label={String(row.name)} href={String(row.href)} />,
      },
      {
        key: 'tracking',
        label: t(c, 'shipment.tracking'),
        kind: 'identifier',
        cell: (row) => String(row.tracking || '—'),
      },
      { key: 'customer', label: t(c, 'delivery.customer'), cell: (row) => String(row.customer || '—') },
      {
        key: 'closed',
        label: t(c, 'statement.closed'),
        kind: 'date',
        cell: (row) => String(row.closed || '—'),
      },
      { key: 'outcome', label: t(c, 'statement.outcome'), cell: (row) => String(row.outcome || '—') },
      { key: 'cod', label: t(c, 'delivery.cod'), kind: 'currency', cell: (row) => String(row.cod) },
      { key: 'fee', label: t(c, 'delivery.fees'), kind: 'currency', cell: (row) => String(row.fee) },
    ]}
  />
)

const totals = (c: Context) => (
  <DescriptionList
    items={[
      { id: 'cod', label: t(c, 'delivery.cod'), value: c.data.texts.cod! },
      { id: 'fees', label: t(c, 'delivery.fees'), value: c.data.texts.fees! },
      { id: 'net', label: t(c, 'statement.net'), value: c.data.texts.signedNet! },
    ]}
  />
)

function summary(c: Context) {
  const record = c.data.record
  return (
    <DescriptionList
      items={items([
        { id: 'carrier', label: t(c, 'delivery.carrier'), value: c.data.carrierName },
        { id: 'date', label: t(c, 'statement.date'), value: c.data.texts.date },
        { id: 'count', label: t(c, 'statement.count'), value: String(c.data.lines.length) },
        { id: 'feeEntry', label: t(c, 'statement.feeEntry'), value: link(c.data.links.feeEntry) },
        { id: 'paidDate', label: t(c, 'statement.paidDate'), value: c.data.texts.paidDate },
        { id: 'journal', label: t(c, 'statement.journal'), value: record.paymentJournalName },
        { id: 'paymentEntry', label: t(c, 'statement.paymentEntry'), value: link(c.data.links.paymentEntry) },
        { id: 'note', label: t(c, 'statement.note'), value: record.note },
      ])}
    />
  )
}

function notices(c: Context) {
  const record = c.data.record
  if (state(c) === 'cancel')
    return (
      <Notice
        tone="info"
        title={t(c, 'statement.cancelledTitle')}
        message={t(c, 'statement.cancelledMessage', {
          reason: record.cancelReason,
          date: c.data.texts.cancelledDate,
        })}
      />
    )
  if (!c.creating && state(c) === 'draft' && Number(record.pending ?? 0) > 0)
    return (
      <Notice
        tone="info"
        title={t(c, 'statement.pendingTitle', { n: String(record.pending) })}
        message={t(c, 'statement.pendingMessage')}
      />
    )
  return null
}

const saveInput = (form: FormData, c: Context) => ({
  id: c.creating ? c.data.draftId : c.id,
  ...(c.creating ? { carrierId: String(form.get('carrierId') ?? '') || undefined } : {}),
  date: String(form.get('date') ?? '') || undefined,
  note: String(form.get('note') ?? ''),
})

export const deliveryStatementDefinition: RecordModalDefinition<Data> = {
  kind: 'stock.deliveryStatement',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[language()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/stock/delivery-statement/${record}/context?lang=${language()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'statement.new') : String(c.data.record.name)),
  status: (c) =>
    c.creating ? null : (
      <Badge label={t(c, `statement.state.${state(c)}`)} tone={TONES[state(c)] ?? 'neutral'} />
    ),
  body: (c) => (
    <Stack
      items={[
        notices(c),
        editable(c) ? (
          <Surface
            title={t(c, 'statement.record')}
            body={
              <Stack
                items={[
                  <RecordModalForm id={FORM} kind={c.kind} command={null} fields={draftFields(c)} />,
                  <Notice tone="info" title={t(c, 'statement.takes')} message="" />,
                ]}
              />
            }
          />
        ) : null,
        c.creating ? null : <Surface title={t(c, 'statement.lines')} body={lines(c)} />,
        c.creating ? null : <Surface title={t(c, 'statement.totals')} body={totals(c)} />,
      ]}
    />
  ),
  pageAside: (c) =>
    c.creating ? undefined : <Surface title={t(c, 'statement.summary')} body={summary(c)} />,
  pageAsideLabel: (c) => t(c, 'statement.summary'),
  pageAsideWhenStacked: 'after',
  pageActions: (c) => {
    const may = c.data.permissions
    const s = state(c)
    return (
      <ActionGroup
        actions={[
          <RecordCloseTrigger>
            <Button label={t(c, 'action.back')} variant="secondary" />
          </RecordCloseTrigger>,
          <AppSwitcherHelp label={HELP[language()].trigger} />,
          ...(!c.creating && s === 'draft' && may.cancel
            ? [
                <RecordDialogTrigger dialog="cancel">
                  <Button label={t(c, 'statement.cancel')} disabled={c.busy} />
                </RecordDialogTrigger>,
              ]
            : []),
          ...(editable(c)
            ? [
                <Button
                  type="submit"
                  form={FORM}
                  name={RECORD_COMMAND_FIELD}
                  value="save"
                  label={c.t('recordModal.save')}
                  variant={may.post && !c.creating ? 'secondary' : 'primary'}
                  disabled={c.busy}
                />,
              ]
            : []),
          // Posting a draft being edited saves it first, in the same action.
          ...(!c.creating && s === 'draft' && may.post
            ? [
                editable(c) ? (
                  <Button
                    type="submit"
                    form={FORM}
                    name={RECORD_COMMAND_FIELD}
                    value="post"
                    label={t(c, 'statement.post')}
                    variant="primary"
                    disabled={c.busy}
                  />
                ) : (
                  <RecordActionForm kind={c.kind} command="postSaved">
                    <Button
                      type="submit"
                      label={t(c, 'statement.post')}
                      variant="primary"
                      disabled={c.busy}
                    />
                  </RecordActionForm>
                ),
              ]
            : []),
          ...(s === 'posted' && may.settle
            ? [
                <RecordDialogTrigger dialog="settle">
                  <Button label={t(c, 'statement.settle')} variant="primary" disabled={c.busy} />
                </RecordDialogTrigger>,
              ]
            : []),
        ]}
      />
    )
  },
  dialogs: {
    cancel: {
      title: (c) => t(c, 'statement.cancelTitle'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="cancel"
          fields={[
            field(c, 'reason', 'shipment.cancelReason', {
              id: 'delivery-statement-cancel-reason',
              type: 'textarea',
              required: true,
              value: '',
            }),
          ]}
          body={<Notice tone="info" title={t(c, 'statement.cancelHint')} message="" />}
          actions={[
            <Button type="submit" label={t(c, 'statement.cancel')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
    settle: {
      title: (c) => t(c, 'statement.settleTitle'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="settle"
          fields={[
            field(c, 'paidDate', 'statement.paidDate', {
              id: 'delivery-statement-paid-date',
              type: 'date',
              required: true,
              value: c.data.today,
            }),
            field(c, 'journalId', 'statement.journal', {
              id: 'delivery-statement-journal',
              type: 'select',
              required: true,
              value: c.data.journals[0]?.id ?? '',
              options: c.data.journals.map((row) => ({ value: row.id, label: row.name })),
              help: t(c, 'statement.journalHelp'),
            }),
          ]}
          body={
            <Notice
              tone="info"
              title={t(c, c.data.paying ? 'statement.settlePay' : 'statement.settleReceive', {
                carrier: c.data.carrierName,
                net: c.data.texts.net,
                cod: c.data.texts.cod,
                fees: c.data.texts.fees,
              })}
              message=""
            />
          }
          actions={[
            <Button type="submit" label={t(c, 'statement.settle')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
  },
  commands: {
    save: { fn: 'stock.saveDeliveryStatement', input: saveInput, after: 'open' },
    post: {
      fn: 'stock.saveDeliveryStatement',
      input: saveInput,
      also: [{ fn: 'stock.postDeliveryStatement', input: (_form, c) => ({ id: c.id }) }],
      confirm: (c) => t(c, 'statement.confirmPost'),
      after: 'reload',
    },
    postSaved: {
      fn: 'stock.postDeliveryStatement',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'statement.confirmPost'),
      after: 'reload',
    },
    settle: {
      fn: 'stock.settleDeliveryStatement',
      input: (form, c) => ({
        id: c.id,
        paidDate: String(form.get('paidDate') ?? ''),
        journalId: String(form.get('journalId') ?? '') || undefined,
      }),
      after: 'reload',
    },
    cancel: {
      fn: 'stock.cancelDeliveryStatement',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
      after: 'reload',
    },
  },
}

/** A carrier statement's page, keeping the reader's language, company and branch. */
const statementPath = (id: string) => {
  const query = new URLSearchParams(
    [...new URLSearchParams(location.search)].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
  ).toString()
  return `/admin/stock/delivery-statements/${encodeURIComponent(id)}${query ? `?${query}` : ''}`
}
export const deliveryStatementPage = createRecordPage(deliveryStatementDefinition, {
  path: (id) => statementPath(id),
})
