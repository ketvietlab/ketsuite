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
import type { TagModalData } from './shared.ts'
import { SaleTagHelp } from './help.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
type Context = RecordModalContext<TagModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`sale_backend.tag.${key}`)
const formId = 'sale-tag-form'
const confirmation = (name: 'archive' | 'restore'): RecordModalDialog<TagModalData> => ({
  title: (c) => t(c, name),
  view: (c) => <RecordModalForm id={`sale-tag-${name}`} kind={c.kind} command={name} fields={[]} />,
  confirmation: {
    message: (c) => t(c, `${name}Body`),
    label: (c) => t(c, name),
    cancelLabel: (c) => t(c, 'cancel'),
    form: () => `sale-tag-${name}`,
    command: name,
    variant: name === 'archive' ? 'destructive' : 'primary',
    disabled: (c) => c.busy || !c.data.permissions.lifecycle,
  },
})
export const saleTagModalDefinition: RecordModalDefinition<TagModalData> = {
  kind: 'sale.tag',
  size: 'small',
  labels: () => {
    const vi = lang() === 'vi'
    return {
      ...USER_RECORD_MODAL_LABELS[lang()],
      'recordModal.loadFailed': vi ? 'Không đọc được thẻ.' : 'The tag could not be read.',
      'recordModal.notFound': vi
        ? 'Thẻ không tồn tại hoặc bạn không có quyền xem.'
        : 'The tag is gone or you cannot view it.',
      'recordModal.saved': vi ? 'Đã lưu thẻ.' : 'Tag saved.',
    }
  },
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/sales/tags/${record}/context?lang=${lang()}`
    },
    query: ['company', 'branch'],
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
                { id: 'orders', label: t(c, 'orderCount'), value: String(c.data.usage.orders) },
              ]}
            />
          ) : null,
        ]}
      />
      <SaleTagHelp lang={c.data.lang} id="sale-tag-record-help" />
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
      fn: 'sale.saveTag',
      input: (form, c) => ({
        id: c.data.record.id,
        ...(c.creating ? {} : { expectedRevisionId: c.data.record.revisionId }),
        name: String(form.get('name') ?? ''),
      }),
      after: 'close',
    },
    archive: {
      fn: 'sale.setTagActive',
      input: (_form, c) => ({ id: c.id, active: false, expectedRevisionId: c.data.record.revisionId }),
      after: 'reload',
    },
    restore: {
      fn: 'sale.setTagActive',
      input: (_form, c) => ({ id: c.id, active: true, expectedRevisionId: c.data.record.revisionId }),
      after: 'reload',
    },
  },
}
export const saleTagModal = createRecordModal(saleTagModalDefinition)
