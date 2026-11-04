import { Button, Notice } from '@ketvietlab/design-system'
import { createRecordModal, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
type Row = Record<string, unknown>
type Data = { record: Row; save: boolean; draftId: string; products: Row[]; locations: Row[]; lots: Row[] }
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
export const inventoryCountDefinition: RecordModalDefinition<Data> = {
  kind: 'stock.count',
  size: 'small',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/stock/count/${record}/context?lang=${lang()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => c.t('stock_backend.adjustment.title'),
  body: (c) => (
    <RecordModalForm
      columns={1}
      kind={c.kind}
      fields={[
        ['productId', 'product', c.data.products],
        ['locationId', 'location', c.data.locations.filter((row) => row.id === `${row.warehouseId}:stock`)],
      ].map(([name, label, rows]) => {
        const key = String(name)
        const id = `inventory-count-${key}`
        return {
          id,
          name: key,
          label: c.t(`stock_backend.field.${label}`),
          required: true,
          error: c.fieldError(key),
          control: recordIsland('backend.relation-select', {
            id,
            config: {
              name: key,
              triggerId: id,
              required: true,
              disabled: c.busy || !c.data.save,
              value: c.draft(key, String(c.data.record[key] ?? '')) || null,
              ariaLabel: c.t(`stock_backend.field.${label}`),
              options: (rows as Row[]).map((row) => ({ value: String(row.id), label: String(row.name) })),
              labels: Object.fromEntries(
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
              ),
            },
          }),
        }
      })}
      body={
        <Notice
          tone="info"
          title={c.t('stock_backend.count.openSession')}
          message={c.t('stock_backend.count.approvalRequired')}
        />
      }
      actions={
        c.data.save
          ? [
              <Button
                type="submit"
                name="__command"
                value="apply"
                variant="primary"
                label={c.t('stock_backend.count.openSession')}
                disabled={c.busy}
              />,
            ]
          : []
      }
    />
  ),
  commands: {
    apply: {
      fn: 'stock.requestInventoryCount',
      input: (form, c) => ({
        id: c.data.draftId,
        productId: String(form.get('productId') ?? ''),
        locationId: String(form.get('locationId') ?? ''),
      }),
      navigate: (value, c) => {
        const query = new URL(c.href(''), 'http://local').searchParams
        query.set('record', `stock.countSession:${String((value as Row).id)}`)
        return `/admin/stock/counts?${query}`
      },
    },
  },
}
export const inventoryCountModal = createRecordModal(inventoryCountDefinition)
