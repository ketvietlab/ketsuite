import { AppSwitcherHelp, Button, Field, RecordActions, Stack } from '@ketvietlab/design-system'
import {
  createRecordModal,
  type RecordModalContext,
  type RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import { PRODUCT_FILTERS, VARIANT_FILTERS, type FilterModalData } from '../filters/state.ts'
import { FilterHelp } from '../filters/help.tsx'
import { filterWords } from '../filters/words.ts'
import { UNIT_RECORD_MODAL_LABELS } from '../units/labels.ts'
import { HELP } from '../screens/help-words.ts'
type Context = RecordModalContext<FilterModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`product_backend.filters.${key}`)
const formId = 'product-saved-filter-form'
export const filterModalDefinition: RecordModalDefinition<FilterModalData> = {
  kind: 'product.savedFilter',
  size: 'default',
  labels: () => ({
    ...UNIT_RECORD_MODAL_LABELS[lang()],
    'recordModal.saved': filterWords[lang()].savedMessage,
  }),
  context: {
    fn: 'product_backend.filterContext',
    input: (id) => ({
      id,
      listKey:
        typeof location !== 'undefined' && location.pathname === '/admin/product/variants'
          ? VARIANT_FILTERS
          : PRODUCT_FILTERS,
      href: typeof location === 'undefined' ? '' : location.href,
      locale: lang(),
    }),
  },
  title: (c) => t(c, c.data.existing ? 'edit' : 'title'),
  body: (c) => (
    <>
      <RecordModalForm
        kind={c.kind}
        id={formId}
        command="save"
        fields={[]}
        body={
          <Stack
            items={[
              <Field
                id={`${formId}-name`}
                name="name"
                label={t(c, 'name')}
                value={c.draft('name', c.data.name)}
                required
                maxLength={60}
                help={t(c, 'nameHelp')}
                error={c.fieldError('name')}
                disabled={c.busy}
              />,
              <Field
                id={`${formId}-shared`}
                name="shared"
                type="checkbox"
                label={t(c, 'shared')}
                checked={c.draftChecked('shared', undefined, c.data.shared)}
                disabled={c.busy}
              />,
              c.data.listKey === PRODUCT_FILTERS ? (
                <Field
                  id={`${formId}-default`}
                  name="default"
                  type="checkbox"
                  label={t(c, 'default')}
                  checked={c.draftChecked('default', undefined, c.data.isDefault)}
                  disabled={c.busy}
                />
              ) : null,
            ]}
          />
        }
      />
      <FilterHelp lang={c.data.lang} />
    </>
  ),
  actions: (c) => (
    <RecordActions
      actions={[
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        ...(c.data.existing
          ? [
              <RecordDialogTrigger dialog="delete">
                <Button label={t(c, 'delete')} variant="secondary" disabled={c.busy} />
              </RecordDialogTrigger>,
            ]
          : []),
        <RecordCloseTrigger>
          <Button label={t(c, 'cancel')} variant="secondary" />
        </RecordCloseTrigger>,
        <Button type="submit" form={formId} label={t(c, 'save')} variant="primary" loading={c.busy} />,
      ]}
    />
  ),
  dialogs: {
    delete: {
      title: (c) => t(c, 'delete'),
      view: (c) => <RecordModalForm id="saved-filter-delete" kind={c.kind} command="delete" fields={[]} />,
      confirmation: {
        message: (c) => t(c, 'deleteBody'),
        label: (c) => t(c, 'delete'),
        cancelLabel: (c) => t(c, 'cancel'),
        form: () => 'saved-filter-delete',
        command: 'delete',
        variant: 'destructive',
      },
    },
  },
  commands: {
    save: {
      fn: 'product_backend.saveFilter',
      input: (form, c) => ({
        id: c.data.id,
        listKey: c.data.listKey,
        name: String(form.get('name') ?? ''),
        shared: form.has('shared'),
        default: form.has('default'),
        state: c.data.state,
        expectedRevisionId: c.data.revisionId,
      }),
      after: 'close',
    },
    delete: {
      fn: 'product_backend.deleteFilter',
      input: (_form, c) => ({
        id: c.data.id,
        listKey: c.data.listKey,
        expectedRevisionId: c.data.revisionId,
      }),
      after: 'close',
    },
  },
}
export const filterModal = createRecordModal(filterModalDefinition)
