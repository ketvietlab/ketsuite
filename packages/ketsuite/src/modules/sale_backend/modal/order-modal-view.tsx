import { invoicePreview } from './invoice-preview.tsx'
import { saleWarningSelection } from '../record/warning-selection.ts'
import { copyAction, copyDialog, copyCommand } from './copy-dialog.tsx'
import { benefitSection, benefitDialogs, benefitCommands } from './benefit-dialogs.tsx'
import { discountAction, discountDialog, discountCommand } from './discount-dialog.tsx'
import { templateActions, templateCommands, templateDialogs, templateField } from './template-dialogs.tsx'
import { SaleLineGrid, canUseSaleLineGrid, postedLineGrid } from './line-grid.tsx'
import {
  ActionGroup,
  Menu,
  AppSwitcherHelp,
  Badge,
  Button,
  DataTable,
  Notice,
  Inline,
  DescriptionList,
  Field,
  LinkButton,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import type { FieldProps, RelationSelectConfig } from '@ketvietlab/design-system'
import { createRecordPage, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import type { RecordPageIslandProps } from '../../../ui/record-modal.tsx'
import {
  RecordActionForm,
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { salesOrderPath, salesSectionPath } from '../order-path.ts'

type Row = Record<string, unknown>
export type SaleOrderModalData = {
  saleWarningsOn?: boolean
  /** Set when the customer is over their credit limit counting this order (D12). */
  creditWarning?: string | null
  record: Row & { lines: Row[]; pickings: Row[]; moves?: Row[]; invoices: Row[]; deposits?: Row[] }
  permissions: Record<string, boolean>
  /** Islands other modules place beside the order: its conversation and activities. */
  collaboration?: Array<{ id: string; island: string }>
  /** The documents this state prints, as links. */
  reports?: Array<{ label: string; href: string }>
  loyalty?: { label: string; href: string } | null
  choices: Record<string, Row[]>
  lang: 'vi' | 'en'
  draftId: string
  benefits?: {
    applied: Row[]
    available: Row[]
    cards: Row[]
    pointsEarned: unknown
    pointsSpent: unknown
    rewardSummaries?: Record<string, string>
  }
  templateSections?: Array<Row & { existing: { id: string; revision: number; active: boolean } | null }>
  matrices?: Row[]
  /** Saved lines' unit costs, for a viewer who may read them. */
  lineCosts?: Row[]
  costSummary?: { margin: string | null; label: string; currency: unknown }
  /** Who changed the order and how (D7), newest first, formatted for the reader. */
  history?: Array<{
    id: string
    when: string
    actor: string
    action: string
    detail: string
    detailHref: string | null
  }>
}
type Context = RecordModalContext<SaleOrderModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`sale_backend.${key}`)
const locallyOwned = (c: Context) => !c.data.record.orderAuthority || c.data.record.orderAuthority === 'local'
const canEdit = (c: Context) =>
  locallyOwned(c) && ['draft', 'sent'].includes(String(c.data.record.state)) && !c.data.record.locked
const catalogueHref = (id: string) => {
  const url = new URL(typeof location === 'undefined' ? 'https://record.invalid' : location.href)
  url.pathname = `/admin/sales/catalogue/${encodeURIComponent(id)}`
  for (const key of [...url.searchParams.keys()])
    if (!['lang', 'company', 'branch'].includes(key)) url.searchParams.delete(key)
  return url.pathname + url.search
}
export const catalogueDraftInput = (c: Context) => {
  const draft = c.recordDraft ?? c.draft
  const grid = new FormData()
  grid.set('lines', draft('lines', JSON.stringify({ added: [], updated: [], removed: [], order: null })))
  const shippingPolicy = draft('shippingPolicy', String(c.data.record.shippingPolicy ?? 'direct'))
  const day = String(c.data.record.commitmentDay ?? c.data.record.commitmentDate ?? '').slice(0, 10)
  const commitmentDate = draft('commitmentDate', day)
  return {
    id: c.id,
    expectedRevision: Number(c.data.record.revision),
    ...(canUseSaleLineGrid(c) ? { changes: postedLineGrid(grid) } : {}),
    ...(shippingPolicy !== (c.data.record.shippingPolicy ?? 'direct') ? { shippingPolicy } : {}),
    ...(commitmentDate !== day ? { commitmentDate: commitmentDate || null } : {}),
  }
}
const catalogueAction = (c: Context) =>
  !c.data.permissions.getCatalogue || c.creating ? null : c.data.permissions.saveCatalogueDraft &&
    locallyOwned(c) &&
    !c.data.record.locked &&
    ['draft', 'sent', 'sale'].includes(String(c.data.record.state)) ? (
    <RecordActionForm kind={c.kind} command="catalogue">
      <Button type="submit" label={t(c, 'catalogue.title')} disabled={c.busy} />
    </RecordActionForm>
  ) : (
    <LinkButton label={t(c, 'catalogue.title')} href={catalogueHref(c.id)} />
  )
const options = (c: Context, name: string) =>
  (c.data.choices[name] ?? []).map((row) => ({ value: String(row.id), label: String(row.name) }))
const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  // The layer that owns the input names it: a field in a dialog does not share the record's ids.
  id: `sale-${c.draftScope === 'dialog' ? (c.dialog?.name ?? 'record') : 'record'}-${name}`,
  name,
  label: t(c, `field.${label}`),
  locale: c.data.lang,
  ...props,
  value: c.draft(name, String(props.value ?? '')),
  error: c.fieldError(name),
  disabled: c.busy || props.disabled,
})
const action = (c: Context, command: string, label: string, primary = false) => (
  <RecordActionForm kind={c.kind} command={command}>
    <Button
      type="submit"
      label={t(c, `action.${label}`)}
      variant={primary ? 'primary' : 'secondary'}
      disabled={c.busy}
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
const relationField = (
  c: Context,
  name: string,
  label: string,
  config: Partial<RelationSelectConfig>,
  choose?: string,
  dialogTitle?: string,
): FieldProps => {
  const base = field(c, name, label, { required: config.required ?? true })
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
      'create',
      'edit',
      'save',
      'cancel',
      'remove',
      'confirmRemove',
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
        required: true,
        disabled: c.busy,
        invalid: Boolean(base.error),
        describedBy: base.error ? `${base.id}-error` : undefined,
        labels: { ...labels, dialogTitle: dialogTitle ?? base.label, ...(choose ? { choose } : {}) },
        ...config,
      },
    }),
  }
}
// Who sells it and with which team (D16). Creating, empty means the customer's salesperson or the
// creator and their team; on a saved order the pickers hold its own.
const salesFields = (c: Context, creating: boolean): FieldProps[] =>
  (c.data.choices.salespeople ?? []).length || (c.data.choices.teams ?? []).length
    ? [
        relationField(c, 'userId', 'salesperson', {
          required: false,
          options: options(c, 'salespeople'),
          ...(creating ? {} : { value: String(c.data.record.userId ?? '') || null }),
        }),
        {
          ...relationField(c, 'teamId', 'team', {
            required: false,
            options: options(c, 'teams'),
            ...(creating ? {} : { value: String(c.data.record.teamId ?? '') || null }),
          }),
          ...(creating ? { help: t(c, 'sales.createHelp') } : {}),
        },
      ]
    : []
// The customer is found on the server and can be created on the spot, as on the list's
// former create page; the company's own partners are not customers.
const customerField = (c: Context): FieldProps =>
  relationField(
    c,
    'partnerId',
    'customer',
    {
      options: (c.data.choices.partners ?? []).map((row) => ({
        value: String(row.id),
        label: row.ref ? `${String(row.ref)} · ${String(row.name)}` : String(row.name),
      })),
      manager: {
        listFunction: 'partner.listPartners',
        // A partner that only supplies the company is not offered as a customer (P48).
        listInput: { includeArchived: false, customers: true },
        // A contact book outgrows any preload: typing searches the server.
        searchInDropdown: true,
        excludeIds: (c.data.choices.ownPartners ?? []).map((row) => String(row.id)),
        saveFunction: 'partner.savePartner',
        saveDefaults: { kind: 'company' },
        fields: [
          { name: 'name', label: c.t('partner_backend.field.name'), required: true },
          {
            name: 'kind',
            label: c.t('partner_backend.field.kind'),
            type: 'select',
            required: true,
            options: ['company', 'person'].map((value) => ({ value, label: c.t(`partner.kind.${value}`) })),
          },
          { name: 'ref', label: c.t('partner_backend.field.ref') },
          { name: 'email', label: c.t('partner_backend.field.email'), type: 'email' },
          { name: 'phone', label: c.t('partner_backend.field.phone'), type: 'tel' },
        ],
      },
    },
    undefined,
    t(c, 'relation.customers'),
  )
// A tenant without a warehouse cannot quote yet: say where to create one instead of a dead end.
const warehouseField = (c: Context): FieldProps => {
  const warehouses = options(c, 'warehouses')
  // K15: the only warehouse comes chosen; what the seller picks stays picked.
  const chosen = c.draft('warehouseId', String(c.data.record.warehouseId ?? ''))
  const base = relationField(c, 'warehouseId', 'warehouse', {
    options: warehouses,
    disabled: c.busy || warehouses.length === 0,
    value: chosen || null,
  })
  return warehouses.length ? base : { ...base, help: t(c, 'setup.warehouse') }
}
export const deliveryFields = (c: Context): FieldProps[] => [
  field(c, 'shippingPolicy', 'shippingPolicy', {
    layout: 'inline',
    type: 'select',
    value: String(c.data.record.shippingPolicy ?? 'direct'),
    options: ['direct', 'one'].map((value) => ({ value, label: t(c, `shippingPolicy.${value}`) })),
  }),
  field(c, 'commitmentDate', 'commitmentDate', {
    layout: 'inline',
    type: 'date',
    value: String(c.data.record.commitmentDay ?? c.data.record.commitmentDate ?? '').slice(0, 10),
    help: `${t(c, 'field.expectedDate')}: ${String((c.data.record.display as Row | undefined)?.expectedDate ?? c.data.record.expectedDate ?? '—')}`,
  }),
]
const deliveryPlan = (c: Context) =>
  !c.data.permissions.saveDeliveryPromise ||
  !locallyOwned(c) ||
  c.data.record.locked ||
  !['draft', 'sent', 'sale'].includes(String(c.data.record.state)) ? null : (
    <Surface
      title={t(c, 'delivery.plan')}
      body={
        <RecordModalForm
          kind={c.kind}
          command="saveDeliveryPromise"
          fields={deliveryFields(c)}
          actions={[<Button type="submit" label={t(c, 'action.saveDeliveryPromise')} disabled={c.busy} />]}
        />
      }
    />
  )
// A form never sits on the page's canvas: the quotation's terms are one titled card.
const create = (c: Context) => <Surface title={t(c, 'order.information.title')} body={createForm(c)} />
const createForm = (c: Context) => (
  <RecordModalForm
    kind={c.kind}
    command={
      c.data.permissions.templateCreate && c.data.permissions.templateChoices
        ? 'createWithTemplate'
        : 'create'
    }
    fields={[
      ...(c.data.permissions.templateCreate && c.data.permissions.templateChoices
        ? [templateField(c, 'quotation', false)]
        : []),
      customerField(c),
      warehouseField(c),
      field(c, 'clientOrderRef', 'clientOrderRef'),
      relationField(c, 'pricelistId', 'pricelist', {
        required: false,
        options: options(c, 'pricelists'),
      }),
      relationField(c, 'paymentTermId', 'paymentTerm', {
        required: false,
        options: options(c, 'terms'),
      }),
      ...salesFields(c, true),
      field(c, 'dateOrder', 'dateOrder', { type: 'date' }),
      field(c, 'validityDate', 'validityDate', { type: 'date' }),
      ...deliveryFields(c),
      field(c, 'notes', 'notes', { type: 'textarea', span: 'full' }),
    ]}
    actions={[<Button type="submit" label={t(c, 'action.create')} variant="primary" disabled={c.busy} />]}
  />
)
// The order reads as one long page of titled cards, in the order it is worked on: its
// terms, its lines, then what was delivered and invoiced once there is any.
const warningNotices = (c: Context) =>
  c.data.saleWarningsOn && c.data.permissions.previewWarnings && c.data.record.state !== 'cancel'
    ? recordIsland('sale.warning-preview', {
        id: JSON.stringify(saleWarningSelection(c.data.record, c.recordDraft ?? c.draft)),
        title: '',
        loading: c.t('backend.relation.loading'),
      })
    : null
const creditNotice = (c: Context) =>
  c.data.creditWarning ? (
    <Notice tone="warning" title={c.t('sale_backend.customers.overTitle')} message={c.data.creditWarning} />
  ) : null
const summary = (c: Context) => (
  <Stack
    items={[
      creditNotice(c),
      warningNotices(c),
      <Surface
        title={t(c, 'order.information.title')}
        actions={
          c.creating ||
          !(c.data.permissions.setOrderSalesperson || c.data.permissions.setOrderTags) ? undefined : (
            <ActionGroup
              actions={[
                ...(c.data.permissions.setOrderSalesperson
                  ? [
                      <RecordDialogTrigger dialog="sales">
                        <Button label={t(c, 'sales.action')} disabled={c.busy || c.recordChanged} />
                      </RecordDialogTrigger>,
                    ]
                  : []),
                ...(c.data.permissions.setOrderTags
                  ? [
                      <RecordDialogTrigger dialog="tags">
                        <Button label={t(c, 'tags.action')} disabled={c.busy || c.recordChanged} />
                      </RecordDialogTrigger>,
                    ]
                  : []),
              ]}
            />
          )
        }
        body={information(c)}
      />,
      // Where the order's delivery plan is still open, it is set beside its terms (P51).
      ...(deliveryPlan(c) ? [deliveryPlan(c)] : []),
      benefitSection(c),
      lineSection(c),
      ...(c.data.permissions.getLineCosts ? [lineCosts(c)] : []),
      ...(c.data.record.moves?.length ? [deliveries(c)] : []),
      ...(c.data.record.deposits?.length || canDeposit(c) ? [deposits(c)] : []),
      ...(c.data.record.invoices.length || canInvoice(c) ? [invoices(c)] : []),
      ...(c.data.history ? [history(c)] : []),
    ]}
  />
)
const INFORMATION_LABELS: Record<string, string> = {
  partnerName: 'customer',
  warehouseName: 'warehouse',
  pricelistName: 'pricelist',
  paymentTermName: 'paymentTerm',
  tagNames: 'tags',
  userName: 'salesperson',
  teamName: 'team',
}
const information = (c: Context) => (
  <DescriptionList
    items={[
      'partnerName',
      'clientOrderRef',
      'dateOrder',
      'validityDate',
      // The page names the delivery plan in its rail; the modal, which has none, here.
      ...(c.presentation === 'page' ? [] : ['commitmentDate', 'expectedDate', 'shippingPolicy']),
      'warehouseName',
      'pricelistName',
      'paymentTermName',
      ...(c.creating ? [] : ['userName', 'teamName', 'tagNames']),
      'amountUntaxed',
      'amountTax',
      'amountTotal',
      'invoiceStatus',
      'notes',
    ]
      .map((key) => ({
        id: key,
        label: t(c, `field.${INFORMATION_LABELS[key] ?? key}`),
        value: String((c.data.record.display as Row | undefined)?.[key] ?? c.data.record[key] ?? '—') || '—',
      }))
      .concat(
        c.data.permissions.getLineCosts && c.data.costSummary
          ? [{ id: 'orderMargin', label: t(c, 'grid.orderMargin'), value: c.data.costSummary.label }]
          : [],
      )}
  />
)
const taxNames = (row: Row) =>
  ((row.taxEvidence as { taxes?: Row[] } | null | undefined)?.taxes ?? [])
    .map((tax) => String(tax.name))
    .join(', ')
// An open, locally owned quotation or order edits its lines in one grid and saves them at once
// (line-grid.tsx), including one with deliveries or invoices; a reader without the grid reads them.
// The lines card's commands: discount, templates, catalogue, variant quantities, optional sections.
const lineActions = (c: Context) => (
  <ActionGroup
    actions={[
      discountAction(c),
      ...templateActions(c),
      catalogueAction(c),
      !c.creating &&
      c.data.permissions.saveCatalogueDraft &&
      c.data.permissions.setVariantMatrix &&
      c.data.permissions.getVariantMatrix &&
      locallyOwned(c) &&
      !c.data.record.locked &&
      ['draft', 'sent', 'sale'].includes(String(c.data.record.state)) &&
      c.data.matrices?.length ? (
        <RecordActionForm kind={c.kind} command="openVariantMatrix">
          <Menu
            id={'sale-matrices-' + c.id}
            label={t(c, 'matrix.title')}
            items={c.data.matrices.map((row) => ({
              id: String(row.id),
              label: String(row.name),
              name: 'templateId',
              value: String(row.id),
              disabled: c.busy,
            }))}
          />
        </RecordActionForm>
      ) : null,
      // Price the quotation again by its pricelist, or by another one (D14).
      canEdit(c) && !c.creating && c.data.permissions.updatePrices ? (
        <RecordDialogTrigger dialog="prices">
          <Button label={t(c, 'prices.action')} disabled={c.busy || c.recordChanged} />
        </RecordDialogTrigger>
      ) : null,
      canEdit(c) &&
      c.data.permissions.setOptionalSections &&
      c.data.record.lines.some((line) => line.displayType === 'section') ? (
        <RecordDialogTrigger dialog="optionalSections">
          <Button label={t(c, 'grid.optionalSections')} disabled={c.busy || c.recordChanged} />
        </RecordDialogTrigger>
      ) : null,
    ]}
  />
)
const lineSection = (c: Context) => {
  if (canUseSaleLineGrid(c))
    return (
      <Surface title={t(c, 'modal.lines')} actions={lineActions(c)} body={<SaleLineGrid context={c} />} />
    )
  // Without the grid the lines are read: a document's lines are edited only in its KetGrid.
  const table = (
    <DataTable
      rows={c.data.record.lines}
      id={(row) => String(row.id)}
      label={t(c, 'modal.lines')}
      emptyTitle={t(c, 'lines.empty')}
      emptyMessage=""
      responsive="scroll"
      gutter="compact"
      columns={[
        {
          key: 'productCode',
          label: t(c, 'field.product'),
          kind: 'identifier',
          width: 'narrow',
          cell: (row) => String(row.productCode || (row.productId ? '—' : '')),
        },
        {
          key: 'name',
          label: t(c, 'grid.description'),
          cell: (row) =>
            `${String(row.name)}${row.displayType === 'section' && row.optionalSection ? ` · ${t(c, 'grid.optional')}` : ''}`,
        },
        {
          key: 'productUomName',
          label: t(c, 'field.uom'),
          cell: (row) => String(row.productUomName ?? row.productUomId ?? ''),
        },
        {
          key: 'productUomQty',
          label: t(c, 'field.quantity'),
          align: 'end',
          kind: 'number',
          cell: (row) => (row.displayType ? '' : String(row.productUomQty)),
        },
        {
          key: 'qtyDelivered',
          label: t(c, 'field.delivered'),
          align: 'end',
          kind: 'number',
          cell: (row) => (row.displayType ? '' : String(row.qtyDelivered)),
        },
        {
          key: 'qtyInvoiced',
          label: t(c, 'field.invoiced'),
          align: 'end',
          kind: 'number',
          cell: (row) => (row.displayType ? '' : String(row.qtyInvoiced ?? '0')),
        },
        {
          key: 'priceUnit',
          label: t(c, 'field.priceUnit'),
          align: 'end',
          kind: 'currency',
          cell: (row) => (row.displayType ? '' : String(row.priceUnitLabel ?? row.priceUnit)),
        },
        {
          key: 'discount',
          label: t(c, 'field.discount'),
          align: 'end',
          kind: 'number',
          cell: (row) => (row.displayType ? '' : `${String(row.discount ?? '0')} %`),
        },
        {
          key: 'tax',
          label: t(c, 'field.tax'),
          cell: (row) => (row.displayType ? '' : taxNames(row) || '—'),
        },
        {
          key: 'subtotal',
          label: t(c, 'field.subtotal'),
          align: 'end',
          kind: 'currency',
          cell: (row) => (row.displayType ? '' : String(row.priceSubtotalLabel ?? row.priceSubtotal ?? '0')),
        },
      ]}
    />
  )
  return <Surface title={t(c, 'modal.lines')} actions={lineActions(c)} body={table} />
}
const canInvoice = (c: Context) =>
  locallyOwned(c) && c.data.record.state === 'sale' && c.data.permissions.createInvoice === true
// Saved lines' unit costs: what the order earns is for staff, never on the customer's copy.
const lineCosts = (c: Context) => (
  <Surface
    title={t(c, 'cost.saved')}
    body={
      <DataTable
        rows={c.data.lineCosts ?? []}
        id={(row) => String(row.lineId)}
        label={t(c, 'cost.saved')}
        responsive="scroll"
        columns={[
          { key: 'name', label: t(c, 'field.product'), cell: (row) => String(row.name) },
          { key: 'unitName', label: t(c, 'field.uom'), cell: (row) => String(row.unitName) },
          {
            key: 'unitCost',
            label: t(c, 'cost.perUnit'),
            align: 'end',
            kind: 'currency',
            cell: (row) => String(row.unitCostLabel ?? t(c, 'cost.unknown')),
          },
          {
            key: 'margin',
            label: t(c, 'cost.margin'),
            align: 'end',
            kind: 'currency',
            cell: (row) => String(row.marginLabel ?? t(c, 'cost.unknown')),
          },
          { key: 'currency', label: t(c, 'cost.currency'), cell: (row) => String(row.currency) },
        ]}
        emptyTitle={t(c, 'cost.noSnapshot')}
        emptyMessage=""
      />
    }
  />
)
/** A delivery's or invoice's state in words; an unknown state shows as stored. */
const stateLabel = (c: Context, kind: 'delivery' | 'invoice', state: unknown) => {
  const key = `sale_backend.${kind}.state.${String(state)}`
  const label = c.t(key)
  return label === key ? String(state ?? '') : label
}
// A delivery or invoice opens where the viewer may read it.
const linked = (label: string, href: unknown) =>
  href ? <LinkButton label={label} href={String(href)} variant="tertiary" /> : label
const deliveries = (c: Context) => (
  <Surface
    title={t(c, 'modal.deliveries')}
    body={
      <DataTable
        rows={c.data.record.moves ?? []}
        id={(row) => String(row.id)}
        label={t(c, 'modal.deliveries')}
        responsive="scroll"
        emptyTitle={t(c, 'delivery.empty')}
        emptyMessage={t(c, 'delivery.emptyHint')}
        columns={[
          {
            key: 'name',
            label: t(c, 'field.name'),
            cell: (row) => linked(String(row.origin ?? row.pickingId ?? row.id), row.pickingHref),
          },
          { key: 'product', label: t(c, 'field.product'), cell: (row) => String(row.productName ?? '') },
          {
            key: 'quantity',
            label: t(c, 'field.delivered'),
            align: 'end',
            kind: 'number',
            cell: (row) => String(row.quantity),
          },
          { key: 'state', label: t(c, 'field.state'), cell: (row) => stateLabel(c, 'delivery', row.state) },
        ]}
      />
    }
  />
)
const invoices = (c: Context) => (
  <Surface
    title={t(c, 'modal.invoices')}
    actions={canInvoice(c) ? dialog(c, 'bill', 'createInvoice') : undefined}
    body={
      <DataTable
        rows={c.data.record.invoices}
        id={(row) => String(row.id)}
        label={t(c, 'modal.invoices')}
        responsive="scroll"
        emptyTitle={t(c, 'invoice.empty')}
        emptyMessage={t(c, 'invoice.emptyHint')}
        columns={[
          { key: 'name', label: t(c, 'field.name'), cell: (row) => linked(String(row.name), row.href) },
          { key: 'state', label: t(c, 'field.state'), cell: (row) => stateLabel(c, 'invoice', row.state) },
          {
            key: 'total',
            label: t(c, 'field.amountTotal'),
            align: 'end',
            kind: 'currency',
            cell: (row) => String(row.amountTotalLabel ?? row.amountTotal),
          },
        ]}
      />
    }
  />
)
// Who changed the order and how (D7): the mock's last block, newest first.
const history = (c: Context) => (
  <Surface
    title={t(c, 'modal.history')}
    body={
      <DataTable
        rows={c.data.history ?? []}
        id={(row) => String(row.id)}
        label={t(c, 'modal.history')}
        responsive="scroll"
        emptyTitle={t(c, 'history.empty')}
        emptyMessage={t(c, 'history.emptyHint')}
        columns={[
          { key: 'when', label: t(c, 'history.when'), cell: (row) => row.when },
          { key: 'actor', label: t(c, 'history.actor'), cell: (row) => row.actor },
          { key: 'action', label: t(c, 'history.action'), cell: (row) => row.action },
          { key: 'detail', label: t(c, 'history.detail'), cell: (row) => linked(row.detail, row.detailHref) },
        ]}
      />
    }
  />
)
// A deposit is a customer receipt, not an invoice (D9): taken on a sent quotation or a confirmed
// order, then set off against the order's posted invoice.
const canDeposit = (c: Context) =>
  locallyOwned(c) &&
  ['sent', 'sale'].includes(String(c.data.record.state)) &&
  c.data.permissions.collectDeposit === true
const openDeposits = (c: Context) => (c.data.record.deposits ?? []).filter((row) => Number(row.unapplied) > 0)
const postedInvoices = (c: Context) => c.data.record.invoices.filter((row) => row.state === 'posted')
const canApplyDeposit = (c: Context) =>
  locallyOwned(c) &&
  c.data.permissions.applyDeposit === true &&
  openDeposits(c).length > 0 &&
  postedInvoices(c).length > 0
const deposits = (c: Context) => (
  <Surface
    title={t(c, 'modal.deposits')}
    actions={
      canDeposit(c) || canApplyDeposit(c) ? (
        <ActionGroup
          actions={[
            canDeposit(c) && dialog(c, 'deposit', 'collectDeposit'),
            canApplyDeposit(c) && dialog(c, 'applyDeposit', 'applyDeposit'),
          ]}
        />
      ) : undefined
    }
    body={
      <DataTable
        rows={c.data.record.deposits ?? []}
        id={(row) => String(row.id)}
        label={t(c, 'modal.deposits')}
        responsive="scroll"
        emptyTitle={t(c, 'deposit.empty')}
        emptyMessage={t(c, 'deposit.emptyHint')}
        columns={[
          { key: 'name', label: t(c, 'field.receipt'), cell: (row) => linked(String(row.name), row.href) },
          {
            key: 'date',
            label: t(c, 'field.depositDate'),
            cell: (row) => String(row.dateLabel ?? row.date ?? ''),
          },
          {
            key: 'journal',
            label: t(c, 'field.depositJournal'),
            cell: (row) => String(row.journalName ?? ''),
          },
          {
            key: 'amount',
            label: t(c, 'field.amountTotal'),
            align: 'end',
            kind: 'currency',
            cell: (row) => String(row.amountLabel ?? row.amount),
          },
          {
            key: 'unapplied',
            label: t(c, 'field.unapplied'),
            align: 'end',
            kind: 'currency',
            cell: (row) => String(row.unappliedLabel ?? row.unapplied),
          },
        ]}
      />
    }
  />
)
// What changes the order beyond its next step — reset, lock, cancel — sits in the header
// beside it, as on the server page it replaces.
const stateActions = (c: Context) => [
  ...(c.data.record.state === 'cancel' && c.data.permissions.resetOrder ? [action(c, 'reset', 'reset')] : []),
  ...(c.data.record.state === 'sale' && c.data.permissions.lockOrder
    ? [action(c, c.data.record.locked ? 'unlock' : 'lock', c.data.record.locked ? 'unlock' : 'lock')]
    : []),
  ...(c.data.record.state !== 'cancel' &&
  !c.data.record.locked &&
  !c.data.record.moves?.some((row) => row.state === 'done') &&
  c.data.permissions.cancelOrder
    ? [action(c, 'cancel', 'cancel')]
    : []),
]
// The order's address in a list: its Back still returns to the list it came from, unless that
// list no longer holds it.
const sectionOf = (section: 'quotations' | 'orders', id: string): string => {
  const url = new URL(location.href)
  url.pathname = `${salesSectionPath(section)}/${encodeURIComponent(id)}`
  const back = url.searchParams.get('returnTo')
  if (
    back &&
    !back.startsWith('/admin/sales?') &&
    back !== '/admin/sales' &&
    !back.startsWith(salesSectionPath(section))
  )
    url.searchParams.delete('returnTo')
  return `${url.pathname}${url.search}`
}
export const saleOrderModalDefinition: RecordModalDefinition<SaleOrderModalData> = {
  observeDrafts: ['lines'],
  kind: 'sale.order',
  // Wide even while new: the quotation's terms take the form's two columns instead of one long column.
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/sales/record/${record}/context?lang=${lang()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'action.create') : String(c.data.record.name)),
  status: (c) =>
    c.creating ? null : (
      <Inline
        items={[
          <Badge label={t(c, `state.${c.data.record.state}`)} />,
          ...(c.data.record.locked ? [<Badge label={t(c, 'order.locked')} tone="warning" />] : []),
        ]}
      />
    ),
  body: (c) => (c.creating ? <Stack items={[warningNotices(c), create(c)]} /> : summary(c)),
  // The page's guide sits in the content slot (screens/order-page.tsx); its Help button
  // is the way to it where the rail is hidden.
  pageActions: (c) => (
    <ActionGroup
      actions={[
        <RecordCloseTrigger>
          <Button label={t(c, 'action.back')} variant="secondary" />
        </RecordCloseTrigger>,
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        ...(c.data.loyalty ? [<LinkButton label={c.data.loyalty.label} href={c.data.loyalty.href} />] : []),
        ...(c.data.reports?.length
          ? [
              <ActionGroup
                label={t(c, 'order.print')}
                actions={c.data.reports.map((report) => (
                  <LinkButton label={report.label} href={report.href} />
                ))}
              />,
            ]
          : []),
        ...(!c.creating && locallyOwned(c)
          ? [
              ...(c.data.record.state === 'draft' && c.data.permissions.sendQuotation
                ? [action(c, 'send', 'send')]
                : []),
              ...(['draft', 'sent'].includes(String(c.data.record.state)) && c.data.permissions.confirmOrder
                ? [action(c, 'confirm', 'confirm', true)]
                : []),
              ...(c.data.record.state === 'sale' && c.data.permissions.syncDeliveries
                ? [action(c, 'sync', 'sync')]
                : []),
              ...stateActions(c),
              copyAction(c),
            ]
          : []),
      ]}
    />
  ),
  // The rail holds the order's delivery plan (P51), then its conversation and activities.
  pageAside: (c) =>
    c.creating ? undefined : (
      <Stack
        items={[
          <Surface
            title={t(c, 'delivery.dates')}
            body={
              <DescriptionList
                items={['commitmentDate', 'expectedDate', 'shippingPolicy'].map((key) => ({
                  id: key,
                  label: t(c, `field.${key}`),
                  value: String(
                    (c.data.record.display as Row | undefined)?.[key] ?? c.data.record[key] ?? '—',
                  ),
                }))}
              />
            }
          />,
          ...(c.data.collaboration?.length
            ? [
                <Surface
                  title={t(c, 'order.collaboration.label')}
                  body={
                    <Stack
                      items={c.data.collaboration.map((entry) =>
                        recordIsland(entry.island, {
                          resModel: 'sale.Order',
                          resId: c.id,
                          lang: c.data.lang,
                        }),
                      )}
                    />
                  }
                />,
              ]
            : []),
        ]}
      />
    ),
  pageAsideLabel: (c) => t(c, 'order.aside.label'),
  pageAsideWhenStacked: 'after',
  // The rail sits beside the order only where the lines still have room for their columns (D22).
  pageAsideBreakpoint: 'wide',
  dialogs: {
    copy: copyDialog,
    ...benefitDialogs,
    ...templateDialogs,
    discount: discountDialog,
    tags: {
      title: (c) => t(c, 'tags.action'),
      size: 'small',
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="tags"
          columns={1}
          fields={[
            relationField(
              c,
              'tagIds',
              'tags',
              {
                multiple: true,
                required: false,
                value: null,
                values: (c.data.record.tagIds as string[] | undefined) ?? [],
                options: options(c, 'tags'),
              },
              t(c, 'tags.choose'),
            ),
          ]}
          body={<Text>{t(c, 'tags.help')}</Text>}
          actions={[<Button type="submit" variant="primary" label={t(c, 'tags.save')} disabled={c.busy} />]}
        />
      ),
    },
    sales: {
      title: (c) => t(c, 'sales.action'),
      size: 'small',
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="sales"
          columns={1}
          fields={salesFields(c, false)}
          body={<Text>{t(c, 'sales.help')}</Text>}
          actions={[<Button type="submit" variant="primary" label={t(c, 'sales.save')} disabled={c.busy} />]}
        />
      ),
    },
    prices: {
      title: (c) => t(c, 'prices.action'),
      size: 'small',
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="prices"
          columns={1}
          fields={[
            relationField(c, 'pricelistId', 'pricelist', {
              required: false,
              value: String(c.data.record.pricelistId ?? '') || null,
              options: options(c, 'pricelists'),
            }),
          ]}
          body={<Notice tone="info" title={t(c, 'prices.title')} message={t(c, 'prices.message')} />}
          actions={[
            <Button
              type="submit"
              variant="primary"
              label={t(c, 'prices.apply')}
              disabled={c.busy || c.recordChanged}
            />,
          ]}
        />
      ),
    },
    optionalSections: {
      title: (c) => t(c, 'grid.optionalSections'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="optionalSections"
          fields={[]}
          body={
            c.recordChanged ? (
              <Notice tone="warning" title={t(c, 'grid.saveBeforeSections')} message="" />
            ) : (
              <Stack
                items={c.data.record.lines
                  .filter((line) => line.displayType === 'section')
                  .map((line, index) => (
                    <Field
                      id={`sale-optional-${index}`}
                      name="sectionIds"
                      label={String(line.name)}
                      type="checkbox"
                      submitValue={String(line.id)}
                      checked={c.draftChecked('sectionIds', String(line.id), line.optionalSection === true)}
                      disabled={c.busy}
                    />
                  ))}
              />
            )
          }
          actions={[
            <Button
              type="submit"
              variant="primary"
              label={t(c, 'grid.save')}
              disabled={c.busy || c.recordChanged || !c.data.permissions.setOptionalSections}
            />,
          ]}
        />
      ),
    },
    deposit: {
      title: (c) => t(c, 'action.collectDeposit'),
      view: (c) => (
        <Stack
          items={[
            <Notice
              tone="info"
              title={t(c, 'deposit.notInvoice')}
              message={t(c, 'deposit.notInvoiceHint')}
            />,
            <RecordModalForm
              kind={c.kind}
              command="deposit"
              fields={[
                {
                  ...field(c, 'mode', 'deposit', { type: 'select', value: 'percent' }),
                  label: t(c, 'deposit.mode'),
                  options: ['percent', 'amount'].map((value) => ({
                    value,
                    label: t(c, `deposit.mode.${value}`),
                  })),
                },
                {
                  ...field(c, 'value', 'deposit', { required: true, inputMode: 'decimal' }),
                  label: t(c, 'deposit.value'),
                  error: c.fieldError('value') ?? c.fieldError('percent') ?? c.fieldError('amount'),
                },
                relationField(c, 'journalId', 'depositJournal', {
                  options: (c.data.choices.journals ?? [])
                    .filter((row) => row.type === 'bank' || row.type === 'cash')
                    .map((row) => ({ value: String(row.id), label: String(row.name) })),
                  required: true,
                }),
                relationField(c, 'receivableAccountId', 'receivableAccount', {
                  options: (c.data.choices.accounts ?? [])
                    .filter((row) => row.accountType === 'asset_receivable')
                    .map((row) => ({ value: String(row.id), label: String(row.name) })),
                  required: true,
                }),
                field(c, 'date', 'depositDate', { type: 'date' }),
                field(c, 'memo', 'memo'),
              ]}
              actions={[
                <Button
                  type="submit"
                  label={t(c, 'action.collectDeposit')}
                  variant="primary"
                  disabled={c.busy}
                />,
              ]}
            />,
          ]}
        />
      ),
    },
    applyDeposit: {
      title: (c) => t(c, 'action.applyDeposit'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="applyDeposit"
          fields={[
            relationField(c, 'paymentId', 'deposit', {
              options: openDeposits(c).map((row) => ({
                value: String(row.id),
                label: `${String(row.name)} · ${String(row.unappliedLabel ?? row.unapplied)}`,
              })),
              required: true,
            }),
            relationField(c, 'invoiceId', 'invoice', {
              options: postedInvoices(c).map((row) => ({ value: String(row.id), label: String(row.name) })),
              required: true,
            }),
          ]}
          actions={[
            <Button type="submit" label={t(c, 'action.applyDeposit')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
    bill: {
      title: (c) => t(c, 'action.createInvoice'),
      view: (c) => (
        <Stack
          items={[
            invoicePreview(c),
            <RecordModalForm
              kind={c.kind}
              command="bill"
              fields={[
                relationField(c, 'journalId', 'journal', {
                  options: (c.data.choices.journals ?? [])
                    .filter((row) => row.type === 'sale')
                    .map((row) => ({ value: String(row.id), label: String(row.name) })),
                  required: true,
                }),
                ...(['revenueAccountId', 'receivableAccountId', 'taxAccountId'] as const).map((name) =>
                  relationField(c, name, name.replace('Id', ''), {
                    options: (c.data.choices.accounts ?? [])
                      .filter(
                        (row) =>
                          name === 'taxAccountId' ||
                          (name === 'revenueAccountId'
                            ? String(row.accountType).startsWith('income')
                            : row.accountType === 'asset_receivable'),
                      )
                      .map((row) => ({ value: String(row.id), label: String(row.name) })),
                    required: name !== 'taxAccountId',
                  }),
                ),
                field(c, 'invoiceDate', 'invoiceDate', { type: 'date' }),
              ]}
              actions={[
                <Button
                  type="submit"
                  label={t(c, 'action.createInvoice')}
                  variant="primary"
                  disabled={c.busy}
                />,
              ]}
            />,
          ]}
        />
      ),
    },
  },
  commands: {
    copy: copyCommand,
    ...benefitCommands,
    ...templateCommands,
    discount: discountCommand,
    tags: {
      fn: 'sale.setOrderTags',
      input: (form, c) => ({
        id: c.id,
        tagIds: String(form.get('tagIds') ?? '')
          .split(',')
          .filter(Boolean),
      }),
      after: 'reload',
    },
    sales: {
      fn: 'sale.setOrderSalesperson',
      input: (form, c) => {
        const userId = String(form.get('userId') ?? '') || null
        const teamId = String(form.get('teamId') ?? '') || null
        // A team left as it was follows a new salesperson; one changed here stays as chosen.
        return {
          id: c.id,
          userId,
          ...(teamId !== (c.data.record.teamId || null) ? { teamId } : {}),
        }
      },
      after: 'reload',
    },
    prices: {
      fn: 'sale.updatePrices',
      input: (form, c) => ({
        id: c.id,
        expectedRevision: Number(c.data.record.revision),
        pricelistId: String(form.get('pricelistId') ?? '') || null,
      }),
      after: 'reload',
    },
    openVariantMatrix: {
      fn: 'sale.saveCatalogueDraft',
      input: (form, c) => ({ ...catalogueDraftInput(c), templateId: String(form.get('templateId') ?? '') }),
      clearRecordDrafts: ['lines', 'shippingPolicy', 'commitmentDate'],
      navigate: (value, c) => {
        const url = new URL(catalogueHref(c.id), location.href)
        url.pathname = salesOrderPath(c.data.record.state, c.id)
        url.searchParams.set('record', 'sale.variantMatrix:' + String((value as Row).templateId))
        url.searchParams.set('matrixOrderId', c.id)
        return url.pathname + url.search
      },
      after: 'stay',
    },
    catalogue: {
      fn: 'sale.saveCatalogueDraft',
      input: (_form, c) => catalogueDraftInput(c),
      issueField: () => '',
      navigate: (_value, c) => catalogueHref(c.id),
      after: 'stay',
    },
    optionalSections: {
      fn: 'sale.setOptionalSections',
      issueField: () => '',
      input: (form, c) => ({
        id: c.id,
        expectedRevision: Number(c.data.record.revision),
        sectionIds: form.getAll('sectionIds').map(String),
      }),
      after: 'reload',
    },
    saveDeliveryPromise: {
      fn: 'sale.saveDeliveryPromise',
      input: (form, c) => ({
        id: c.id,
        expectedRevision: Number(c.data.record.revision),
        shippingPolicy: String(form.get('shippingPolicy') ?? 'direct'),
        commitmentDate: String(form.get('commitmentDate') ?? '') || null,
      }),
      after: 'reload',
    },
    saveLines: {
      fn: 'sale.applyLineGrid',
      // Grid values live in a hidden field: surface refusals in the record's visible summary.
      issueField: () => '',
      input: (form, c) => ({
        id: c.id,
        expectedRevision: Number(c.data.record.revision),
        changes: postedLineGrid(form),
      }),
      after: 'reload',
    },
    create: {
      fn: 'sale.createOrder',
      input: (form, c) => ({
        id: c.data.draftId,
        ...input(form, [
          'partnerId',
          'warehouseId',
          'pricelistId',
          'paymentTermId',
          'clientOrderRef',
          'dateOrder',
          'validityDate',
          'commitmentDate',
          'shippingPolicy',
          'notes',
          // Empty: the customer's salesperson or the creator, and their team (D16).
          'userId',
          'teamId',
        ]),
      }),
      after: 'open',
    },
    send: { fn: 'sale.sendQuotation', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    // Confirm and cancel go through the order-command route, which picks `loyalty_sale` where it
    // is composed. A confirmed quotation is an order, a cancelled or reset one a quotation: the
    // page moves to the address of the list it now belongs to.
    confirm: {
      route: '/admin/sales/order-command',
      input: (_form, c) => ({
        command: 'confirmOrder',
        id: c.id,
        expectedRevision: Number(c.data.record.revision),
      }),
      navigate: (_value, c) => sectionOf('orders', c.id),
      after: 'reload',
    },
    reset: {
      fn: 'sale.resetOrder',
      input: (_form, c) => ({ id: c.id }),
      navigate: (_value, c) => sectionOf('quotations', c.id),
      after: 'reload',
    },
    sync: { fn: 'sale.syncDeliveries', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    lock: { fn: 'sale.lockOrder', input: (_form, c) => ({ id: c.id, locked: true }), after: 'reload' },
    unlock: { fn: 'sale.lockOrder', input: (_form, c) => ({ id: c.id, locked: false }), after: 'reload' },
    cancel: {
      route: '/admin/sales/order-command',
      input: (_form, c) => ({
        command: 'cancelOrder',
        id: c.id,
        expectedRevision: Number(c.data.record.revision),
      }),
      navigate: (_value, c) => sectionOf('quotations', c.id),
      after: 'reload',
      confirm: (c) => t(c, 'modal.confirmCancel'),
    },
    bill: {
      fn: 'sale.createInvoice',
      input: (form, c) => ({
        id: c.data.draftId,
        orderId: c.id,
        ...input(form, [
          'journalId',
          'revenueAccountId',
          'receivableAccountId',
          'taxAccountId',
          'invoiceDate',
        ]),
      }),
      after: 'reload',
    },
    deposit: {
      fn: 'sale.collectDeposit',
      input: (form, c) => ({
        id: c.data.draftId,
        orderId: c.id,
        [form.get('mode') === 'amount' ? 'amount' : 'percent']: String(form.get('value') ?? ''),
        ...input(form, ['journalId', 'receivableAccountId', 'date', 'memo']),
      }),
      after: 'reload',
    },
    applyDeposit: {
      fn: 'sale.applyDeposit',
      input: (form, c) => ({ orderId: c.id, ...input(form, ['paymentId', 'invoiceId']) }),
      after: 'reload',
    },
  },
}

// A quotation or order is a page of its own, not a modal over its list: the lines grid
// needs the width, and the order is worked on, not glanced at. It stays at
// the address it opened on; `new` becomes the quotation's id once created.
const PATH = (id: string): string =>
  `${id !== 'new' && location.pathname.startsWith('/admin/sales/orders/') ? '/admin/sales/orders' : '/admin/sales/quotations'}/${encodeURIComponent(id)}`
export const saleOrderPage = (props: RecordPageIslandProps) =>
  createRecordPage(saleOrderModalDefinition, { path: PATH })(props)
