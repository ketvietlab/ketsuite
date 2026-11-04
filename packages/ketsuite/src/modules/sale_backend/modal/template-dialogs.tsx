import { Button, Menu, Notice } from '@ketvietlab/design-system'
import { quotationWithHistory } from './history.ts'
import type { FieldProps } from '@ketvietlab/design-system'
import {
  recordIsland,
  type RecordModalContext,
  type RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
import { RecordModalForm, RecordDialogTrigger } from '../../../ui/client/record-modal-form.tsx'
import type { SaleOrderModalData } from './order-modal-view.tsx'
type Context = RecordModalContext<SaleOrderModalData>
const t = (c: Context, key: string) => c.t('sale_template.' + key)
const selected = (c: Context) => c.data.templateSections?.find((row) => row.id === c.dialog?.params.id)
export function templateField(c: Context, kind: 'section' | 'quotation', required = true): FieldProps {
  const id = 'sale-template-choice',
    label = t(c, kind)
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
    ].map((key) => [key, c.t('backend.relation.' + key)]),
  )
  return {
    id,
    name: 'templateId',
    label,
    error: c.fieldError('templateId'),
    control: recordIsland('backend.relation-select', {
      id,
      config: {
        name: 'templateId',
        triggerId: id,
        ariaLabel: label,
        value: c.draft('templateId', '') || null,
        required,
        disabled: c.busy,
        labels: { ...labels, dialogTitle: label },
        manager: {
          listFunction: 'sale_template.listChoices',
          listInput: { kind },
          searchInDropdown: true,
          labelField: 'displayName',
          resolveParam: 'id',
        },
      },
    }),
  }
}
const pending = (c: Context) =>
  c.recordChanged ? <Notice tone="warning" title={t(c, 'saveParent')} message="" /> : null
const picker = (c: Context, kind: 'section' | 'quotation') => (
  <RecordModalForm
    kind={c.kind}
    command={kind === 'section' ? 'addTemplateSection' : 'applyQuoteTemplate'}
    fields={c.recordChanged ? [] : [templateField(c, kind)]}
    body={pending(c)}
    actions={[
      <Button
        type="submit"
        variant="primary"
        label={t(c, 'apply')}
        disabled={
          c.busy ||
          c.recordChanged ||
          !c.data.permissions[kind === 'section' ? 'templateAdd' : 'templateApply']
        }
      />,
    ]}
  />
)
export const templateDialogs: NonNullable<RecordModalDefinition<SaleOrderModalData>['dialogs']> = {
  saveTemplateSection: {
    title: (c) => t(c, 'saveSection'),
    view: (c) => (
      <RecordModalForm
        kind={c.kind}
        command="saveTemplateSection"
        fields={[]}
        body={
          pending(c) ?? (
            <Notice tone="info" title={String(selected(c)?.name ?? '')} message={t(c, 'snapshotHint')} />
          )
        }
        actions={[
          <Button
            type="submit"
            variant="primary"
            label={t(c, 'save')}
            disabled={c.busy || c.recordChanged || !selected(c) || !c.data.permissions.templateSave}
          />,
        ]}
      />
    ),
  },
  addTemplateSection: { title: (c) => t(c, 'addSection'), view: (c) => picker(c, 'section') },
  applyQuoteTemplate: { title: (c) => t(c, 'applyQuotation'), view: (c) => picker(c, 'quotation') },
}
export const templateCommands: NonNullable<RecordModalDefinition<SaleOrderModalData>['commands']> = {
  saveTemplateSection: {
    fn: 'sale_template.saveSection',
    issueField: () => '',
    confirm: (c) => (selected(c)?.existing ? t(c, 'overwriteConfirm') : null),
    input: (_form, c) => ({
      id: c.id,
      sectionId: c.dialog?.params.id,
      expectedRevision: Number(c.data.record.revision),
      expectedTemplateRevision: Number(selected(c)?.existing?.revision ?? 0),
      overwrite: Boolean(selected(c)?.existing),
    }),
    after: 'reload',
  },
  addTemplateSection: {
    fn: 'sale_template.addSection',
    issueField: () => '',
    input: (form, c) => ({
      id: c.id,
      templateId: String(form.get('templateId') ?? ''),
      expectedRevision: Number(c.data.record.revision),
    }),
    after: 'reload',
  },
  applyQuoteTemplate: {
    fn: 'sale_template.applyQuotation',
    issueField: () => '',
    confirm: (c) => (c.data.record.lines.length ? t(c, 'replaceConfirm') : null),
    input: (form, c) => ({
      id: c.id,
      templateId: String(form.get('templateId') ?? ''),
      expectedRevision: Number(c.data.record.revision),
      replace: true,
    }),
    after: 'reload',
  },
  createWithTemplate: {
    fn: 'sale_template.createQuotation',
    issueField: () => '',
    input: (form, c) => ({
      id: c.data.draftId,
      ...Object.fromEntries(
        [
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
          'templateId',
        ].flatMap((key) => {
          const value = String(form.get(key) ?? '')
          return value ? [[key, value]] : []
        }),
      ),
    }),
    after: 'open',
  },
}
export function templateActions(c: Context) {
  const local = !c.data.record.orderAuthority || c.data.record.orderAuthority === 'local'
  const editable =
    local && !c.data.record.locked && ['draft', 'sent', 'sale'].includes(String(c.data.record.state))
  const href = (id: string) => {
    // The tab open now: a quotation page has no Info tab, and a link to one leaves the page instead of
    // opening the dialog over it.
    const u = new URL(c.href(c.tab), 'http://ket.local')
    u.searchParams.set('dialog', 'saveTemplateSection')
    u.searchParams.set('dialogId', id)
    return u.pathname + u.search
  }
  return [
    c.data.permissions.templateSave && c.data.record.state !== 'cancel' && c.data.templateSections?.length ? (
      <Menu
        id={'sale-template-sections-' + c.id}
        label={t(c, 'section')}
        items={c.data.templateSections.map((row) => ({
          id: String(row.id),
          label: t(c, 'saveNamed').replace('{name}', String(row.name)),
          href: href(String(row.id)),
          disabled: c.busy,
        }))}
      />
    ) : null,
    editable && c.data.permissions.templateAdd && c.data.permissions.templateChoices ? (
      <RecordDialogTrigger dialog="addTemplateSection">
        <Button label={t(c, 'addSection')} disabled={c.busy} />
      </RecordDialogTrigger>
    ) : null,
    editable &&
    c.data.record.state !== 'sale' &&
    // Applying a template replaces every line, which a quotation with history refuses.
    !quotationWithHistory(c) &&
    c.data.permissions.templateApply &&
    c.data.permissions.templateChoices ? (
      <RecordDialogTrigger dialog="applyQuoteTemplate">
        <Button label={t(c, 'applyQuotation')} disabled={c.busy} />
      </RecordDialogTrigger>
    ) : null,
  ]
}
