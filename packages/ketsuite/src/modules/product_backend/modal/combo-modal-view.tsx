import {
  AppSwitcherHelp,
  Button,
  DescriptionList,
  Field,
  KET_GRID_NO_CHANGES,
  Notice,
  RecordActions,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import { postedComboItems } from '../combos/item-draft.ts'
import { createRecordModal, recordIsland } from '../../../ui/client/record-modal.tsx'
import type {
  RecordModalContext,
  RecordModalDefinition,
  RecordModalDialog,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import type { ComboModalData } from '../combos/shared.ts'
import { ComboHelp } from '../combos/help.tsx'
import { UNIT_RECORD_MODAL_LABELS } from '../units/labels.ts'
import { HELP } from '../screens/help-words.ts'
type Context = RecordModalContext<ComboModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`product_backend.combo.${key}`)
const formId = 'product-combo-form'
export function comboGridConfig(c: Context): KetGridIslandConfig {
  const editable = c.data.permissions.edit
  const locale = ketGridLocale(c.data.lang)
  return {
    label: t(c, 'items'),
    ...locale,
    ...(!editable ? { labels: { ...locale.labels, instructions: t(c, 'readOnlyInstructions') } } : {}),
    columns: [
      {
        key: 'productId',
        label: t(c, 'product'),
        type: 'combobox',
        editable: true,
        required: true,
        width: 200,
        grow: 1,
        options: c.data.choices,
      },
      {
        key: 'extraPrice',
        label: t(c, 'extraPrice'),
        type: 'text',
        editable: true,
        width: 144,
        align: 'end',
      },
    ],
    rows: c.data.record.items,
    ...(editable
      ? {
          newRow: { productId: '', extraPrice: '0' },
          removable: true,
          reorderable: true,
          name: 'items',
          form: formId,
          carry: c.draft('items', KET_GRID_NO_CHANGES),
        }
      : {}),
    readOnly: c.busy || !editable,
    visibleRows: 6,
  }
}
const ComboItems = ({ context: c }: { context: Context }) => (
  <Stack
    items={[
      recordIsland('backend.ket-grid', { id: `combo-items-${c.id}`, config: comboGridConfig(c) }),
      <Text variant="bodySm" tone="muted">
        {t(c, 'itemsHelp')}
      </Text>,
      c.fieldError('items') ? (
        <Notice tone="danger" title={t(c, 'items')} message={c.fieldError('items')!} />
      ) : null,
    ]}
  />
)

const confirmation = (name: 'archive' | 'restore'): RecordModalDialog<ComboModalData> => ({
  title: (c) => t(c, name),
  view: (c) => <RecordModalForm id={`combo-${name}`} kind={c.kind} command={name} fields={[]} />,
  confirmation: {
    message: (c) => t(c, `${name}Body`),
    label: (c) => t(c, name),
    cancelLabel: (c) => t(c, 'cancel'),
    form: () => `combo-${name}`,
    command: name,
    variant: name === 'archive' ? 'destructive' : 'primary',
    disabled: (c) => c.busy || !c.data.permissions.lifecycle,
  },
})
export const comboModalDefinition: RecordModalDefinition<ComboModalData> = {
  kind: 'product.combo',
  size: 'default',
  labels: () => ({
    ...UNIT_RECORD_MODAL_LABELS[lang()],
    'recordModal.loadFailed':
      lang() === 'en' ? 'The combo choice could not be read.' : 'Không đọc được lựa chọn combo.',
    'recordModal.notFound':
      lang() === 'en'
        ? 'The combo is gone or you cannot view it.'
        : 'Lựa chọn combo không tồn tại hoặc bạn không có quyền xem.',
    'recordModal.saved': lang() === 'en' ? 'Combo saved.' : 'Đã lưu lựa chọn combo.',
  }),
  context: {
    fn: 'product_backend.comboContext',
    input: (id, creating) => ({ ...(creating ? {} : { id }), locale: lang() }),
  },
  title: (c) => t(c, c.creating ? 'createTitle' : c.data.permissions.edit ? 'editTitle' : 'viewTitle'),
  body: (c) => (
    <>
      <Stack
        items={[
          c.data.permissions.edit ? (
            <RecordModalForm
              kind={c.kind}
              id={formId}
              command="save"
              fields={[]}
              body={
                <Stack
                  items={[
                    <Field
                      layout="inline"
                      id={`${formId}-name`}
                      name="name"
                      label={t(c, 'name')}
                      value={c.draft('name', c.data.record.name)}
                      required
                      maxLength={40}
                      help={t(c, 'nameHelp')}
                      error={c.fieldError('name')}
                      disabled={c.busy}
                    />,
                    <ComboItems context={c} />,
                  ]}
                />
              }
            />
          ) : (
            <Stack
              items={[
                <DescriptionList items={[{ id: 'name', label: t(c, 'name'), value: c.data.record.name }]} />,
                <ComboItems context={c} />,
              ]}
            />
          ),
          c.fieldError('expectedRevisionId') ? (
            <Notice tone="warning" title={c.fieldError('expectedRevisionId')!} message="" />
          ) : null,
          !c.creating ? (
            <DescriptionList
              items={[
                {
                  id: 'status',
                  label: t(c, 'status'),
                  value: t(c, c.data.record.active ? 'active' : 'archived'),
                },
                { id: 'products', label: t(c, 'productCount'), value: String(c.data.usage.products) },
                { id: 'usage', label: t(c, 'usage'), value: c.data.usage.names.join(', ') || t(c, 'none') },
              ]}
            />
          ) : null,
        ]}
      />
      <ComboHelp lang={c.data.lang} id="product-combo-record-help" />
    </>
  ),
  actions: (c) => (
    <RecordActions
      actions={[
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        ...(!c.creating && c.data.permissions.lifecycle
          ? [
              <RecordDialogTrigger dialog={c.data.record.active ? 'archive' : 'restore'}>
                <Button
                  label={t(c, c.data.record.active ? 'archive' : 'restore')}
                  variant="secondary"
                  disabled={c.busy}
                />
              </RecordDialogTrigger>,
            ]
          : []),
        <RecordCloseTrigger>
          <Button
            label={c.data.permissions.edit ? t(c, 'cancel') : c.t('recordModal.close')}
            variant="secondary"
          />
        </RecordCloseTrigger>,
        ...(c.data.permissions.edit
          ? [
              <Button
                type="submit"
                form={formId}
                label={t(c, c.creating ? 'create' : 'save')}
                variant="primary"
                loading={c.busy}
              />,
            ]
          : []),
      ]}
    />
  ),
  dialogs: { archive: confirmation('archive'), restore: confirmation('restore') },
  commands: {
    save: {
      fn: 'product.saveCombo',
      input: (form, c) => ({
        id: c.data.record.id,
        ...(c.creating ? {} : { expectedRevisionId: c.data.record.revisionId }),
        name: String(form.get('name') ?? ''),
        items: postedComboItems(c.data.record.items, String(form.get('items') ?? '')),
      }),
      after: 'close',
    },
    archive: {
      fn: 'product.setComboActive',
      input: (_form, c) => ({ id: c.id, active: false, expectedRevisionId: c.data.record.revisionId }),
      after: 'reload',
    },
    restore: {
      fn: 'product.setComboActive',
      input: (_form, c) => ({ id: c.id, active: true, expectedRevisionId: c.data.record.revisionId }),
      after: 'reload',
    },
  },
}
export const comboModal = createRecordModal(comboModalDefinition)
