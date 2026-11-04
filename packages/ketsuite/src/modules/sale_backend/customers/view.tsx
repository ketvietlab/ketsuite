import {
  ActionGroup,
  AppSwitcherHelp,
  Button,
  DataTable,
  DescriptionList,
  LinkButton,
  Notice,
  Stack,
  Surface,
} from '@ketvietlab/design-system'
import type { FieldProps, RelationSelectConfig } from '@ketvietlab/design-system'
import {
  createRecordPage,
  recordIsland,
  type RecordModalContext,
  type RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { CustomerHelp } from './help.tsx'

type Row = Record<string, unknown>
export type Data = {
  record: Row & { revision: number }
  draftId: string
  save: boolean
  credit: boolean
  lang: 'vi' | 'en'
  choices: Record<'salespeople' | 'pricelists' | 'terms', Row[]>
  summary: {
    over: boolean
    overMessage: string
    limit: string
    paymentTermName: string
    receivable: string
    uninvoiced: string
    exposure: string
  }
  orders: Row[]
  invoices: Row[]
}
type Context = RecordModalContext<Data>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t('sale_backend.customers.' + key)
const formId = 'sale-customer-form'

const field = (c: Context, name: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: 'sale-customer-' + name,
  name,
  label: t(c, name),
  value: c.draft(name, String(c.data.record[name] ?? '')),
  error: c.fieldError(name),
  disabled: c.busy || !c.data.save,
  ...props,
})

/** A relation picker of the design system over a short list the context loaded (no plain select). */
const relation = (
  c: Context,
  name: string,
  label: string,
  key: keyof Data['choices'],
  editable: boolean,
): FieldProps => {
  const base = field(c, name, { label: t(c, label), disabled: c.busy || !editable })
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
  ) as Omit<RelationSelectConfig['labels'], 'dialogTitle'>
  const config: RelationSelectConfig = {
    name,
    triggerId: base.id,
    ariaLabel: String(base.label),
    value: String(base.value ?? '') || null,
    options: c.data.choices[key].map((row) => ({ value: String(row.id), label: String(row.name) })),
    invalid: Boolean(base.error),
    describedBy: base.error ? `${base.id}-error` : undefined,
    labels: { ...labels, dialogTitle: String(base.label) },
    disabled: Boolean(base.disabled),
  }
  return { ...base, control: recordIsland('backend.relation-select', { id: base.id!, config }) }
}

const contactFields = (c: Context): FieldProps[] => [
  field(c, 'name', { required: true, maxLength: 200 }),
  field(c, 'kind', {
    type: 'select',
    value: c.draft('kind', String(c.data.record.kind ?? 'person')),
    options: ['person', 'company'].map((value) => ({ value, label: t(c, 'kind.' + value) })),
  }),
  field(c, 'ref', { maxLength: 64 }),
  field(c, 'vat', { maxLength: 64 }),
  field(c, 'phone', { type: 'tel', inputMode: 'tel', maxLength: 64 }),
  field(c, 'email', { type: 'email', inputMode: 'email', maxLength: 200 }),
  relation(c, 'salespersonId', 'salesperson', 'salespeople', c.data.save),
  relation(c, 'pricelistId', 'pricelist', 'pricelists', c.data.save),
]

const creditCard = (c: Context) => (
  <Surface
    title={t(c, 'credit')}
    actions={
      c.data.credit ? (
        <RecordDialogTrigger dialog="credit">
          <Button label={t(c, 'creditEdit')} disabled={c.busy || c.recordChanged} />
        </RecordDialogTrigger>
      ) : undefined
    }
    body={
      <Stack
        items={[
          c.data.summary.over ? (
            <Notice tone="warning" title={t(c, 'overTitle')} message={c.data.summary.overMessage} />
          ) : null,
          <DescriptionList
            items={[
              { id: 'creditLimit', label: t(c, 'creditLimit'), value: c.data.summary.limit },
              { id: 'paymentTerm', label: t(c, 'paymentTerm'), value: c.data.summary.paymentTermName },
              { id: 'receivable', label: t(c, 'receivable'), value: c.data.summary.receivable },
              { id: 'uninvoiced', label: t(c, 'uninvoiced'), value: c.data.summary.uninvoiced },
              { id: 'exposure', label: t(c, 'exposure'), value: c.data.summary.exposure },
            ]}
          />,
        ]}
      />
    }
  />
)

const orders = (c: Context) => (
  <Surface
    title={t(c, 'recentOrders')}
    body={
      <DataTable
        rows={c.data.orders}
        id={(row) => String(row.id)}
        label={t(c, 'recentOrders')}
        responsive="scroll"
        emptyTitle={t(c, 'noOrders')}
        emptyMessage=""
        columns={[
          {
            key: 'name',
            label: t(c, 'orderName'),
            cell: (row) => <LinkButton label={String(row.name)} href={String(row.href)} variant="tertiary" />,
          },
          { key: 'date', label: t(c, 'orderDate'), kind: 'date', cell: (row) => String(row.date) },
          { key: 'state', label: t(c, 'orderState'), cell: (row) => String(row.state) },
          {
            key: 'amount',
            label: t(c, 'amount'),
            align: 'end',
            kind: 'currency',
            cell: (row) => String(row.amount),
          },
        ]}
      />
    }
  />
)

const invoices = (c: Context) => (
  <Surface
    title={t(c, 'openInvoices')}
    body={
      <DataTable
        rows={c.data.invoices}
        id={(row) => String(row.id)}
        label={t(c, 'openInvoices')}
        responsive="scroll"
        emptyTitle={t(c, 'noInvoices')}
        emptyMessage=""
        columns={[
          { key: 'name', label: t(c, 'invoiceName'), cell: (row) => String(row.name) },
          { key: 'date', label: t(c, 'invoiceDate'), kind: 'date', cell: (row) => String(row.date) },
          { key: 'due', label: t(c, 'dueDate'), kind: 'date', cell: (row) => String(row.due) },
          { key: 'state', label: t(c, 'orderState'), cell: (row) => String(row.state) },
          {
            key: 'amount',
            label: t(c, 'amount'),
            align: 'end',
            kind: 'currency',
            cell: (row) => String(row.amount),
          },
        ]}
      />
    }
  />
)

export const customerDefinition: RecordModalDefinition<Data> = {
  kind: 'sale.customer',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id) => `/admin/sales/customers/${encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'new') : String(c.data.record.name)),
  pageActions: (c) => (
    <ActionGroup
      actions={[
        <CustomerHelp lang={c.data.lang} />,
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        <RecordCloseTrigger>
          <Button label={c.t('recordModal.close')} />
        </RecordCloseTrigger>,
        ...(c.data.save
          ? [<Button type="submit" form={formId} variant="primary" label={t(c, 'save')} disabled={c.busy} />]
          : []),
      ]}
    />
  ),
  body: (c) => (
    <Stack
      items={[
        <Surface
          title={t(c, 'contact')}
          body={
            <RecordModalForm
              id={formId}
              kind={c.kind}
              command="save"
              fields={contactFields(c)}
              actions={[]}
            />
          }
        />,
        ...(c.creating ? [] : [creditCard(c), orders(c), invoices(c)]),
      ]}
    />
  ),
  dialogs: {
    credit: {
      title: (c) => t(c, 'creditEdit'),
      size: 'small',
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="credit"
          columns={1}
          fields={[
            relation(c, 'paymentTermId', 'paymentTerm', 'terms', c.data.credit),
            field(c, 'creditLimit', {
              type: 'text',
              inputMode: 'decimal',
              help: t(c, 'creditLimitHint'),
              disabled: c.busy || !c.data.credit,
            }),
          ]}
          actions={[
            <Button
              type="submit"
              label={t(c, 'creditSave')}
              variant="primary"
              disabled={c.busy || !c.data.credit}
            />,
          ]}
        />
      ),
    },
  },
  commands: {
    save: {
      fn: 'sale.saveCustomer',
      input: (form, c) => ({
        id: c.creating ? c.data.draftId : c.id,
        expectedRevision: Number(c.data.record.revision ?? 0),
        kind: String(form.get('kind') ?? 'person'),
        name: String(form.get('name') ?? ''),
        ref: String(form.get('ref') ?? ''),
        vat: String(form.get('vat') ?? ''),
        phone: String(form.get('phone') ?? ''),
        email: String(form.get('email') ?? ''),
        salespersonId: String(form.get('salespersonId') ?? '') || undefined,
        pricelistId: String(form.get('pricelistId') ?? '') || undefined,
      }),
      after: 'open',
    },
    credit: {
      fn: 'sale.saveCustomerCredit',
      input: (form, c) => ({
        partnerId: c.id,
        expectedRevision: Number(c.data.record.revision ?? 0),
        creditLimit: String(form.get('creditLimit') ?? '').trim() || undefined,
        paymentTermId: String(form.get('paymentTermId') ?? '') || undefined,
      }),
      after: 'reload',
    },
  },
}

export const customerPage = createRecordPage(customerDefinition, {
  path: (id) => `/admin/sales/customers/${encodeURIComponent(id)}`,
})
