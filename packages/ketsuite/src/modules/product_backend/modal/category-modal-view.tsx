import {
  AppSwitcherHelp,
  Button,
  DescriptionList,
  Field,
  Notice,
  RecordActions,
  Stack,
} from '@ketvietlab/design-system'
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
import type { CategoryModalData } from '../categories/shared.ts'
import { CategoryHelp } from '../categories/help.tsx'
import { UNIT_RECORD_MODAL_LABELS } from '../units/labels.ts'
import { HELP } from '../screens/help-words.ts'
type Context = RecordModalContext<CategoryModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`product_backend.category.${key}`)
const formId = 'product-category-form'
const RELATION_LABELS = [
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
]
/** A relation picks from the page's own choices (DS RelationSelect); empty keeps its meaning as the prompt. */
const relation = (
  c: Context,
  props: { id: string; name: string; label: string; options: Array<{ value: string; label: string }> },
  empty: string,
  disabled: boolean,
) => {
  const error = c.fieldError(props.name)
  return recordIsland('backend.relation-select', {
    id: props.id,
    config: {
      name: props.name,
      triggerId: props.id,
      ariaLabel: props.label,
      value:
        c.draft(props.name, String(c.data.record[props.name as keyof typeof c.data.record] ?? '')) || null,
      disabled,
      invalid: Boolean(error),
      describedBy: error ? `${props.id}-error` : undefined,
      options: props.options,
      labels: {
        ...Object.fromEntries(RELATION_LABELS.map((key) => [key, c.t(`backend.relation.${key}`)])),
        choose: empty,
        dialogTitle: props.label,
      },
    },
  })
}
const editable = (c: Context) => c.data.permissions.general || c.data.permissions.accounts
const names = (values: string[], c: Context) => values.join(', ') || t(c, 'none')
const form = (c: Context) => (
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
            disabled={c.busy || !c.data.permissions.general}
          />,
          <Field
            layout="inline"
            id={`${formId}-parent`}
            name="parentId"
            label={t(c, 'parentId')}
            error={c.fieldError('parentId')}
            control={relation(
              c,
              { id: `${formId}-parent`, name: 'parentId', label: t(c, 'parentId'), options: c.data.parents },
              t(c, 'root'),
              c.busy || !c.data.permissions.general,
            )}
          />,
          ...(['income', 'expense'] as const).map((kind) => (
            <Field
              layout="inline"
              id={`${formId}-${kind}`}
              name={`${kind}AccountId`}
              label={t(c, kind)}
              help={`${t(c, 'inherited')}: ${c.data.inherited[kind] || t(c, 'companyDefault')}`}
              error={c.fieldError(`${kind}AccountId`)}
              control={relation(
                c,
                {
                  id: `${formId}-${kind}`,
                  name: `${kind}AccountId`,
                  label: t(c, kind),
                  options: c.data[`${kind}Accounts`],
                },
                t(c, 'inherit'),
                c.busy || !c.data.permissions.accounts,
              )}
            />
          )),
        ]}
      />
    }
  />
)
const readonly = (c: Context) => (
  <DescriptionList
    items={[
      { id: 'path', label: t(c, 'path'), value: c.data.record.path },
      ...(['income', 'expense'] as const).map((kind) => ({
        id: kind,
        label: t(c, kind),
        value:
          c.data[`${kind}Accounts`].find((choice) => choice.value === c.data.record[`${kind}AccountId`])
            ?.label ||
          c.data.inherited[kind] ||
          t(c, 'companyDefault'),
      })),
    ]}
  />
)
const confirmation = (name: 'archive' | 'restore'): RecordModalDialog<CategoryModalData> => ({
  title: (c) => t(c, name),
  view: (c) => <RecordModalForm id={`category-${name}`} kind={c.kind} command={name} fields={[]} />,
  confirmation: {
    message: (c) => t(c, `${name}Body`),
    label: (c) => t(c, name),
    cancelLabel: (c) => t(c, 'cancel'),
    form: () => `category-${name}`,
    command: name,
    variant: name === 'archive' ? 'destructive' : 'primary',
    disabled: (c) =>
      c.busy ||
      !c.data.permissions.lifecycle ||
      !(name === 'archive' ? c.data.canArchive : c.data.canRestore),
  },
})
export const categoryModalDefinition: RecordModalDefinition<CategoryModalData> = {
  kind: 'product.category',
  size: 'small',
  labels: () => ({
    ...UNIT_RECORD_MODAL_LABELS[lang()],
    'recordModal.loadFailed':
      lang() === 'en' ? 'The category could not be read.' : 'Không đọc được nhóm sản phẩm.',
    'recordModal.notFound':
      lang() === 'en'
        ? 'The category is gone or you cannot view it.'
        : 'Nhóm không tồn tại hoặc bạn không có quyền xem.',
    'recordModal.saved': lang() === 'en' ? 'Category saved.' : 'Đã lưu nhóm sản phẩm.',
  }),
  context: {
    fn: 'product_backend.categoryContext',
    input: (id, creating) => ({ ...(creating ? {} : { id }), locale: lang() }),
  },
  title: (c) => t(c, c.creating ? 'createTitle' : editable(c) ? 'editTitle' : 'viewTitle'),
  body: (c) => (
    <>
      <Stack
        items={[
          editable(c) ? form(c) : readonly(c),
          c.fieldError('expectedRevision') ? (
            <Notice tone="warning" title={c.fieldError('expectedRevision')!} message="" />
          ) : null,
          !c.creating ? (
            <DescriptionList
              items={[
                { id: 'products', label: t(c, 'productCount'), value: String(c.data.usage.products) },
                { id: 'children', label: t(c, 'children'), value: names(c.data.usage.children, c) },
                { id: 'pricelists', label: t(c, 'pricelists'), value: names(c.data.usage.pricelists, c) },
              ]}
            />
          ) : null,
          !c.creating && c.data.record.active && !c.data.canArchive ? (
            <Notice tone="info" title={t(c, 'inUse')} message="" />
          ) : null,
          !c.data.record.active && !c.data.canRestore ? (
            <Notice tone="info" title={t(c, 'parentArchived')} message="" />
          ) : null,
        ]}
      />
      <CategoryHelp lang={c.data.lang} id="product-category-record-help" />
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
                  disabled={c.busy || !(c.data.record.active ? c.data.canArchive : c.data.canRestore)}
                />
              </RecordDialogTrigger>,
            ]
          : []),
        <RecordCloseTrigger>
          <Button label={editable(c) ? t(c, 'cancel') : c.t('recordModal.close')} variant="secondary" />
        </RecordCloseTrigger>,
        ...(editable(c)
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
      fn: 'product.saveCategoryRecord',
      input: (form, c) => ({
        id: c.data.record.id,
        expectedRevision: c.creating ? null : c.data.record.revision,
        ...(c.data.permissions.general
          ? { name: String(form.get('name') ?? ''), parentId: String(form.get('parentId') ?? '') || null }
          : {}),
        ...(c.data.permissions.accounts
          ? {
              incomeAccountId: String(form.get('incomeAccountId') ?? '') || null,
              expenseAccountId: String(form.get('expenseAccountId') ?? '') || null,
            }
          : {}),
      }),
      after: 'close',
    },
    archive: {
      fn: 'product.setCategoryActive',
      input: (_form, c) => ({ id: c.id, active: false }),
      after: 'reload',
    },
    restore: {
      fn: 'product.setCategoryActive',
      input: (_form, c) => ({ id: c.id, active: true }),
      after: 'reload',
    },
  },
}
export const categoryModal = createRecordModal(categoryModalDefinition)
