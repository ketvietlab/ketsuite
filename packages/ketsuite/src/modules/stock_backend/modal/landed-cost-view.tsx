import {
  ActionGroup,
  AppSwitcherHelp,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  KET_GRID_NO_CHANGES,
  Link,
  Notice,
  Stack,
  Surface,
} from '@ketvietlab/design-system'
import type { FieldProps, KetGridIslandConfig, RelationSelectConfig } from '@ketvietlab/design-system'
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
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { SPLIT_METHODS } from '../../stock/landed-cost-split.ts'
import { heldCostLine, postedCostLines } from './landed-cost-lines.ts'

type Row = Record<string, unknown>
type Data = {
  record: Row
  lang: 'vi' | 'en'
  draftId: string
  permissions: Record<'save' | 'post' | 'cancel', boolean>
  /** The receipt a new cost was opened from. */
  fromReceipt: string | null
  totalText: string
  dateText: string
  postedText: string
  entryHref: string | null
  receiptLinks: { id: string; name: string; href: string }[]
  allocations: Row[]
  choices: Record<'vendors' | 'receipts', { id: string; name: string }[]>
}
type Context = RecordModalContext<Data>

const FORM = 'stock-landed-cost-form'
const language = () =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'
const t = (c: Context, key: string) => c.t(`stock_backend.${key}`)
const draft = (c: Context) => c.creating || c.data.record.state === 'draft'
const editable = (c: Context) => draft(c) && c.data.permissions.save
const TONES: Record<string, 'neutral' | 'positive' | 'danger'> = {
  draft: 'neutral',
  posted: 'positive',
  cancel: 'danger',
}

const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `landed-cost-${name}`,
  name,
  label: t(c, label),
  value: c.draft(name, String(c.data.record[name] ?? '')),
  error: c.fieldError(name),
  disabled: c.busy,
  locale: c.data.lang,
  ...props,
})

const relation = (
  c: Context,
  name: string,
  label: string,
  rows: { id: string; name: string }[],
  config: Partial<RelationSelectConfig> = {},
): FieldProps => {
  const base = field(c, name, label)
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
    ].map((key) => [key, c.t(`backend.relation.${key}`)]),
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
        options: rows.map((row) => ({ value: row.id, label: row.name })),
        invalid: Boolean(base.error),
        describedBy: base.error ? `${base.id}-error` : undefined,
        labels: { ...labels, dialogTitle: base.label },
        ...config,
        disabled: c.busy,
      },
    }),
  }
}

/** The draft's own fields: whom the costs are owed to, their day and the receipts they land on. */
function draftFields(c: Context): FieldProps[] {
  const chosen = ((c.data.record.pickingIds as unknown[] | null) ?? []).map(String)
  const receipts = c.draft('pickingIds', chosen.join(','))
  return [
    relation(c, 'vendorId', 'landedCost.field.vendor', c.data.choices.vendors, {
      manager: {
        listFunction: 'stock.listLandedCostVendors',
        searchInDropdown: true,
        labelField: 'name',
      },
    }),
    field(c, 'date', 'landedCost.field.date', {
      type: 'date',
      value: c.draft('date', String(c.data.record.date ?? '').slice(0, 10)),
      help: t(c, 'landedCost.field.dateHelp'),
    }),
    {
      ...relation(c, 'pickingIds', 'landedCost.field.receipts', c.data.choices.receipts, {
        multiple: true,
        values: receipts ? receipts.split(',') : [],
      }),
      span: 'full',
      help: t(c, 'landedCost.field.receiptsHelp'),
    },
  ]
}

export function costGridConfig(c: Context): KetGridIslandConfig {
  return {
    label: t(c, 'landedCost.lines'),
    ...ketGridLocale(language()),
    currency: String(c.data.record.currency ?? 'VND'),
    columns: [
      {
        key: 'name',
        label: t(c, 'landedCost.line.name'),
        type: 'text',
        editable: true,
        required: true,
        placeholder: t(c, 'landedCost.line.namePlaceholder'),
        width: 240,
        grow: 1,
      },
      {
        key: 'splitMethod',
        label: t(c, 'landedCost.line.split'),
        type: 'select',
        editable: true,
        required: true,
        options: SPLIT_METHODS.map((value) => ({ value, label: t(c, `landedCost.split.${value}`) })),
        width: 180,
      },
      {
        key: 'amount',
        label: t(c, 'landedCost.line.amount'),
        type: 'money',
        editable: true,
        required: true,
        min: 0,
        footer: 'sum',
        width: 160,
      },
    ],
    rows: ((c.data.record.lines as Row[]) ?? []).map(heldCostLine),
    newRow: { name: '', splitMethod: 'quantity', amount: null },
    removable: true,
    reorderable: true,
    readOnly: c.busy,
    visibleRows: 6,
    name: 'lines',
    form: FORM,
    carry: c.draft('lines', KET_GRID_NO_CHANGES),
  }
}

function costLines(c: Context) {
  const error = c.fieldError('lines')
  if (editable(c))
    return (
      <Stack
        items={[
          error ? <Notice tone="danger" title={c.t('recordModal.errorTitle')} message={error} /> : null,
          recordIsland('backend.ket-grid', {
            id: `stock-landed-cost-grid-${c.id || 'new'}`,
            config: costGridConfig(c),
          }),
        ]}
      />
    )
  return (
    <DataTable<Row>
      emptyTitle={t(c, 'landedCost.noLines')}
      rows={(c.data.record.lines as Row[]) ?? []}
      id={(row) => String(row.id)}
      responsive="stack"
      columns={[
        { key: 'name', label: t(c, 'landedCost.line.name'), cell: (row) => String(row.name) },
        {
          key: 'split',
          label: t(c, 'landedCost.line.split'),
          cell: (row) => t(c, `landedCost.split.${String(row.splitMethod)}`),
        },
        {
          key: 'amount',
          label: t(c, 'landedCost.line.amount'),
          kind: 'currency',
          cell: (row) => String(row.amountText ?? row.amount),
        },
      ]}
    />
  )
}

const allocations = (c: Context) => (
  <DataTable<Row>
    emptyTitle={t(c, 'landedCost.noAllocations')}
    rows={c.data.allocations}
    id={(row) => String(row.id)}
    responsive="stack"
    columns={[
      {
        key: 'receipt',
        label: t(c, 'landedCost.allocation.receipt'),
        kind: 'identifier',
        cell: (row) => <Link label={String(row.receipt)} href={String(row.receiptHref)} />,
      },
      { key: 'product', label: t(c, 'landedCost.allocation.product'), cell: (row) => String(row.product) },
      { key: 'line', label: t(c, 'landedCost.allocation.line'), cell: (row) => String(row.line) },
      {
        key: 'amount',
        label: t(c, 'landedCost.allocation.amount'),
        kind: 'currency',
        cell: (row) => String(row.amountText),
      },
      {
        key: 'stock',
        label: t(c, 'landedCost.allocation.stock'),
        kind: 'currency',
        cell: (row) => String(row.stockText),
      },
      {
        key: 'cogs',
        label: t(c, 'landedCost.allocation.cogs'),
        kind: 'currency',
        cell: (row) => String(row.cogsText),
      },
    ]}
  />
)

function summary(c: Context) {
  const record = c.data.record
  const item = (id: string, label: string, value: unknown) =>
    value == null || value === '' ? null : { id, label: t(c, label), value: value as string }
  return (
    <DescriptionList
      items={[
        item('vendor', 'landedCost.field.vendor', record.vendorName),
        item('date', 'landedCost.field.date', c.data.dateText),
        item(
          'receipts',
          'landedCost.field.receipts',
          c.data.receiptLinks.length ? (
            <Stack
              gap="tight"
              items={c.data.receiptLinks.map((receipt) => <Link label={receipt.name} href={receipt.href} />)}
            />
          ) : null,
        ),
        item('total', 'landedCost.col.total', c.data.totalText),
        item('posted', 'landedCost.posted', c.data.postedText),
        record.accountMoveId
          ? item(
              'entry',
              'landedCost.entry',
              c.data.entryHref ? <Link label={String(record.name)} href={c.data.entryHref} /> : record.name,
            )
          : null,
        item('cancelReason', 'landedCost.cancelReason', record.cancelReason),
      ].filter((entry): entry is { id: string; label: string; value: string } => entry !== null)}
    />
  )
}

const saveInput = (form: FormData, c: Context) => {
  const lines = postedCostLines((c.data.record.lines as Row[]) ?? [], String(form.get('lines') ?? ''))
  const receipts = String(form.get('pickingIds') ?? '')
  return {
    id: c.creating ? c.data.draftId : c.id,
    vendorId: String(form.get('vendorId') ?? '') || null,
    date: String(form.get('date') ?? '') || undefined,
    pickingIds: receipts ? receipts.split(',').filter(Boolean) : [],
    ...(lines ? { lines } : {}),
  }
}
/** A refusal of one cost's cell shows once, above the grid that posted it. */
const issueField = (name: string) => (name.startsWith('lines') ? 'lines' : name)

export const landedCostDefinition: RecordModalDefinition<Data> = {
  kind: 'stock.landedCost',
  observeDrafts: ['lines', 'pickingIds'],
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[language()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/stock/landed-cost/${record}/context?lang=${language()}`
    },
    // A cost opened from a receipt starts on that receipt.
    query: ['company', 'branch', 'picking'],
  },
  title: (c) => (c.creating ? t(c, 'landedCost.create.title') : String(c.data.record.name)),
  status: (c) =>
    c.creating ? null : (
      <Badge
        label={t(c, `landedCost.state.${String(c.data.record.state)}`)}
        tone={TONES[String(c.data.record.state)] ?? 'neutral'}
      />
    ),
  body: (c) => (
    <Stack
      items={[
        c.data.fromReceipt ? (
          <Notice tone="info" title={t(c, 'landedCost.fromReceipt')} message={c.data.fromReceipt} />
        ) : null,
        editable(c) ? (
          <Surface
            title={t(c, 'landedCost.what')}
            body={<RecordModalForm id={FORM} kind={c.kind} command={null} fields={draftFields(c)} />}
          />
        ) : null,
        <Surface title={t(c, 'landedCost.lines')} body={costLines(c)} />,
        c.data.record.state === 'posted' ? (
          <Surface title={t(c, 'landedCost.allocations')} body={allocations(c)} />
        ) : null,
      ]}
    />
  ),
  // The rail: the cost's facts, the receipts it lands on and the entry that booked it.
  pageAside: (c) =>
    c.creating ? undefined : <Surface title={t(c, 'landedCost.summary')} body={summary(c)} />,
  pageAsideLabel: (c) => t(c, 'landedCost.summary'),
  pageAsideWhenStacked: 'after',
  pageActions: (c) => (
    <ActionGroup
      actions={[
        <RecordCloseTrigger>
          <Button label={t(c, 'action.back')} variant="secondary" />
        </RecordCloseTrigger>,
        <AppSwitcherHelp label={HELP[language()].trigger} />,
        ...(!c.creating && draft(c) && c.data.permissions.cancel
          ? [
              <RecordDialogTrigger dialog="cancel">
                <Button label={t(c, 'landedCost.cancel')} disabled={c.busy} />
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
                variant={c.data.permissions.post && !c.creating ? 'secondary' : 'primary'}
                disabled={c.busy}
              />,
            ]
          : []),
        // Posting from a draft being edited saves it first, in the same action.
        ...(!c.creating && draft(c) && c.data.permissions.post
          ? [
              editable(c) ? (
                <Button
                  type="submit"
                  form={FORM}
                  name={RECORD_COMMAND_FIELD}
                  value="post"
                  label={t(c, 'landedCost.post')}
                  variant="primary"
                  disabled={c.busy}
                />
              ) : (
                <RecordActionForm kind={c.kind} command="postSaved">
                  <Button type="submit" label={t(c, 'landedCost.post')} variant="primary" disabled={c.busy} />
                </RecordActionForm>
              ),
            ]
          : []),
      ]}
    />
  ),
  dialogs: {
    cancel: {
      title: (c) => t(c, 'landedCost.cancelTitle'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="cancel"
          fields={[
            field(c, 'reason', 'landedCost.cancelReason', {
              id: 'landed-cost-cancel-reason',
              type: 'textarea',
              required: true,
              value: '',
            }),
          ]}
          body={
            <Notice
              tone="info"
              title={t(c, 'landedCost.cancelEffect')}
              message={t(c, 'landedCost.cancelHint')}
            />
          }
          actions={[
            <Button type="submit" label={t(c, 'landedCost.cancel')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
  },
  commands: {
    save: {
      fn: 'stock.saveLandedCost',
      input: saveInput,
      issueField,
      after: 'open',
    },
    post: {
      fn: 'stock.saveLandedCost',
      input: saveInput,
      issueField,
      also: [{ fn: 'stock.postLandedCost', input: (_form, c) => ({ id: c.id }) }],
      confirm: (c) => t(c, 'landedCost.confirmPost'),
      after: 'reload',
    },
    postSaved: {
      fn: 'stock.postLandedCost',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'landedCost.confirmPost'),
      after: 'reload',
    },
    cancel: {
      fn: 'stock.cancelLandedCost',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
      after: 'reload',
    },
  },
}

/** A landed cost's page, keeping the reader's language, company and branch. */
const landedCostPath = (id: string) => {
  const query = new URLSearchParams(
    [...new URLSearchParams(location.search)].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
  ).toString()
  return `/admin/stock/landed-costs/${encodeURIComponent(id)}${query ? `?${query}` : ''}`
}
export const landedCostPage = createRecordPage(landedCostDefinition, { path: (id) => landedCostPath(id) })
