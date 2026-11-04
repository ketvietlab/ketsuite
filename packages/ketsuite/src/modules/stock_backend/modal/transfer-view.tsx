import {
  ActionGroup,
  AppSwitcherHelp,
  Badge,
  Button,
  Link,
  LinkButton,
  DataTable,
  DescriptionList,
  Surface,
  Notice,
  Stack,
} from '@ketvietlab/design-system'
import type { FieldProps, RelationSelectConfig } from '@ketvietlab/design-system'
import { createRecordPage, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordModalForm,
  RecordDialogTrigger,
  RecordActionForm,
  RecordCloseTrigger,
} from '../../../ui/client/record-modal-form.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { linesInGrid, PickingLineGrid } from './transfer-grid.tsx'
import { postedPickingLines } from './transfer-grid-draft.ts'
import { postedTransferMoves } from './transfer-moves-draft.ts'
import { movesInGrid, TransferMovesGrid } from './transfer-moves-grid.tsx'
import { scheduledLabelKey } from '../scheduled.ts'
import { transferStatus } from '../transfer-status.ts'
type Row = Record<string, unknown>
type Valuation = {
  currency: string | null
  drafts: Array<{ moveLineId: string; unitCost: string | null; averageCost: string | null }>
  lines: Array<{ moveLineId: string; value: string }>
  total: string
  accountMoveName: string | null
  entryHref: string | null
  /** K63: what the receipt's value was adjusted by since it was done. */
  revaluations?: Array<{
    id: string
    product: string
    amount: string
    account: string
    reason: string
    date: string
    accountMoveName: string | null
    entryHref?: string | null
  }>
  /** K63: the receipt's lines that brought value in, which an adjustment may name. */
  revaluable?: Array<{ moveId: string; label: string }>
}
type Data = {
  record: Row & { moves: Row[] }
  /** When the transfer is planned, read where the company is. */
  scheduled?: { label: string; day: string } | null
  /** The operation's kind, `incoming`, `outgoing` or `internal`, which names the scheduled day. */
  kind?: string | null
  permissions: Record<string, boolean>
  /** Present only for a viewer who may read stock value (K25). */
  valuation?: Valuation | null
  choices: Record<string, Row[]>
  /** What other modules place beside the transfer: who else edits it, its conversation and activities. */
  editor?: Array<{ id: string; island: string }>
  collaboration?: Array<{ id: string; island: string }>
  /** K59: where a scrap order of this transfer's goods opens, for a viewer who may draft one. */
  scrapHref?: string | null
  /** K64: a completed receipt's way to a new landed cost, and the costs on it for a reader of stock value. */
  landedCosts?: {
    addHref: string | null
    costs: Array<{ id: string; name: string; stateText: string; amountText: string | null; href: string }>
  } | null
  /** K48: a delivery's shipment, and whether the viewer may make one now. */
  shipment?: {
    create: boolean
    parcel: {
      name: string
      href: string
      statusText: string
      tone: 'neutral' | 'info' | 'positive' | 'warning' | 'danger'
    } | null
  } | null
  /** K65: the printed copies the viewer may open; the copy with values only for who reads stock value. */
  reports?: Array<{ label: string; href: string }>
  /** K19: the transfers this one came from and those that followed it. */
  related?: {
    backorderOf: RelatedLink | null
    returnOf: RelatedLink | null
    backorders: RelatedLink[]
    returns: RelatedLink[]
  } | null
  draftId: string
}
type Context = RecordModalContext<Data>
type RelatedLink = { id: string; name: string; href: string }
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`stock_backend.${key}`)
const open = (c: Context) => !['done', 'cancel'].includes(String(c.data.record.state))
const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `transfer-${c.dialog?.name ?? 'record'}-${name}`,
  name,
  label: t(c, label),
  // Date controls label their calendar in the page language.
  locale: lang(),
  ...props,
  value: c.draft(name, String(props.value ?? '')),
  error: c.fieldError(name),
  disabled: c.busy,
})
/** A relation picker of the design system, filled from what the context loaded (DS: no plain select). */
const relation = (
  c: Context,
  name: string,
  label: string,
  key: string,
  value: unknown,
  config: Partial<RelationSelectConfig> = {},
): FieldProps => {
  const base = field(c, name, label, { required: config.required, value: String(value ?? '') })
  const labels = Object.fromEntries(
    [
      'choose',
      'search',
      'more',
      'noRecords',
      'loading',
      'loadError',
      'close',
      'select',
      'retry',
      'clear',
      'chosen',
    ].map((word) => [word, c.t(`backend.relation.${word}`)]),
  )
  return {
    ...base,
    control: recordIsland('backend.relation-select', {
      id: base.id,
      config: {
        name,
        triggerId: base.id,
        ariaLabel: base.label,
        value: base.value || null,
        options: (c.data.choices[key] ?? []).map((row) => ({
          value: String(row.id),
          label: String(row.name),
          // An operation type names its warehouse, as each warehouse has its own of the same name.
          ...(row.warehouseName ? { description: String(row.warehouseName) } : {}),
        })),
        invalid: Boolean(base.error),
        describedBy: base.error ? `${base.id}-error` : undefined,
        labels: { ...labels, dialogTitle: base.label },
        ...config,
        disabled: c.busy,
      },
    }),
  }
}
const inputs = (form: FormData, keys: string[]) =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = String(form.get(key) ?? '')
      return value ? [[key, value]] : []
    }),
  )
const editFields = (c: Context) => [
  // A new transfer left blank takes its warehouse's next number of its kind (K17).
  field(c, 'name', 'transfer.list.col.reference', {
    required: !c.creating,
    help: c.creating ? t(c, 'transfer.create.reference.help') : null,
    value: String(c.data.record.name ?? ''),
  }),
  // K21: a sales delivery or a return keeps the type and ends of its order or delivery.
  ...(!c.creating && c.data.record.bound === true
    ? []
    : [
        relation(c, 'pickingTypeId', 'field.operationType', 'pickingTypes', c.data.record.pickingTypeId, {
          required: true,
        }),
        relation(c, 'locationId', 'field.sourceLocation', 'locations', c.data.record.locationId),
        relation(c, 'locationDestId', 'field.destinationLocation', 'locations', c.data.record.locationDestId),
      ]),
  field(c, 'scheduledDate', scheduledLabelKey(c.data.kind), {
    type: 'date',
    value: c.data.scheduled?.day ?? '',
  }),
  // K60: a priority transfer takes goods first.
  {
    ...field(c, 'priority', 'transfer.priority', { type: 'checkbox', help: t(c, 'transfer.priorityHelp') }),
    value: c.draftChecked('priority', undefined, c.data.record.priority === true),
  },
]
/** A civil day (YYYY-MM-DD) as the reader writes dates. */
const civilDay = (day: string) =>
  new Intl.DateTimeFormat(lang() === 'en' ? 'en-US' : 'vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))
/**
 * K60: how the warehouse holds goods for this transfer, and from which day when by date. A transfer
 * a person gave back waits for Reserve though its warehouse reserves on its own; the line says so.
 */
const reservationText = (c: Context) => {
  const policy = c.data.record.reservation as { method?: string; reserveFrom?: string | null } | undefined
  if (!policy?.method) return null
  const method = t(c, `reservationMethod.${policy.method}`)
  const text = policy.reserveFrom
    ? `${method} · ${c.t('stock_backend.transfer.reserveFrom', { date: civilDay(policy.reserveFrom) })}`
    : method
  const open = !['done', 'cancel'].includes(String(c.data.record.state))
  return c.data.record.reservationPaused && open && policy.method !== 'manual'
    ? `${text} · ${t(c, 'transfer.reservationPaused')}`
    : text
}
const action = (c: Context, name: string, label: string, waiting = false) => (
  <RecordActionForm kind={c.kind} command={name}>
    <Button type="submit" label={t(c, `action.${label}`)} disabled={c.busy || waiting} />
  </RecordActionForm>
)
const dialog = (c: Context, name: string, label: string) => (
  <RecordDialogTrigger dialog={name}>
    <Button label={t(c, label)} disabled={c.busy} />
  </RecordDialogTrigger>
)
const money = (c: Context, value: unknown) =>
  value == null || value === ''
    ? '—'
    : new Intl.NumberFormat(lang() === 'en' ? 'en-US' : 'vi-VN', {
        style: 'currency',
        currency: c.data.valuation?.currency || 'VND',
        maximumFractionDigits: 6,
      }).format(Number(value))
const valuedReceipt = (c: Context, row: Row) =>
  Boolean(c.data.record.moves.find((move) => move.id === row.moveId)?.valuedReceipt)
/** The receipt price column: the line's own cost, or the average it will take when left blank. */
const costCell = (c: Context, row: Row) => {
  const done = c.data.valuation?.lines.find((line) => line.moveLineId === row.id)
  if (done) return money(c, done.value)
  const draft = c.data.valuation?.drafts.find((line) => line.moveLineId === row.id)
  if (!draft || !valuedReceipt(c, row)) return '—'
  const shown = draft.unitCost
    ? money(c, draft.unitCost)
    : `${t(c, 'modal.averageCost')}: ${money(c, draft.averageCost)}`
  return shown
}
const overdeliveryWarning = (c: Context) => {
  const hasExtra = c.data.record.moves.some((move) => {
    if (!move.allowOverdelivery) return false
    const lines = (move.lines ?? []) as Row[]
    const quantity = lines.filter((line) => line.picked).reduce((sum, line) => sum + Number(line.quantity), 0)
    return quantity > Number(move.productUomQty) + 0.000001
  })
  return hasExtra ? (
    <Notice tone="warning" title={t(c, 'modal.overdelivery')} message={t(c, 'modal.overdeliveryHint')} />
  ) : null
}
// K19: an open return follows its delivery; what came back is entered as done.
const returnNotice = (c: Context) =>
  c.data.related?.returnOf && !['done', 'cancel'].includes(String(c.data.record.state)) ? (
    <Notice tone="info" title={t(c, 'transfer.returnNotice')} message={t(c, 'transfer.returnNoticeHint')} />
  ) : null
// K18: a transfer with no lines has nothing to confirm; the button waits for a line.
const emptyNotice = (c: Context) =>
  c.data.record.state === 'draft' && !c.data.record.moves.length && c.data.permissions.confirmPicking ? (
    <Notice tone="info" title={t(c, 'transfer.emptyNotice')} message={t(c, 'transfer.emptyNoticeHint')} />
  ) : null
// K18: a cancelled transfer says why, when the person who cancelled it gave a reason.
const cancelNotice = (c: Context) =>
  c.data.record.state === 'cancel' && c.data.record.cancelReason ? (
    <Notice
      tone="warning"
      title={t(c, 'transfer.cancelledNotice')}
      message={String(c.data.record.cancelReason)}
    />
  ) : null
// K19: what the transfer came from and what followed it, each opening the other's page.
const relatedItems = (c: Context) => {
  const related = c.data.related
  if (!related) return []
  const item = (key: string, label: string, row: RelatedLink | null) =>
    row
      ? [{ id: `${key}-${row.id}`, label: t(c, label), value: <Link label={row.name} href={row.href} /> }]
      : []
  return [
    ...item('backorderOf', 'transfer.backorderOf', related.backorderOf),
    ...item('returnOf', 'transfer.returnOf', related.returnOf),
    ...related.backorders.flatMap((row) => item('backorder', 'transfer.backorder', row)),
    ...related.returns.flatMap((row) => item('return', 'transfer.return', row)),
  ]
}
// K65: the operation's printed copies, in one menu next to Help.
const printMenu = (c: Context) =>
  c.data.reports?.length
    ? [
        <ActionGroup
          label={t(c, 'action.print')}
          actions={c.data.reports.map((report) => <LinkButton label={report.label} href={report.href} />)}
        />,
      ]
    : []
/** K63: the accountant adjusts what a completed receipt is worth from its page. */
const revalueButton = (c: Context) =>
  !c.creating && c.data.permissions.revaluePicking && c.data.valuation?.revaluable?.length
    ? [dialog(c, 'revalue', 'action.revalue')]
    : []
const REVALUATION_ACCOUNTS = ['supplier', 'cogs', 'gain', 'loss'] as const
const revaluationFields = (c: Context) => [
  relation(c, 'moveId', 'revaluation.line', 'revaluable', c.data.valuation?.revaluable?.[0]?.moveId ?? '', {
    required: true,
  }),
  field(c, 'amount', 'revaluation.amount', {
    required: true,
    inputMode: 'decimal',
    help: t(c, 'revaluation.amountHelp'),
  }),
  field(c, 'account', 'revaluation.account', {
    type: 'radio',
    required: true,
    options: REVALUATION_ACCOUNTS.map((value) => ({ value, label: t(c, `revaluation.account.${value}`) })),
  }),
  field(c, 'reason', 'revaluation.reason', { type: 'textarea', required: true }),
]
/** K63: the adjustments made since the receipt was done, each with the entry it posted. */
const revaluationTable = (c: Context) =>
  c.data.valuation?.revaluations?.length ? (
    <DataTable
      title={t(c, 'revaluation.title')}
      columns={[
        {
          key: 'date',
          label: t(c, 'revaluation.date'),
          kind: 'date',
          cell: (row: Row) => civilDay(String(row.date).slice(0, 10)),
        },
        { key: 'product', label: t(c, 'revaluation.line'), cell: (row: Row) => String(row.product) },
        {
          key: 'amount',
          label: t(c, 'revaluation.amount'),
          kind: 'currency',
          cell: (row: Row) => money(c, row.amount),
        },
        {
          key: 'account',
          label: t(c, 'revaluation.account'),
          cell: (row: Row) => t(c, `revaluation.account.${String(row.account)}`),
        },
        { key: 'reason', label: t(c, 'revaluation.reason'), cell: (row: Row) => String(row.reason) },
        {
          key: 'entry',
          label: t(c, 'modal.entry'),
          cell: (row: Row) =>
            row.accountMoveName ? (
              row.entryHref ? (
                <Link label={String(row.accountMoveName)} href={String(row.entryHref)} />
              ) : (
                String(row.accountMoveName)
              )
            ) : (
              t(c, 'modal.noEntry')
            ),
        },
      ]}
      rows={c.data.valuation.revaluations}
      id={(row) => String(row.id)}
    />
  ) : null
const scrapLink = (c: Context) =>
  !c.creating && c.data.scrapHref
    ? [<LinkButton label={t(c, 'action.scrap')} href={c.data.scrapHref} variant="secondary" />]
    : []
const landedCostLink = (c: Context) =>
  c.data.landedCosts?.addHref
    ? [
        <LinkButton
          label={t(c, 'landedCost.addFromReceipt')}
          href={c.data.landedCosts.addHref}
          variant="secondary"
        />,
      ]
    : []
/** K64: the landed costs on a receipt, each with what it added once posted. */
const landedCostRail = (c: Context) =>
  c.data.landedCosts?.costs.length ? (
    <Surface
      title={t(c, 'landedCost.onReceipt')}
      body={
        <DescriptionList
          items={c.data.landedCosts.costs.map((cost) => ({
            id: cost.id,
            label: cost.stateText,
            value: (
              <Link
                label={cost.amountText ? `${cost.name} ${cost.amountText}` : cost.name}
                href={cost.href}
              />
            ),
          }))}
        />
      }
    />
  ) : null
/** K48: the delivery's shipment on the rail, with its status. */
const shipmentRail = (c: Context) =>
  c.data.shipment?.parcel ? (
    <Surface
      title={t(c, 'shipment.ofPicking')}
      body={
        <DescriptionList
          items={[
            {
              id: 'shipment',
              label: c.data.shipment.parcel.statusText,
              value: <Link label={c.data.shipment.parcel.name} href={c.data.shipment.parcel.href} />,
            },
          ]}
        />
      }
    />
  ) : null
const shipmentAction = (c: Context) =>
  c.data.shipment?.create
    ? [
        <RecordActionForm kind={c.kind} command="createShipment">
          <Button type="submit" label={t(c, 'shipment.create')} variant="secondary" disabled={c.busy} />
        </RecordActionForm>,
      ]
    : []
const saveButton = (c: Context) => (
  <Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />
)
export const transferModalDefinition: RecordModalDefinition<Data> = {
  kind: 'stock.transfer',
  // The lines grid's posted value: its edits are the transfer's unsaved changes.
  observeDrafts: ['lines', 'moves'],
  size: (c) => (c.creating ? 'small' : 'default'),
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/stock/transfer/${record}/context?lang=${lang()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'transfer.create.title') : String(c.data.record.name)),
  // K18: a receipt holds nothing, so once confirmed it reads as ready to receive.
  status: (c) =>
    c.creating ? null : (
      <Badge label={t(c, `state.${transferStatus(c.data.record.state, c.data.record.reserves !== false)}`)} />
    ),
  body: (c) =>
    c.creating ? (
      <Surface
        body={
          <RecordModalForm
            kind={c.kind}
            command="create"
            columns={1}
            fields={editFields(c)}
            actions={[saveButton(c)]}
          />
        }
      />
    ) : (
      <Stack
        items={[
          overdeliveryWarning(c),
          returnNotice(c),
          emptyNotice(c),
          cancelNotice(c),
          <Surface
            title={t(c, 'modal.information')}
            actions={
              open(c) && c.data.permissions.savePicking ? (
                <ActionGroup actions={[dialog(c, 'edit', 'modal.edit')]} />
              ) : undefined
            }
            body={
              <DescriptionList
                items={[
                  ...(c.data.record.partnerId
                    ? [
                        {
                          id: 'partner',
                          // A delivery or a return deals with a customer, a receipt with a supplier (K19).
                          label: t(
                            c,
                            c.data.record.partnerRole === 'customer'
                              ? 'kind.customer'
                              : 'replenishment.vendor',
                          ),
                          value: String(c.data.record.partnerName ?? c.data.record.partnerId),
                        },
                      ]
                    : []),
                  {
                    id: 'type',
                    label: t(c, 'field.operationType'),
                    value: String(
                      c.data.choices.pickingTypes?.find((row) => row.id === c.data.record.pickingTypeId)
                        ?.name ??
                        c.data.record.pickingTypeName ??
                        c.data.record.pickingTypeId,
                    ),
                  },
                  ...(c.data.scheduled
                    ? [
                        {
                          id: 'scheduled',
                          label: t(c, scheduledLabelKey(c.data.kind)),
                          value: c.data.scheduled.label,
                        },
                      ]
                    : []),
                  ...(c.data.record.priority === true
                    ? [{ id: 'priority', label: t(c, 'transfer.priority'), value: t(c, 'modal.yes') }]
                    : []),
                  ...(reservationText(c)
                    ? [{ id: 'reservation', label: t(c, 'transfer.reservation'), value: reservationText(c)! }]
                    : []),
                  ...(['locationId', 'locationDestId'] as const).map((key, index) => ({
                    id: key,
                    label: t(c, index === 0 ? 'field.sourceLocation' : 'field.destinationLocation'),
                    value: String(
                      c.data.choices.locations?.find((row) => row.id === c.data.record[key])?.name ??
                        c.data.record[key],
                    ),
                  })),
                  ...relatedItems(c),
                ]}
              />
            }
          />,
          <Surface
            title={t(c, 'modal.products')}
            body={
              movesInGrid(c) ? (
                <TransferMovesGrid context={c} />
              ) : (
                <DataTable
                  emptyTitle={t(c, 'modal.noProducts')}
                  emptyMessage={t(c, 'modal.noProductsHint')}
                  rows={c.data.record.moves}
                  id={(row) => String(row.id)}
                  responsive="scroll"
                  columns={[
                    { key: 'name', label: t(c, 'field.product'), cell: (row) => String(row.name) },
                    { key: 'demand', label: t(c, 'modal.demand'), cell: (row) => String(row.productUomQty) },
                    {
                      key: 'state',
                      label: t(c, 'transfer.list.col.state'),
                      cell: (row) => t(c, `state.${row.state}`),
                    },
                  ]}
                />
              )
            }
          />,
          <Surface
            title={t(c, 'modal.picked')}
            body={
              linesInGrid(c) ? (
                <PickingLineGrid context={c} />
              ) : (
                <DataTable
                  emptyTitle={t(c, 'modal.noPicked')}
                  emptyMessage={t(c, 'modal.noPickedHint')}
                  rows={c.data.record.moves.flatMap((move) =>
                    ((move.lines as Row[]) ?? []).map((line): Row => ({ ...line, name: move.name })),
                  )}
                  id={(row) => String(row.id)}
                  responsive="scroll"
                  columns={[
                    { key: 'name', label: t(c, 'field.product'), cell: (row) => String(row.name) },
                    { key: 'quantity', label: t(c, 'modal.quantity'), cell: (row) => String(row.quantity) },
                    {
                      key: 'lot',
                      label: t(c, 'field.lot'),
                      cell: (row) =>
                        String(
                          row.receiptLotNumber ||
                            c.data.choices.lots?.find((lot) => lot.id === row.lotId)?.name ||
                            (row.receiptLotName === '' ? t(c, 'modal.receiptAutomatic') : row.lotId) ||
                            '—',
                        ),
                    },
                    ...(c.data.record.moves.some((move) => move.receiptLotInput)
                      ? [
                          {
                            key: 'receiptExpiryDate',
                            label: t(c, 'modal.receiptExpiry'),
                            cell: (row: Row) =>
                              String(
                                row.receiptExpiryDate ||
                                  (typeof row.receiptLotName === 'string'
                                    ? t(c, 'modal.receiptDefaultExpiry')
                                    : '—'),
                              ),
                          },
                        ]
                      : []),
                    {
                      key: 'picked',
                      label: t(c, 'modal.picked'),
                      cell: (row) => t(c, row.picked ? 'modal.yes' : 'modal.no'),
                    },
                    ...(c.data.valuation &&
                    (c.data.valuation.lines.length || c.data.record.moves.some((move) => move.valuedReceipt))
                      ? [
                          {
                            key: 'cost',
                            label: t(c, open(c) ? 'modal.unitCost' : 'modal.value'),
                            kind: 'currency' as const,
                            cell: (row: Row) => costCell(c, row),
                          },
                        ]
                      : []),
                  ]}
                />
              )
            }
          />,
          // K25: what the completed transfer was worth and the entry that booked it.
          c.data.valuation && !open(c) && c.data.valuation.lines.length ? (
            <Surface
              title={t(c, 'modal.valuation')}
              body={
                <DescriptionList
                  items={[
                    {
                      id: 'value',
                      label: t(c, 'modal.pickingValue'),
                      value: money(c, c.data.valuation.total),
                    },
                    {
                      id: 'entry',
                      label: t(c, 'modal.entry'),
                      value: c.data.valuation.accountMoveName ? (
                        c.data.valuation.entryHref ? (
                          <Link label={c.data.valuation.accountMoveName} href={c.data.valuation.entryHref} />
                        ) : (
                          c.data.valuation.accountMoveName
                        )
                      ) : (
                        t(c, 'modal.noEntry')
                      ),
                    },
                  ]}
                />
              }
            />
          ) : null,
          c.data.valuation && !open(c) ? revaluationTable(c) : null,
        ]}
      />
    ),
  // The page's guide sits in the content slot (screens/transfer-page.tsx); its Help button is the
  // way to it where the rail is hidden. Confirming, reserving and completing wait for the grids.
  pageActions: (c) => (
    <ActionGroup
      actions={[
        <RecordCloseTrigger>
          <Button label={t(c, 'action.back')} variant="secondary" />
        </RecordCloseTrigger>,
        <AppSwitcherHelp label={HELP[lang()].trigger} />,
        ...printMenu(c),
        ...(c.creating
          ? []
          : !open(c)
            ? [
                ...(c.data.record.returnable && c.data.permissions.createReturn
                  ? [action(c, 'return', 'return')]
                  : []),
                ...revalueButton(c),
              ]
            : [
                ...(c.data.record.state === 'draft' && c.data.permissions.confirmPicking
                  ? [action(c, 'confirm', 'confirm', c.recordChanged || !c.data.record.moves.length)]
                  : []),
                // A receipt holds nothing (K60), so it offers no reserving.
                ...(c.data.record.state !== 'draft' &&
                c.data.record.reserves === true &&
                c.data.permissions.assignPicking
                  ? [action(c, 'assign', 'assign', c.recordChanged)]
                  : []),
                ...(c.data.record.state === 'assigned' &&
                c.data.record.reserves === true &&
                c.data.permissions.unreservePicking
                  ? [action(c, 'unreserve', 'unreserve')]
                  : []),
                ...(c.data.record.state !== 'draft' && c.data.permissions.validatePicking
                  ? [
                      <RecordDialogTrigger dialog="validate">
                        <Button label={t(c, 'action.validate')} disabled={c.busy || c.recordChanged} />
                      </RecordDialogTrigger>,
                    ]
                  : []),
                ...(c.data.permissions.cancelPicking ? [dialog(c, 'cancel', 'action.cancel')] : []),
              ]),
        ...scrapLink(c),
        ...landedCostLink(c),
        ...shipmentAction(c),
      ]}
    />
  ),
  // The rail: who else has the transfer open, then its conversation and activities.
  pageAside: (c) =>
    c.creating ||
    !(
      c.data.editor?.length ||
      c.data.collaboration?.length ||
      c.data.landedCosts?.costs.length ||
      c.data.shipment?.parcel
    ) ? undefined : (
      <Stack
        items={[
          shipmentRail(c),
          landedCostRail(c),
          ...(c.data.editor ?? []).map((entry) =>
            recordIsland(entry.island, {
              identity: `picking:${c.id}`,
              pickingId: c.id,
              lang: lang(),
            }),
          ),
          ...(c.data.collaboration?.length
            ? [
                <Surface
                  title={t(c, 'transfer.collaboration.label')}
                  body={
                    <Stack
                      items={c.data.collaboration.map((entry) =>
                        recordIsland(entry.island, { resModel: 'stock.Picking', resId: c.id, lang: lang() }),
                      )}
                    />
                  }
                />,
              ]
            : []),
        ]}
      />
    ),
  pageAsideLabel: (c) => t(c, 'transfer.collaboration.label'),
  pageAsideWhenStacked: 'after',
  // The rail sits beside the transfer only where the grids keep room for their columns.
  pageAsideBreakpoint: 'wide',
  dialogs: {
    revalue: {
      title: (c) => t(c, 'revaluation.dialogTitle'),
      view: (c) => (
        <Stack
          items={[
            <Notice
              tone="info"
              title={t(c, 'revaluation.noticeTitle')}
              message={t(c, 'revaluation.notice')}
            />,
            <RecordModalForm
              kind={c.kind}
              command="revalue"
              fields={revaluationFields(c)}
              actions={[
                <Button type="submit" label={t(c, 'revaluation.save')} variant="primary" disabled={c.busy} />,
              ]}
            />,
          ]}
        />
      ),
    },
    edit: {
      title: (c) => t(c, 'modal.edit'),
      view: (c) => (
        <RecordModalForm kind={c.kind} command="edit" fields={editFields(c)} actions={[saveButton(c)]} />
      ),
    },
    // K18: the stock manager cancels with a reason the transfer keeps.
    cancel: {
      title: (c) => t(c, 'modal.cancelTitle'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="cancel"
          fields={[field(c, 'reason', 'modal.cancelReason', { type: 'textarea', required: true })]}
          actions={[
            <Button
              type="submit"
              label={t(c, 'action.cancelTransfer')}
              variant="destructive"
              disabled={c.busy}
            />,
          ]}
        />
      ),
    },
    validate: {
      title: (c) => t(c, 'action.validate'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="validate"
          fields={[
            field(c, 'backorder', 'modal.remaining', {
              type: 'radio',
              value: 'create',
              options: [
                { value: 'create', label: t(c, 'action.validateCreateBackorder') },
                { value: 'cancel', label: t(c, 'action.validateNoBackorder') },
              ],
              required: true,
            }),
          ]}
          actions={[
            <Button type="submit" label={t(c, 'action.validate')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
  },
  commands: {
    // K48: a draft shipment of this delivery; the page then leads to it.
    createShipment: {
      fn: 'stock.createShipment',
      input: (_form, c) => ({ id: crypto.randomUUID(), pickingId: c.id }),
      after: 'reload',
    },
    // K63: one adjustment a reading; a retried post writes it once.
    revalue: {
      fn: 'stock.revaluePicking',
      input: (form, c) => ({
        id: c.id,
        revaluationId: c.data.draftId,
        ...inputs(form, ['moveId', 'amount', 'account', 'reason']),
      }),
      after: 'reload',
    },
    create: {
      fn: 'stock.createPicking',
      input: (form, c) => ({
        id: c.data.draftId,
        ...inputs(form, ['name', 'pickingTypeId', 'locationId', 'locationDestId', 'scheduledDate']),
        priority: form.has('priority'),
      }),
      after: 'open',
    },
    edit: {
      fn: 'stock.savePicking',
      input: (form, c) => ({
        id: c.id,
        moveType: c.data.record.moveType,
        // A transfer's form without its type and ends (K21) saves the ones it has.
        pickingTypeId: c.data.record.pickingTypeId,
        locationId: c.data.record.locationId,
        locationDestId: c.data.record.locationDestId,
        ...inputs(form, ['name', 'pickingTypeId', 'locationId', 'locationDestId']),
        // The form shows only the day: an unchanged day leaves the planned moment as it is (C30).
        ...(String(form.get('scheduledDate') ?? '') === (c.data.scheduled?.day ?? '')
          ? {}
          : inputs(form, ['scheduledDate'])),
        priority: form.has('priority'),
      }),
      after: 'reload',
    },
    // Every product the grid added, in one call (`addMoves`).
    moves: {
      fn: 'stock.addMoves',
      input: (form, c) => ({
        pickingId: c.id,
        // A new product line takes this reading's draft id, so a retried save writes it once.
        moves: postedTransferMoves(
          c.data.choices.products ?? [],
          String(form.get('moves') ?? ''),
          (gridId) => `${c.data.draftId}:${gridId}`,
        ),
      }),
      // Every refusal shows once, above the grid that posted the products.
      issueField: () => 'moves',
      after: 'reload',
    },
    // Every line the grid changed, in one call (`savePickingLines`).
    lines: {
      fn: 'stock.savePickingLines',
      input: (form, c) => ({
        id: c.id,
        // A new line takes this reading's draft id, so a retried save writes it once.
        lines: postedPickingLines(
          c.data.record.moves,
          String(form.get('lines') ?? ''),
          (gridId) => `${c.data.draftId}:${gridId}`,
        ),
      }),
      // Every refusal shows once, above the grid that posted the lines.
      issueField: () => 'lines',
      after: 'reload',
    },
    // K60: confirming follows the warehouse's reservation method.
    confirm: {
      fn: 'stock.confirmPicking',
      input: (_form, c) => ({ id: c.id, reserve: true }),
      after: 'reload',
    },
    assign: { fn: 'stock.assignPicking', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    unreserve: { fn: 'stock.unreservePicking', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    validate: {
      fn: 'stock.validatePicking',
      input: (form, c) => ({ id: c.id, backorder: String(form.get('backorder') ?? 'create') }),
      after: 'reload',
    },
    // K19: the return opens as soon as it exists.
    return: {
      fn: 'stock.createReturn',
      input: (_form, c) => ({ id: c.id, returnId: globalThis.crypto.randomUUID() }),
      navigate: (value) => transferPath(String((value as Row | null)?.id)),
    },
    cancel: {
      fn: 'stock.cancelPicking',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
      after: 'reload',
    },
  },
}
/** A transfer's page, keeping the reader's language, company and branch. */
const transferPath = (id: string) => {
  const query = new URLSearchParams(
    [...new URLSearchParams(location.search)].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
  ).toString()
  return `/admin/stock/transfers/${encodeURIComponent(id)}${query ? `?${query}` : ''}`
}
export const transferPage = createRecordPage(transferModalDefinition, {
  path: (id) => transferPath(id),
})
