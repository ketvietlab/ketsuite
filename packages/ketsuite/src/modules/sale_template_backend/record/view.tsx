import { ActionGroup, AppSwitcherHelp, Button, KET_GRID_NO_CHANGES, Section } from '@ketvietlab/design-system'
import type { FieldProps, KetGridIslandConfig } from '@ketvietlab/design-system'
import {
  createRecordPage,
  recordIsland,
  type RecordModalDefinition,
  type RecordModalContext,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordModalForm,
  RecordActionForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { ketGridLocale } from '../../sale_backend/modal/line-grid-labels.ts'
import { TemplateHelp } from '../screens/help.tsx'
type Row = Record<string, unknown>
export type Data = {
  record: Row & { lines: Row[]; teamIds: string[] }
  draftId: string
  save: boolean
  lifecycle?: boolean
  lang: 'vi' | 'en'
  teams: Row[]
  units: Row[]
  products: Row[]
}
type Context = RecordModalContext<Data>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, k: string) => c.t('sale_template.' + k)
const kind = (c: Context) =>
  c.creating ? c.state('kind', c.draft('kind', 'quotation')) : String(c.data.record.kind)
const formId = 'sale-template-form'
export function postedTemplateLines(raw: string, saved: Row[]): Row[] {
  const draft = JSON.parse(raw) as {
    added: Array<{ id: string; values: Row }>
    updated: Array<{ id: string; values: Row }>
    removed: string[]
    order: string[] | null
  }
  const rows = new Map(saved.map((row) => [String(row.id), { ...row }]))
  for (const item of draft.updated ?? [])
    if (rows.has(item.id)) rows.set(item.id, { ...rows.get(item.id), ...item.values })
  for (const item of draft.added ?? []) rows.set(item.id, { ...item.values, id: item.id })
  for (const id of draft.removed ?? []) rows.delete(id)
  const order = [...(draft.order ?? []), ...rows.keys()]
  return [...new Set(order)]
    .filter((id) => rows.has(id))
    .map((id) => {
      const row = rows.get(id)!
      return { ...row, productUomQty: String(row.productUomQty ?? 0) }
    })
}
export function templateGrid(c: Context): KetGridIslandConfig {
  const productOptions = c.data.products.map((row) => ({
    value: String(row.id),
    label: String(row.defaultCode || row.displayName || row.id),
  }))
  return {
    label: t(c, 'lines'),
    ...ketGridLocale(c.data.lang),
    kindField: 'displayType',
    fullWidthKey: 'name',
    columns: [
      {
        key: 'productId',
        label: t(c, 'product'),
        type: 'combobox',
        editable: true,
        options: productOptions,
        width: 180,
        resets: ['productUomId'],
        search: {
          listFunction: 'sale_template.searchProducts',
          listInput: { kind: kind(c) },
          labelField: 'defaultCode',
          labelFallbackField: 'name',
          descriptionField: 'name',
          setsFrom: { productUomId: 'uomId' },
        },
      },
      { key: 'name', label: t(c, 'description'), type: 'text', editable: true, width: 260 },
      {
        key: 'productUomId',
        label: t(c, 'unit'),
        type: 'combobox',
        editable: true,
        options: c.data.units.map((row) => ({ value: String(row.id), label: String(row.name) })),
      },
      { key: 'productUomQty', label: t(c, 'quantity'), type: 'number', editable: true },
      ...(kind(c) === 'quotation'
        ? [{ key: 'optional', label: t(c, 'optional'), type: 'checkbox' as const, editable: true }]
        : []),
    ],
    rows: c.data.record.lines.map((row) => ({
      ...row,
      id: String(row.id),
      productUomQty: Number(row.productUomQty),
    })),
    newRows: [
      {
        label: t(c, 'addProduct'),
        row: {
          productId: null,
          productUomId: null,
          productUomQty: 1,
          name: '',
          displayType: null,
          optional: false,
        },
      },
      ...(kind(c) === 'quotation'
        ? [{ label: t(c, 'addHeading'), row: { displayType: 'section', name: '', productUomQty: 0 } }]
        : []),
      { label: t(c, 'addNote'), row: { displayType: 'note', name: '', productUomQty: 0 } },
    ],
    removable: true,
    reorderable: true,
    readOnly: c.busy || !c.data.save,
    visibleRows: 6,
    name: 'lines',
    form: formId,
    carry: c.draft('lines', KET_GRID_NO_CHANGES),
  }
}
function fields(c: Context): FieldProps[] {
  const field = (name: string, props: Partial<FieldProps> = {}): FieldProps => ({
    id: 'template-' + name,
    name,
    label: t(c, name),
    value: c.draft(name, String(c.data.record[name] ?? '')),
    error: c.fieldError(name),
    disabled: c.busy || !c.data.save,
    ...props,
  })
  return [
    field('name', { required: true, maxLength: 80 }),
    field('kind', {
      control: recordStateSelectControl({
        id: 'template-kind',
        name: 'kind',
        state: 'kind',
        value: kind(c),
        disabled: !c.creating || c.busy || !c.data.save,
        options: ['quotation', 'section'].map((value) => ({ value, label: t(c, value) })),
      }),
    }),
    field('ownerName', { readOnly: true, value: String(c.data.record.ownerName ?? '—') }),
    field('teamIds', {
      type: 'checkbox-group',
      options: c.data.teams.map((row) => ({
        value: String(row.id),
        label: String(row.name),
        checked: c.draftChecked('teamIds', String(row.id), c.data.record.teamIds.includes(String(row.id))),
      })),
      help: t(c, 'teamsHint'),
      span: 'full',
    }),
    ...(kind(c) === 'quotation'
      ? [
          field('validityDays', { type: 'number', min: 1, max: 365 }),
          field('requireSignature', {
            type: 'checkbox',
            submitValue: '1',
            checked: c.draftChecked('requireSignature', '1', c.data.record.requireSignature === true),
          }),
          field('requirePayment', {
            type: 'checkbox',
            submitValue: '1',
            checked: c.draftChecked('requirePayment', '1', c.data.record.requirePayment === true),
          }),
          field('prepaymentPercent', {
            type: 'number',
            min: 0,
            max: 100,
            value: c.draft('prepaymentPercent', String(c.data.record.prepaymentPercent ?? 100)),
          }),
          field('notes', { type: 'textarea', span: 'full' }),
        ]
      : []),
  ]
}
export const templateDefinition: RecordModalDefinition<Data> = {
  kind: 'sale.template',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id) => `/admin/sales/templates/${encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'create') : String(c.data.record.name)),
  pageActions: (c) => (
    <ActionGroup
      actions={[
        ...(!c.creating && c.data.lifecycle
          ? [
              <RecordActionForm kind={c.kind} command="lifecycle">
                <Button
                  type="submit"
                  label={t(c, c.data.record.active ? 'archive' : 'restore')}
                  disabled={c.busy || c.recordChanged}
                />
              </RecordActionForm>,
            ]
          : []),
        <TemplateHelp lang={c.data.lang} />,
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
    <RecordModalForm
      id={formId}
      kind={c.kind}
      command="save"
      fields={fields(c)}
      body={
        <Section
          title={t(c, 'lines')}
          body={recordIsland('backend.ket-grid', { id: 'sale-template-grid', config: templateGrid(c) })}
        />
      }
      actions={[]}
    />
  ),
  commands: {
    lifecycle: {
      fn: 'sale_template.setTemplateActive',
      issueField: () => '',
      confirm: (c) => (c.data.record.active ? t(c, 'archiveConfirm') : null),
      input: (_form, c) => ({
        id: c.id,
        expectedRevision: Number(c.data.record.revision),
        active: !c.data.record.active,
      }),
      after: 'reload',
    },
    save: {
      fn: 'sale_template.saveTemplate',
      issueField: () => '',
      input: (form, c) => ({
        id: c.creating ? c.data.draftId : c.id,
        expectedRevision: Number(c.data.record.revision ?? 0),
        name: String(form.get('name') ?? ''),
        kind: kind(c),
        active: c.data.record.active !== false,
        teamIds: form.getAll('teamIds').map(String),
        lines: postedTemplateLines(String(form.get('lines') ?? KET_GRID_NO_CHANGES), c.data.record.lines),
        ...(kind(c) === 'quotation'
          ? {
              validityDays: form.get('validityDays') ? Number(form.get('validityDays')) : null,
              notes: String(form.get('notes') ?? ''),
              requireSignature: form.get('requireSignature') === '1',
              requirePayment: form.get('requirePayment') === '1',
              prepaymentPercent: String(form.get('prepaymentPercent') || '100'),
            }
          : {}),
      }),
      after: 'open',
    },
  },
}
export const templatePage = createRecordPage(templateDefinition, {
  path: (id) => `/admin/sales/templates/${encodeURIComponent(id)}`,
})
