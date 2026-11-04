import { Button, Surface, Text } from '@ketvietlab/design-system'
import { createRecordPanel, type RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordDialogTrigger, RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
type Data = {
  record: { message: string; revision: number; enabled: boolean }
  save: boolean
  lang: 'vi' | 'en'
}
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
export const customerWarningDefinition: RecordModalDefinition<Data> = {
  kind: 'sale.customerWarning',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id) => `/admin/sales/customers/${encodeURIComponent(id)}/warning?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => c.t('sale_backend.configuration.warnings'),
  // The customer's page keeps its one save button: the warning reads here and is edited in a dialog.
  body: (c) =>
    !c.data.record.enabled ? null : (
      <Surface
        title={c.t('sale_backend.configuration.warnings')}
        actions={
          c.data.save ? (
            <RecordDialogTrigger dialog="edit">
              <Button label={c.t('sale_backend.customerWarning.edit')} disabled={c.busy} />
            </RecordDialogTrigger>
          ) : undefined
        }
        body={
          c.data.record.message ? (
            <Text>{c.data.record.message}</Text>
          ) : (
            <Text tone="muted">{c.t('sale_backend.customerWarning.empty')}</Text>
          )
        }
      />
    ),
  dialogs: {
    edit: {
      title: (c) => c.t('sale_backend.configuration.warnings'),
      size: 'small',
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="save"
          columns={1}
          fields={[
            {
              id: 'sale-customer-warning',
              name: 'message',
              type: 'textarea',
              rows: 3,
              maxLength: 300,
              span: 'full',
              label: c.t('sale_backend.configuration.warnings'),
              help: c.t('sale_backend.customerWarning.hint'),
              value: c.draft('message', c.data.record.message),
              disabled: c.busy || !c.data.save,
              error: c.fieldError('message') ?? c.fieldError('expectedRevision'),
            },
          ]}
          actions={[
            <Button
              type="submit"
              label={c.t('sale_backend.customerWarning.save')}
              variant="primary"
              disabled={c.busy || !c.data.save}
            />,
          ]}
        />
      ),
    },
  },
  commands: {
    save: {
      fn: 'sale.savePartnerWarning',
      input: (form, c) => ({
        partnerId: c.id,
        message: String(form.get('message') ?? ''),
        expectedRevision: c.data.record.revision,
      }),
      after: 'reload',
    },
  },
}
export const customerWarningPanel = (props: { partnerId: string; lang: string }) =>
  createRecordPanel(customerWarningDefinition)({
    id: props.partnerId,
    title: '',
    loading: props.lang === 'en' ? 'Loading' : 'Đang tải',
  })
