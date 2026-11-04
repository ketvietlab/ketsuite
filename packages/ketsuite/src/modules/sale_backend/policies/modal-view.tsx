import {
  AppSwitcherHelp,
  Button,
  DescriptionList,
  Notice,
  RecordActions,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordCloseTrigger, RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import type { PolicyModalData } from './shared.ts'
import { SalePolicyHelp } from './help.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
type Context = RecordModalContext<PolicyModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string, params?: Record<string, string>) =>
  c.t(`sale_backend.policy.${key}`, params)
const formId = 'sale-policy-form'
const goods = (c: Context) => c.data.record.type === 'goods'
const words = (c: Context) => (c.data.lang === 'en' ? 'en' : 'vi')
export const salePolicyModalDefinition: RecordModalDefinition<PolicyModalData> = {
  kind: 'sale.invoicePolicy',
  size: 'small',
  labels: () => {
    const vi = lang() === 'vi'
    return {
      ...USER_RECORD_MODAL_LABELS[lang()],
      'recordModal.loadFailed': vi ? 'Không đọc được sản phẩm.' : 'The product could not be read.',
      'recordModal.notFound': vi
        ? 'Sản phẩm không còn bán hoặc bạn không có quyền xem.'
        : 'The product is no longer sold or you cannot view it.',
      'recordModal.saved': vi ? 'Đã lưu chính sách.' : 'Policy saved.',
    }
  },
  context: {
    route: (id) => `/admin/sales/invoicing-policies/${encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => c.data.record.name,
  body: (c) => (
    <>
      <Stack
        items={[
          <DescriptionList
            columns={3}
            items={[
              { id: 'code', label: t(c, 'defaultCode'), value: c.data.record.defaultCode || '—' },
              { id: 'category', label: t(c, 'categoryName'), value: c.data.record.categoryName || '—' },
              { id: 'type', label: t(c, 'type'), value: t(c, `type.${goods(c) ? 'goods' : 'service'}`) },
            ]}
          />,
          goods(c) ? (
            <RecordModalForm
              kind={c.kind}
              id={formId}
              command="save"
              columns={1}
              fields={[
                {
                  id: `${formId}-invoicePolicy`,
                  name: 'invoicePolicy',
                  type: 'select',
                  label: t(c, 'policy'),
                  help: t(c, 'policyHelp'),
                  value: c.draft('invoicePolicy', c.data.record.invoicePolicy),
                  options: [
                    {
                      value: '',
                      label: t(c, 'followDefault', { policy: t(c, `policy.${c.data.goodsDefault}`) }),
                    },
                    ...['order', 'delivery'].map((value) => ({ value, label: t(c, `policy.${value}`) })),
                  ],
                  error: c.fieldError('invoicePolicy'),
                  disabled: c.busy || !c.data.permissions.edit,
                },
              ]}
            />
          ) : (
            <Text>{t(c, 'serviceNote')}</Text>
          ),
          c.fieldError('expectedRevisionId') ? (
            <Notice tone="warning" title={c.fieldError('expectedRevisionId')!} message="" />
          ) : null,
        ]}
      />
      <SalePolicyHelp lang={words(c)} id="sale-policy-record-help" />
    </>
  ),
  actions: (c) => {
    const edit = goods(c) && c.data.permissions.edit
    return (
      <RecordActions
        actions={[
          <AppSwitcherHelp label={HELP[words(c)].trigger} />,
          <RecordCloseTrigger>
            <Button label={edit ? t(c, 'cancel') : c.t('recordModal.close')} variant="secondary" />
          </RecordCloseTrigger>,
          ...(edit
            ? [<Button type="submit" form={formId} label={t(c, 'save')} variant="primary" loading={c.busy} />]
            : []),
        ]}
      />
    )
  },
  commands: {
    save: {
      fn: 'sale.setInvoicePolicy',
      input: (form, c) => ({
        templateId: c.id,
        invoicePolicy: String(form.get('invoicePolicy') ?? ''),
        expectedRevisionId: c.data.record.revisionId,
      }),
      after: 'close',
    },
  },
}
export const salePolicyModal = createRecordModal(salePolicyModalDefinition)
