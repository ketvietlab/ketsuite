import {
  ActionGroup,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordActionForm,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { PurchaseOrderHelp } from '../screens/order-help.tsx'
import { linesInGrid, PurchaseLinesGrid } from './line-grid.tsx'
import { postedPurchaseLines } from './line-grid-draft.ts'

type Row = Record<string, unknown>
export type PurchaseOrderModalData = {
  record: Row & { lines: Row[]; pickings: Row[]; moves?: Row[]; bills: Row[] }
  permissions: Record<string, boolean>
  choices: Record<string, Row[]>
  lang: 'vi' | 'en'
  draftId: string
}
type Context = RecordModalContext<PurchaseOrderModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`purchase_backend.${key}`)
const options = (c: Context, name: string) =>
  (c.data.choices[name] ?? []).map((row) => ({ value: String(row.id), label: String(row.name) }))
const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `purchase-${c.dialog?.name ?? 'record'}-${name}`,
  name,
  label: t(c, `field.${label}`),
  ...props,
  value: c.draft(name, String(props.value ?? '')),
  error: c.fieldError(name),
  disabled: c.busy,
})
const action = (c: Context, command: string, label: string, primary = false, waiting = false) => (
  <RecordActionForm kind={c.kind} command={command}>
    <Button
      type="submit"
      label={t(c, `action.${label}`)}
      variant={primary ? 'primary' : 'secondary'}
      disabled={c.busy || waiting}
    />
  </RecordActionForm>
)
const dialog = (c: Context, name: string, label: string) => (
  <RecordDialogTrigger dialog={name}>
    <Button label={t(c, `action.${label}`)} disabled={c.busy} />
  </RecordDialogTrigger>
)
const input = (form: FormData, keys: string[]) =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = String(form.get(key) ?? '')
      return value ? [[key, value]] : []
    }),
  )
/** Each view carries the order's guide, so the modal's Help opens it on every tab. */
const guided =
  (view: (c: Context) => JSXChild) =>
  (c: Context): JSXChild => (
    <>
      <PurchaseOrderHelp lang={lang()} />
      {view(c)}
    </>
  )
/** Opens the guide inside this modal (DS help runtime: `screen-help` resolves the nearest sheet). */
const help = (c: Context) => <Button name="screen-help" type="button" label={t(c, 'modal.help')} />
const create = (c: Context) => (
  <RecordModalForm
    kind={c.kind}
    command="create"
    fields={[
      field(c, 'partnerId', 'vendor', { type: 'select', options: options(c, 'partners'), required: true }),
      field(c, 'pickingTypeId', 'pickingType', {
        type: 'select',
        options: options(c, 'pickingTypes'),
        required: true,
      }),
      field(c, 'partnerRef', 'partnerRef'),
      field(c, 'dateOrder', 'dateOrder', { type: 'date' }),
      field(c, 'datePlanned', 'datePlanned', { type: 'date' }),
      field(c, 'notes', 'notes', { type: 'textarea', span: 'full' }),
    ]}
    actions={[<Button type="submit" label={t(c, 'action.createRfq')} variant="primary" disabled={c.busy} />]}
  />
)
const summary = (c: Context) => (
  <Stack
    items={[
      <DescriptionList
        items={['partnerName', 'partnerRef', 'dateOrder', 'datePlanned', 'amountTotal', 'notes'].map(
          (key) => ({
            id: key,
            label: t(c, `field.${key === 'partnerName' ? 'vendor' : key}`),
            value:
              String((c.data.record.display as Row | undefined)?.[key] ?? c.data.record[key] ?? '—') || '—',
          }),
        )}
      />,
      <Section
        title={t(c, 'modal.lines')}
        body={
          linesInGrid(c) ? (
            <PurchaseLinesGrid context={c} />
          ) : (
            <DataTable
              rows={c.data.record.lines}
              emptyTitle={t(c, 'lines.empty')}
              emptyMessage={t(c, 'lines.emptyHint')}
              id={(row) => String(row.id)}
              responsive="scroll"
              columns={[
                { key: 'name', label: t(c, 'field.product'), cell: (row) => String(row.name) },
                { key: 'productQty', label: t(c, 'field.productQty'), cell: (row) => String(row.productQty) },
                {
                  key: 'qtyReceived',
                  label: t(c, 'field.qtyReceived'),
                  cell: (row) => String(row.qtyReceived),
                },
                {
                  key: 'priceUnit',
                  label: t(c, 'field.priceUnit'),
                  cell: (row) => String(row.priceUnitLabel ?? row.priceUnit),
                },
              ]}
            />
          )
        }
      />,
    ]}
  />
)
export const purchaseOrderModalDefinition: RecordModalDefinition<PurchaseOrderModalData> = {
  kind: 'purchase.order',
  // The line grid's unsaved changes keep sending and confirming waiting.
  observeDrafts: ['lines'],
  size: (c) => (c.creating ? 'default' : 'large'),
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/purchase/record/${record}/context?lang=${lang()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'action.createRfq') : String(c.data.record.name)),
  status: (c) => (c.creating ? null : <Badge label={t(c, `state.${c.data.record.state}`)} />),
  body: guided((c) => (c.creating ? create(c) : summary(c))),
  tabs: [
    { id: 'info', label: (c) => t(c, 'modal.info'), visible: (c) => !c.creating, view: guided(summary) },
    {
      id: 'receipts',
      label: (c) => t(c, 'modal.receipts'),
      visible: (c) => !c.creating,
      view: guided((c) => (
        <DataTable
          rows={c.data.record.pickings}
          id={(row) => String(row.id)}
          responsive="scroll"
          columns={[
            { key: 'name', label: t(c, 'field.name'), cell: (row) => String(row.name) },
            { key: 'state', label: t(c, 'field.state'), cell: (row) => String(row.state) },
            {
              key: 'receive',
              label: t(c, 'modal.receive'),
              cell: (row) =>
                row.state !== 'done' && row.state !== 'cancel' && c.data.permissions.receiveOrderReceipt ? (
                  <RecordActionForm kind={c.kind} command="receive" hidden={{ receiptId: String(row.id) }}>
                    <Button type="submit" label={t(c, 'modal.receive')} />
                  </RecordActionForm>
                ) : (
                  ''
                ),
            },
          ]}
        />
      )),
    },
    {
      id: 'bills',
      label: (c) => t(c, 'modal.bills'),
      visible: (c) => !c.creating,
      view: guided((c) => (
        <Section
          title={t(c, 'modal.bills')}
          actions={
            c.data.record.state === 'purchase' && c.data.permissions.createVendorBill
              ? dialog(c, 'bill', 'createBill')
              : null
          }
          body={
            <DataTable
              rows={c.data.record.bills}
              id={(row) => String(row.id)}
              responsive="scroll"
              columns={[
                { key: 'name', label: t(c, 'field.name'), cell: (row) => String(row.name) },
                { key: 'state', label: t(c, 'field.state'), cell: (row) => String(row.state) },
              ]}
            />
          }
        />
      )),
    },
    {
      id: 'actions',
      label: (c) => t(c, 'modal.more'),
      visible: (c) => !c.creating,
      view: guided((c) => (
        <Stack
          items={[
            ...(['sent', 'to approve'].includes(String(c.data.record.state)) &&
            c.data.permissions.resetToDraft
              ? [action(c, 'reset', 'resetToDraft')]
              : []),
            ...(c.data.record.state === 'purchase' && c.data.permissions.lockOrder
              ? [
                  action(
                    c,
                    c.data.record.locked ? 'unlock' : 'lock',
                    c.data.record.locked ? 'unlock' : 'lock',
                  ),
                ]
              : []),
            ...(c.data.record.state !== 'cancel' &&
            !c.data.record.locked &&
            !c.data.record.moves?.some((row) => row.state === 'done') &&
            c.data.permissions.cancelOrder
              ? [action(c, 'cancel', 'cancel')]
              : []),
          ]}
        />
      )),
    },
  ],
  actions: (c) =>
    c.creating ? (
      <ActionGroup actions={[help(c)]} />
    ) : (
      <ActionGroup
        actions={[
          help(c),
          // Sending and confirming wait for the line grid to be saved.
          ...(c.data.record.state === 'draft' && c.data.permissions.sendRfq
            ? [action(c, 'send', 'send', false, c.recordChanged)]
            : []),
          ...(['draft', 'sent'].includes(String(c.data.record.state)) && c.data.permissions.confirmOrder
            ? [
                action(c, 'confirm', 'confirm', true, c.recordChanged),
                action(c, 'requestApproval', 'requestApproval', false, c.recordChanged),
              ]
            : []),
          ...(c.data.record.state === 'to approve' && c.data.permissions.approveOrder
            ? [action(c, 'approve', 'approve', true)]
            : []),
          ...(c.data.record.state === 'purchase' && c.data.permissions.syncReceipts
            ? [action(c, 'sync', 'syncReceipts')]
            : []),
        ]}
      />
    ),
  dialogs: {
    bill: {
      title: (c) => t(c, 'action.createBill'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="bill"
          fields={[
            field(c, 'journalId', 'journal', {
              type: 'select',
              options: options(c, 'journals'),
              required: true,
            }),
            ...(['expenseAccountId', 'payableAccountId', 'taxAccountId'] as const).map((name) =>
              field(c, name, name.replace('Id', ''), {
                type: 'select',
                options: options(c, 'accounts'),
                required: name !== 'taxAccountId',
              }),
            ),
            field(c, 'invoiceDate', 'invoiceDate', { type: 'date' }),
          ]}
          actions={[
            <Button type="submit" label={t(c, 'action.createBill')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
  },
  commands: {
    create: {
      fn: 'purchase.createOrder',
      input: (form, c) => ({
        id: c.data.draftId,
        ...input(form, ['partnerId', 'pickingTypeId', 'partnerRef', 'dateOrder', 'datePlanned', 'notes']),
      }),
      after: 'open',
    },
    // Every line the grid changed, in one call (`saveLines`).
    saveLines: {
      fn: 'purchase.saveLines',
      input: (form, c) => {
        // A new line takes this reading's draft id, so a retried save writes it once.
        const posted = postedPurchaseLines(
          c.data.record.lines,
          String(form.get('lines') ?? ''),
          (gridId) => `${c.data.draftId}:${gridId}`,
        )
        return { id: c.id, lines: posted?.lines ?? null, removed: posted?.removed ?? [] }
      },
      // Every refusal shows once, above the grid that posted the lines.
      issueField: () => 'lines',
      after: 'reload',
    },
    send: { fn: 'purchase.sendRfq', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    confirm: {
      fn: 'purchase.confirmOrder',
      input: (_form, c) => ({ id: c.id, expectedRevision: Number(c.data.record.revision) }),
      after: 'reload',
    },
    requestApproval: {
      fn: 'purchase.confirmOrder',
      input: (_form, c) => ({
        id: c.id,
        requiresApproval: true,
        expectedRevision: Number(c.data.record.revision),
      }),
      after: 'reload',
    },
    approve: {
      fn: 'purchase.approveOrder',
      input: (_form, c) => ({ id: c.id, expectedRevision: Number(c.data.record.revision) }),
      after: 'reload',
    },
    reset: { fn: 'purchase.resetToDraft', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    sync: { fn: 'purchase.syncReceipts', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    receive: {
      fn: 'purchase.receiveOrderReceipt',
      input: (form, c) => ({
        id: c.id,
        receiptId: String(form.get('receiptId')),
        expectedRevision: Number(c.data.record.revision),
      }),
      after: 'reload',
      confirm: (c) => t(c, 'modal.confirmReceive'),
    },
    lock: { fn: 'purchase.lockOrder', input: (_form, c) => ({ id: c.id, locked: true }), after: 'reload' },
    unlock: { fn: 'purchase.lockOrder', input: (_form, c) => ({ id: c.id, locked: false }), after: 'reload' },
    cancel: {
      fn: 'purchase.cancelOrder',
      input: (_form, c) => ({ id: c.id }),
      after: 'reload',
      confirm: (c) => t(c, 'modal.confirmCancel'),
    },
    bill: {
      fn: 'purchase.createVendorBill',
      input: (form, c) => ({
        id: c.data.draftId,
        orderId: c.id,
        ...input(form, ['journalId', 'expenseAccountId', 'payableAccountId', 'taxAccountId', 'invoiceDate']),
      }),
      after: 'reload',
    },
  },
}
export const purchaseOrderModal = createRecordModal(purchaseOrderModalDefinition)
