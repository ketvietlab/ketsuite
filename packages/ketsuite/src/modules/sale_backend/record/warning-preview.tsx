import { Notice, Stack } from '@ketvietlab/design-system'
import { createRecordPanel, type RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
type Data = { warnings: { id: string; name: string; message: string }[]; lang: 'vi' | 'en' }
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
export const warningPreviewDefinition: RecordModalDefinition<Data> = {
  kind: 'sale.warningPreview',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id) => `/admin/sales/warnings/preview?selection=${encodeURIComponent(id)}&lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: () => '',
  commands: {},
  body: (c) =>
    // The notices stand on the page above its first card, as the mock has them: no card of their own.
    c.data.warnings.length ? (
      <Stack
        items={c.data.warnings.map((warning) => (
          <Notice
            title={c.t('sale_backend.warning.title').replace('{name}', warning.name)}
            message={warning.message}
            tone="warning"
          />
        ))}
      />
    ) : null,
}
export const saleWarningPreview = createRecordPanel(warningPreviewDefinition)
