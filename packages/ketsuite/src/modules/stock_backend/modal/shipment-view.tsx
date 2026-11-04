import {
  ActionGroup,
  AppSwitcherHelp,
  Badge,
  Button,
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
  permissions: Record<
    'save' | 'book' | 'handOver' | 'deliver' | 'fail' | 'retry' | 'return' | 'cancel',
    boolean
  >
  texts: Record<string, string>
  links: Record<'picking' | 'returnPicking' | 'order' | 'statement' | 'codEntry', LinkTo> & { list: string }
  carriers: { id: string; name: string }[]
}
type Context = RecordModalContext<Data>

const FORM = 'stock-shipment-form'
const language = () =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'
const t = (c: Context, key: string, params?: Record<string, unknown>) => c.t(`stock_backend.${key}`, params)
const state = (c: Context) => String(c.data.record.state)
const editable = (c: Context) => state(c) === 'draft' && c.data.permissions.save
const TONES: Record<string, 'neutral' | 'info' | 'positive' | 'warning' | 'danger'> = {
  draft: 'neutral',
  booked: 'info',
  shipping: 'info',
  delivered: 'positive',
  failed: 'danger',
  returned: 'warning',
  cancel: 'neutral',
}

const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `shipment-${name}`,
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
        disabled: c.busy,
      },
    }),
  }
}

/** A draft's parcel: who carries it, how heavy it is, what it collects, and the code the carrier gave. */
const parcelFields = (c: Context): FieldProps[] => [
  carrierField(c),
  field(c, 'weight', 'shipment.weight', {
    type: 'decimal',
    required: true,
    help: t(c, 'shipment.weightHelp'),
  }),
  field(c, 'cod', 'delivery.cod', {
    type: 'decimal',
    required: true,
    help: t(c, 'shipment.codHelp', { max: c.data.texts.codLimit }),
  }),
  field(c, 'trackingCode', 'shipment.tracking', { help: t(c, 'shipment.trackingHelp') }),
  { ...field(c, 'note', 'shipment.note', { type: 'textarea' }), span: 'full' },
]

const link = (to: LinkTo) => (to ? to.href ? <Link label={to.name} href={to.href} /> : to.name : null)
type Item = { id: string; label: string; value: unknown }
const items = (list: (Item | null)[]) =>
  list.filter(
    (entry): entry is { id: string; label: string; value: string } =>
      entry !== null && entry.value != null && entry.value !== '',
  )

function fees(c: Context) {
  const record = c.data.record
  return (
    <DescriptionList
      items={items([
        state(c) === 'draft'
          ? null
          : { id: 'carrier', label: t(c, 'delivery.carrier'), value: record.carrierName },
        state(c) === 'draft'
          ? null
          : { id: 'tracking', label: t(c, 'shipment.tracking'), value: record.trackingCode },
        state(c) === 'draft'
          ? null
          : { id: 'weight', label: t(c, 'shipment.weight'), value: c.data.texts.weight },
        state(c) === 'draft' ? null : { id: 'cod', label: t(c, 'delivery.cod'), value: c.data.texts.cod },
        { id: 'shippingFee', label: t(c, 'shipment.shippingFee'), value: c.data.texts.shippingFee },
        { id: 'codFee', label: t(c, 'shipment.codFee'), value: c.data.texts.codFee },
        { id: 'total', label: t(c, 'delivery.fees'), value: c.data.texts.total },
        state(c) === 'draft' ? null : { id: 'note', label: t(c, 'shipment.note'), value: record.note },
      ])}
    />
  )
}

function journey(c: Context) {
  const record = c.data.record
  const day = (key: string, label: string): Item => ({
    id: key,
    label: t(c, label),
    value: c.data.texts[key],
  })
  return (
    <DescriptionList
      items={items([
        day('bookedDate', 'shipment.bookedDate'),
        day('handedDate', 'shipment.handedDate'),
        Number(record.attempts ?? 0) > 1
          ? { id: 'attempts', label: t(c, 'shipment.attempts'), value: String(record.attempts) }
          : null,
        day('failedDate', 'shipment.failedDate'),
        { id: 'failReason', label: t(c, 'shipment.failReason'), value: record.failReason },
        day('deliveredDate', 'shipment.deliveredDate'),
        day('returnedDate', 'shipment.returnedDate'),
        day('cancelledDate', 'shipment.cancelledDate'),
        { id: 'cancelReason', label: t(c, 'shipment.cancelReason'), value: record.cancelReason },
      ])}
    />
  )
}

function summary(c: Context) {
  const record = c.data.record
  return (
    <DescriptionList
      items={items([
        { id: 'picking', label: t(c, 'delivery.picking'), value: link(c.data.links.picking) },
        { id: 'customer', label: t(c, 'delivery.customer'), value: record.partnerName },
        { id: 'order', label: t(c, 'delivery.order'), value: link(c.data.links.order) },
        { id: 'warehouse', label: t(c, 'delivery.warehouse'), value: record.warehouseName },
        { id: 'return', label: t(c, 'shipment.returnPicking'), value: link(c.data.links.returnPicking) },
        { id: 'statement', label: t(c, 'shipment.statement'), value: link(c.data.links.statement) },
        { id: 'codEntry', label: t(c, 'shipment.codEntry'), value: link(c.data.links.codEntry) },
      ])}
    />
  )
}

function notices(c: Context) {
  const record = c.data.record
  const picking = c.data.links.picking?.name ?? ''
  if (['draft', 'booked'].includes(state(c)) && record.pickingOpen !== true)
    return (
      <Notice tone="warning" title={t(c, 'shipment.closedTitle')} message={t(c, 'shipment.closedMessage')} />
    )
  if (state(c) === 'booked' && record.ready !== true)
    return (
      <Notice
        tone="info"
        title={t(c, 'shipment.waitingTitle')}
        message={t(c, 'shipment.waitingMessage', { picking })}
      />
    )
  if (state(c) === 'failed')
    return (
      <Notice
        tone="danger"
        title={t(c, 'shipment.failedTitle')}
        message={t(c, 'shipment.failedMessage', { reason: record.failReason, date: c.data.texts.failedDate })}
      />
    )
  if (state(c) === 'cancel')
    return (
      <Notice
        tone="info"
        title={t(c, 'shipment.cancelledTitle')}
        message={t(c, 'shipment.cancelledMessage', {
          reason: record.cancelReason,
          date: c.data.texts.cancelledDate,
        })}
      />
    )
  return null
}

const action = (c: Context, command: string, label: string, primary = false, disabled = false) => (
  <RecordActionForm kind={c.kind} command={command}>
    <Button
      type="submit"
      label={t(c, label)}
      variant={primary ? 'primary' : 'secondary'}
      disabled={c.busy || disabled}
    />
  </RecordActionForm>
)
const dialog = (c: Context, name: string, label: string) => (
  <RecordDialogTrigger dialog={name}>
    <Button label={t(c, label)} disabled={c.busy} />
  </RecordDialogTrigger>
)

const parcelInput = (form: FormData, c: Context) => ({
  id: c.id,
  carrierId: String(form.get('carrierId') ?? '') || undefined,
  weight: String(form.get('weight') ?? ''),
  cod: String(form.get('cod') ?? ''),
  note: String(form.get('note') ?? ''),
})
const reasonDialog = (
  c: Context,
  command: 'cancel' | 'fail',
  title: string,
  hint: string,
  label: string,
) => ({
  title: () => t(c, title),
  view: (c: Context) => (
    <RecordModalForm
      kind={c.kind}
      command={command}
      fields={[
        field(c, 'reason', command === 'cancel' ? 'shipment.cancelReason' : 'shipment.failReason', {
          id: `shipment-${command}-reason`,
          type: 'textarea',
          required: true,
          value: '',
        }),
      ]}
      body={<Notice tone="info" title={t(c, hint)} message="" />}
      actions={[<Button type="submit" label={t(c, label)} variant="primary" disabled={c.busy} />]}
    />
  ),
})

export const shipmentDefinition: RecordModalDefinition<Data> = {
  kind: 'stock.shipment',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[language()],
  context: {
    route: (id) => `/admin/stock/shipment/${encodeURIComponent(id)}/context?lang=${language()}`,
    query: ['company', 'branch'],
  },
  title: (c) => String(c.data.record.name),
  status: (c) => <Badge label={t(c, `shipment.state.${state(c)}`)} tone={TONES[state(c)] ?? 'neutral'} />,
  body: (c) => (
    <Stack
      items={[
        notices(c),
        editable(c) ? (
          <Surface
            title={t(c, 'shipment.parcel')}
            body={<RecordModalForm id={FORM} kind={c.kind} command={null} fields={parcelFields(c)} />}
          />
        ) : null,
        <Surface
          title={state(c) === 'draft' ? t(c, 'delivery.fees') : t(c, 'shipment.parcel')}
          body={
            <Stack
              items={[
                fees(c),
                state(c) === 'draft' ? (
                  <Notice tone="info" title={t(c, 'shipment.quoteHelp')} message="" />
                ) : null,
              ]}
            />
          }
        />,
        state(c) === 'draft' ? null : <Surface title={t(c, 'shipment.journey')} body={journey(c)} />,
      ]}
    />
  ),
  pageAside: (c) => <Surface title={t(c, 'shipment.summary')} body={summary(c)} />,
  pageAsideLabel: (c) => t(c, 'shipment.summary'),
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
          ...(['draft', 'booked'].includes(s) && may.cancel ? [dialog(c, 'cancel', 'shipment.cancel')] : []),
          ...(s === 'draft' && may.save
            ? [
                <Button
                  type="submit"
                  form={FORM}
                  name={RECORD_COMMAND_FIELD}
                  value="save"
                  label={c.t('recordModal.save')}
                  variant={may.book ? 'secondary' : 'primary'}
                  disabled={c.busy}
                />,
              ]
            : []),
          ...(s === 'draft' && may.book && may.save && c.data.record.pickingOpen === true
            ? [
                <Button
                  type="submit"
                  form={FORM}
                  name={RECORD_COMMAND_FIELD}
                  value="book"
                  label={t(c, 'shipment.book')}
                  variant="primary"
                  disabled={c.busy}
                />,
              ]
            : []),
          ...(s === 'booked' && may.handOver
            ? [action(c, 'handOver', 'shipment.handOver', true, c.data.record.ready !== true)]
            : []),
          ...(s === 'shipping' && may.fail ? [dialog(c, 'fail', 'shipment.fail')] : []),
          ...(s === 'shipping' && may.deliver ? [action(c, 'deliver', 'shipment.deliver', true)] : []),
          ...(s === 'failed' && may.return ? [action(c, 'return', 'shipment.return')] : []),
          ...(s === 'failed' && may.retry ? [action(c, 'retry', 'shipment.retry', true)] : []),
        ]}
      />
    )
  },
  dialogs: {
    cancel: {
      title: (c) => t(c, 'shipment.cancelTitle'),
      view: (c) =>
        reasonDialog(c, 'cancel', 'shipment.cancelTitle', 'shipment.cancelHint', 'shipment.cancel').view(c),
    },
    fail: {
      title: (c) => t(c, 'shipment.failTitle'),
      view: (c) =>
        reasonDialog(c, 'fail', 'shipment.failTitle', 'shipment.failHint', 'shipment.fail').view(c),
    },
  },
  commands: {
    save: { fn: 'stock.saveShipment', input: parcelInput, after: 'reload' },
    book: {
      fn: 'stock.bookShipment',
      input: (form, c) => ({
        ...parcelInput(form, c),
        trackingCode: String(form.get('trackingCode') ?? '').trim() || undefined,
      }),
      // Unsaved edits change the fees: the question names figures only for the parcel as saved.
      confirm: (c) =>
        c.recordChanged
          ? t(c, 'shipment.bookChangedMessage')
          : t(c, 'shipment.bookMessage', {
              carrier: c.data.carriers.find((row) => row.id === c.data.record.carrierId)?.name ?? '',
              fee: c.data.texts.total,
              cod: c.data.texts.cod,
            }),
      after: 'reload',
    },
    handOver: {
      fn: 'stock.handOverShipment',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'shipment.confirmHandOver'),
      after: 'reload',
    },
    deliver: {
      fn: 'stock.deliverShipment',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'shipment.confirmDeliver'),
      after: 'reload',
    },
    retry: {
      fn: 'stock.retryShipment',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'shipment.confirmRetry'),
      after: 'reload',
    },
    return: {
      fn: 'stock.returnShipment',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'shipment.confirmReturn'),
      after: 'reload',
    },
    fail: {
      fn: 'stock.failShipment',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
      after: 'reload',
    },
    cancel: {
      fn: 'stock.cancelShipment',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
      after: 'reload',
    },
  },
}

/** A shipment's page, keeping the reader's language, company and branch. */
const shipmentPath = (id: string) => {
  const query = new URLSearchParams(
    [...new URLSearchParams(location.search)].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
  ).toString()
  return `/admin/stock/shipments/${encodeURIComponent(id)}${query ? `?${query}` : ''}`
}
export const shipmentPage = createRecordPage(shipmentDefinition, { path: (id) => shipmentPath(id) })
