import { ActionGroup, AppSwitcherHelp, Button, Stack, Surface, Text } from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordPage, type RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordCloseTrigger, RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { SalesConfigurationHelp } from '../screens/configuration-help.tsx'

type Data = {
  record: {
    revision: number
    requireProduct: boolean
    saleWarnings: boolean
    quotationValidityDays: number | null
    onlineSignature: boolean
    onlinePayment: boolean
    prepaymentPercent: string | null
    lockConfirmed: boolean
    goodsInvoicePolicy: 'order' | 'delivery'
  }
  save: boolean
  lang: 'vi' | 'en'
}
type Context = Parameters<NonNullable<RecordModalDefinition<Data>['body']>>[0]
const t = (c: Context, key: string) => c.t(`sale_backend.configuration.${key}`)
const check = (c: Context, name: keyof Data['record'], label: string, help?: string): FieldProps => ({
  id: `sale-configuration-${name}`,
  name,
  type: 'checkbox',
  submitValue: '1',
  checked: c.draftChecked(name, '1', c.data.record[name] === true),
  label: t(c, label),
  ...(help ? { help: t(c, help) } : {}),
  error: c.fieldError(name),
  disabled: c.busy || !c.data.save,
})
const save = (c: Context) =>
  c.data.save
    ? [<Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />]
    : []
const flag = (form: FormData, name: string) => form.get(name) === '1'
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
export const salesConfigurationDefinition: RecordModalDefinition<Data> = {
  kind: 'sale.configuration',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: { route: () => `/admin/sales/configuration/context?lang=${lang()}`, query: ['company', 'branch'] },
  title: (c) => c.t('sale_backend.configuration.title'),
  pageActions: (c) => (
    <ActionGroup
      actions={[
        <SalesConfigurationHelp lang={c.data.lang} />,
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
          body={
            <RecordModalForm
              id="sale-configuration-form"
              kind={c.kind}
              command="save"
              fields={[
                check(c, 'saleWarnings', 'warnings', 'warningsHint'),
                {
                  ...check(c, 'requireProduct', 'requireProduct', 'hint'),
                  error: c.fieldError('expectedRevision'),
                },
              ]}
              actions={save(c)}
            />
          }
        />,
        // What a new quotation asks for (D20).
        <Surface
          title={t(c, 'quotations')}
          body={
            <RecordModalForm
              id="sale-configuration-quotations"
              kind={c.kind}
              command="saveQuotations"
              fields={[
                {
                  id: 'sale-configuration-quotationValidityDays',
                  name: 'quotationValidityDays',
                  type: 'number',
                  min: 1,
                  max: 365,
                  step: '1',
                  inputMode: 'numeric',
                  label: t(c, 'validity'),
                  help: t(c, 'validityHint'),
                  value: c.draft('quotationValidityDays', String(c.data.record.quotationValidityDays ?? '')),
                  error: c.fieldError('quotationValidityDays'),
                  disabled: c.busy || !c.data.save,
                },
                check(c, 'onlineSignature', 'signature'),
                check(c, 'onlinePayment', 'payment'),
                {
                  id: 'sale-configuration-prepaymentPercent',
                  name: 'prepaymentPercent',
                  type: 'number',
                  min: 0,
                  max: 100,
                  step: '0.01',
                  inputMode: 'decimal',
                  label: t(c, 'prepayment'),
                  help: t(c, 'prepaymentHint'),
                  value: c.draft('prepaymentPercent', String(c.data.record.prepaymentPercent ?? '')),
                  error: c.fieldError('prepaymentPercent'),
                  disabled: c.busy || !c.data.save,
                },
              ]}
              body={<Text>{t(c, 'newOnly')}</Text>}
              actions={save(c)}
            />
          }
        />,
        // What happens when a quotation is confirmed (D20).
        <Surface
          title={t(c, 'orders')}
          body={
            <RecordModalForm
              id="sale-configuration-orders"
              kind={c.kind}
              command="saveOrders"
              fields={[
                check(c, 'lockConfirmed', 'lock', 'lockHint'),
                {
                  id: 'sale-configuration-goodsInvoicePolicy',
                  name: 'goodsInvoicePolicy',
                  type: 'select',
                  label: t(c, 'invoicePolicy'),
                  help: t(c, 'invoicePolicyHint'),
                  value: c.draft('goodsInvoicePolicy', c.data.record.goodsInvoicePolicy),
                  options: ['order', 'delivery'].map((value) => ({
                    value,
                    label: c.t(`sale_backend.invoicePolicy.${value}`),
                  })),
                  error: c.fieldError('goodsInvoicePolicy'),
                  disabled: c.busy || !c.data.save,
                },
              ]}
              actions={save(c)}
            />
          }
        />,
      ]}
    />
  ),
  commands: {
    save: {
      fn: 'sale.saveConfiguration',
      input: (form, c) => ({
        saleWarnings: flag(form, 'saleWarnings'),
        requireProduct: flag(form, 'requireProduct'),
        expectedRevision: c.data.record.revision,
      }),
      after: 'reload',
    },
    saveQuotations: {
      fn: 'sale.saveConfiguration',
      input: (form, c) => ({
        quotationValidityDays: String(form.get('quotationValidityDays') ?? '').trim()
          ? Number(form.get('quotationValidityDays'))
          : null,
        onlineSignature: flag(form, 'onlineSignature'),
        onlinePayment: flag(form, 'onlinePayment'),
        prepaymentPercent: String(form.get('prepaymentPercent') ?? '').trim() || null,
        expectedRevision: c.data.record.revision,
      }),
      after: 'reload',
    },
    saveOrders: {
      fn: 'sale.saveConfiguration',
      input: (form, c) => ({
        lockConfirmed: flag(form, 'lockConfirmed'),
        goodsInvoicePolicy: String(form.get('goodsInvoicePolicy') ?? 'order'),
        expectedRevision: c.data.record.revision,
      }),
      after: 'reload',
    },
  },
}
export const salesConfigurationPage = createRecordPage(salesConfigurationDefinition, {
  path: () => '/admin/sales/configuration',
})
