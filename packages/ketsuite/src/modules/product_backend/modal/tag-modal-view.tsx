import {
  AppSwitcherHelp,
  Button,
  DescriptionList,
  Field,
  Notice,
  RecordActions,
  Stack,
} from '@ketvietlab/design-system'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
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
import type { TagModalData } from '../tags/shared.ts'
import { TagHelp } from '../tags/help.tsx'
import { UNIT_RECORD_MODAL_LABELS } from '../units/labels.ts'
import { HELP } from '../screens/help-words.ts'
type Context = RecordModalContext<TagModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`product_backend.tag.${key}`)
const formId = 'product-tag-form'
const confirmation = (name: 'archive' | 'restore'): RecordModalDialog<TagModalData> => ({
  title: (c) => t(c, name),
  view: (c) => <RecordModalForm id={`tag-${name}`} kind={c.kind} command={name} fields={[]} />,
  confirmation: {
    message: (c) => t(c, `${name}Body`),
    label: (c) => t(c, name),
    cancelLabel: (c) => t(c, 'cancel'),
    form: () => `tag-${name}`,
    command: name,
    variant: name === 'archive' ? 'destructive' : 'primary',
    disabled: (c) => c.busy || !c.data.permissions.lifecycle,
  },
})
export const tagModalDefinition: RecordModalDefinition<TagModalData> = {
  kind: 'product.tag',
  size: 'small',
  labels: () => ({
    ...UNIT_RECORD_MODAL_LABELS[lang()],
    'recordModal.loadFailed': lang() === 'en' ? 'The tag could not be read.' : 'Không đọc được thẻ.',
    'recordModal.notFound':
      lang() === 'en'
        ? 'The tag is gone or you cannot view it.'
        : 'Thẻ không tồn tại hoặc bạn không có quyền xem.',
    'recordModal.saved': lang() === 'en' ? 'Tag saved.' : 'Đã lưu thẻ.',
  }),
  context: {
    fn: 'product_backend.tagContext',
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
                <Field
                  layout="inline"
                  id={`${formId}-name`}
                  name="name"
                  label={t(c, 'name')}
                  value={c.draft('name', c.data.record.name)}
                  required
                  maxLength={30}
                  help={t(c, 'nameHelp')}
                  error={c.fieldError('name')}
                  disabled={c.busy}
                />
              }
            />
          ) : (
            <DescriptionList items={[{ id: 'name', label: t(c, 'name'), value: c.data.record.name }]} />
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
      <TagHelp lang={c.data.lang} id="product-tag-record-help" />
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
      fn: 'product.saveTag',
      input: (form, c) => ({
        id: c.data.record.id,
        ...(c.creating ? {} : { expectedRevisionId: c.data.record.revisionId }),
        name: String(form.get('name') ?? ''),
      }),
      after: 'close',
    },
    archive: {
      fn: 'product.setTagActive',
      input: (_form, c) => ({ id: c.id, active: false, expectedRevisionId: c.data.record.revisionId }),
      after: 'reload',
    },
    restore: {
      fn: 'product.setTagActive',
      input: (_form, c) => ({ id: c.id, active: true, expectedRevisionId: c.data.record.revisionId }),
      after: 'reload',
    },
  },
}
export const tagModal = createRecordModal(tagModalDefinition)
