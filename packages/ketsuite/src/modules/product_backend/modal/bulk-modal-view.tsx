import { AppSwitcherHelp, Button, Field, Notice, RecordActions, Stack, Text } from '@ketvietlab/design-system'
import type { FieldOption, RelationSelectLabels } from '@ketvietlab/design-system'
import {
  createRecordModal,
  recordIsland,
  type RecordModalContext,
  type RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
import { RecordCloseTrigger, RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import type { BulkModalData } from '../bulk/shared.ts'
import { UNIT_RECORD_MODAL_LABELS } from '../units/labels.ts'
import { BulkHelp } from '../bulk/help.tsx'
import { HELP } from '../screens/help-words.ts'
type Context = RecordModalContext<BulkModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`product_backend.bulk.${key}`)
const formId = 'product-bulk-edit-form'
function choice(c: Context, name: string, label: string, options: FieldOption[]) {
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
  ) as unknown as RelationSelectLabels
  // The picker offers fields and values, not records: its prompt says so (P55, "Chọn…").
  labels.choose = t(c, 'choose')
  labels.dialogTitle = label
  return (
    <Field
      id={`${formId}-${name}`}
      name={name}
      label={label}
      required
      error={c.fieldError(name)}
      control={recordIsland('backend.relation-select', {
        id: `${formId}-${name}`,
        config: {
          name,
          ariaLabel: label,
          value: c.state(name, c.draft(name, '')) || null,
          options,
          required: true,
          labels,
          disabled: c.busy,
        },
      })}
    />
  )
}
export const bulkModalDefinition: RecordModalDefinition<BulkModalData> = {
  kind: 'product.bulkEdit',
  size: 'default',
  resetRelationsOnChange: { field: ['value'] },
  labels: () => ({
    ...UNIT_RECORD_MODAL_LABELS[lang()],
    'recordModal.loadFailed':
      lang() === 'en' ? 'The selected products could not be read.' : 'Không đọc được các sản phẩm đã chọn.',
    'recordModal.notFound':
      lang() === 'en'
        ? 'Select up to 200 active products that you may edit.'
        : 'Chọn tối đa 200 sản phẩm đang dùng mà bạn có quyền sửa.',
    'recordModal.saved':
      lang() === 'en'
        ? 'Bulk edit saved. Changed products have SUA history.'
        : 'Đã sửa hàng loạt. Sản phẩm đã đổi có lịch sử SUA.',
  }),
  context: {
    fn: 'product_backend.bulkContext',
    input: () => ({
      products:
        typeof location === 'undefined' ? [] : new URL(location.href).searchParams.getAll('bulkProduct'),
      locale: lang(),
    }),
  },
  title: (c) => t(c, 'title'),
  body: (c) => {
    const field = c.state('field', c.draft('field', ''))
    const options = ['saleOk', 'purchaseOk', 'isStorable'].includes(field)
      ? [
          { value: 'true', label: t(c, 'yes') },
          { value: 'false', label: t(c, 'no') },
        ]
      : c.data.choices[field]
    return (
      <>
        <RecordModalForm
          kind={c.kind}
          id={formId}
          command="save"
          fields={[]}
          body={
            <Stack
              items={[
                <Notice
                  tone="info"
                  title={t(c, 'selection')}
                  message={c.data.products.map((p) => p.name).join(', ')}
                />,
                choice(c, 'field', t(c, 'field'), c.data.fields),
                !field ? (
                  <Text tone="muted">{t(c, 'chooseField')}</Text>
                ) : options ? (
                  choice(c, 'value', t(c, 'value'), options)
                ) : (
                  <Field
                    id={`${formId}-value`}
                    name="value"
                    label={t(c, 'value')}
                    type={field === 'saleDelay' ? 'number' : 'text'}
                    inputMode="decimal"
                    min={0}
                    max={field === 'saleDelay' ? 365 : undefined}
                    value={c.draft('value', '')}
                    required
                    disabled={c.busy}
                    error={c.fieldError('value')}
                  />
                ),
                <Text tone="muted">{t(c, 'atomic')}</Text>,
              ]}
            />
          }
        />
        <BulkHelp lang={c.data.lang} />
      </>
    )
  },
  actions: (c) => (
    <RecordActions
      actions={[
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        <RecordCloseTrigger>
          <Button label={t(c, 'cancel')} variant="secondary" />
        </RecordCloseTrigger>,
        <Button
          type="submit"
          form={formId}
          label={t(c, 'apply')}
          variant="primary"
          loading={c.busy}
          disabled={!c.state('field', c.draft('field', ''))}
        />,
      ]}
    />
  ),
  commands: {
    save: {
      fn: 'product.bulkEditProducts',
      input: (form, c) => ({
        id: c.data.id,
        products: c.data.products.map(({ id, revision }) => ({ id, revision })),
        field: String(form.get('field') ?? ''),
        value: String(form.get('value') ?? ''),
        locale: c.data.lang,
      }),
      after: 'close',
    },
  },
}
export const bulkModal = createRecordModal(bulkModalDefinition)
