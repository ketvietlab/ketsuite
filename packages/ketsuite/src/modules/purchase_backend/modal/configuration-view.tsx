import { ActionGroup, AppSwitcherHelp, Button, Stack, Surface } from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordPage, type RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordCloseTrigger, RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { PurchaseConfigurationHelp } from '../screens/configuration-help.tsx'

type Data = {
  record: {
    revision: number
    approvalAmount: string | null
    finalApprovalAmount: string | null
    priceTolerance?: string | null
  }
  save: boolean
  lang: 'vi' | 'en'
}
type Context = Parameters<NonNullable<RecordModalDefinition<Data>['body']>>[0]
const t = (c: Context, key: string) => c.t(`purchase_backend.configuration.${key}`)
const amount = (
  c: Context,
  name: 'approvalAmount' | 'finalApprovalAmount' | 'priceTolerance',
  label: string,
): FieldProps => ({
  id: `purchase-configuration-${name}`,
  name,
  type: 'number',
  min: 0,
  step: '0.01',
  inputMode: 'decimal',
  width: 'sm',
  label: t(c, label),
  help: t(c, `${label}Hint`),
  value: c.draft(name, String(c.data.record[name] ?? '')),
  error: c.fieldError(name),
  disabled: c.busy || !c.data.save,
})
const saveButton = (c: Context) =>
  c.data.save
    ? [<Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />]
    : []
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const typed = (form: FormData, name: string) => String(form.get(name) ?? '').trim() || null

export const purchaseConfigurationDefinition: RecordModalDefinition<Data> = {
  kind: 'purchase.configuration',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: () => `/admin/purchase/configuration/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => c.t('purchase_backend.configuration.title'),
  pageActions: (c) => (
    <ActionGroup
      actions={[
        <PurchaseConfigurationHelp lang={c.data.lang} />,
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        <RecordCloseTrigger>
          <Button label={c.t('recordModal.close')} variant="secondary" />
        </RecordCloseTrigger>,
      ]}
    />
  ),
  body: (c) => (
    <Stack
      items={[
        <Surface
          title={t(c, 'approval')}
          body={
            <RecordModalForm
              id="purchase-configuration-approval"
              kind={c.kind}
              command="save"
              fields={[
                amount(c, 'approvalAmount', 'approvalAmount'),
                {
                  ...amount(c, 'finalApprovalAmount', 'finalApprovalAmount'),
                  error: c.fieldError('finalApprovalAmount') ?? c.fieldError('expectedRevision'),
                },
              ]}
              actions={saveButton(c)}
            />
          }
        />,
        <Surface
          title={t(c, 'matching')}
          body={
            <RecordModalForm
              id="purchase-configuration-matching"
              kind={c.kind}
              command="saveTolerance"
              fields={[
                {
                  ...amount(c, 'priceTolerance', 'priceTolerance'),
                  max: 100,
                  error: c.fieldError('priceTolerance') ?? c.fieldError('expectedRevision'),
                },
              ]}
              actions={saveButton(c)}
            />
          }
        />,
      ]}
    />
  ),
  commands: {
    save: {
      fn: 'purchase.saveConfiguration',
      input: (form, c) => ({
        approvalAmount: typed(form, 'approvalAmount'),
        finalApprovalAmount: typed(form, 'finalApprovalAmount'),
        expectedRevision: c.data.record.revision,
      }),
      after: 'reload',
    },
    // Only the tolerance, so saving it never clears a threshold typed in the other form.
    saveTolerance: {
      fn: 'purchase.saveConfiguration',
      input: (form, c) => ({
        priceTolerance: typed(form, 'priceTolerance'),
        expectedRevision: c.data.record.revision,
      }),
      after: 'reload',
    },
  },
}
export const purchaseConfigurationPage = createRecordPage(purchaseConfigurationDefinition, {
  path: () => '/admin/purchase/configuration',
})
