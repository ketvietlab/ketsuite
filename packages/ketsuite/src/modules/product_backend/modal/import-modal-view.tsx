import {
  AppSwitcherHelp,
  Button,
  DescriptionList,
  Field,
  Inline,
  LinkButton,
  Notice,
  RecordActions,
  Section,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import {
  createRecordModal,
  type RecordModalContext,
  type RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
import { RecordCloseTrigger, RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import type { ImportModalData } from '../imports/shared.ts'
import { ImportHelp } from '../imports/help.tsx'
import { UNIT_RECORD_MODAL_LABELS } from '../units/labels.ts'
import { HELP } from '../screens/help-words.ts'
type Context = RecordModalContext<ImportModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`product_backend.import.${key}`)
const formId = 'product-import-form'
export const importModalDefinition: RecordModalDefinition<ImportModalData> = {
  kind: 'product.import',
  size: 'large',
  labels: () => ({
    ...UNIT_RECORD_MODAL_LABELS[lang()],
    'recordModal.loadFailed':
      lang() === 'en' ? 'The import record could not be read.' : 'Không đọc được bản ghi nhập.',
    'recordModal.notFound':
      lang() === 'en'
        ? 'The import record is gone or you cannot view it.'
        : 'Bản ghi nhập không tồn tại hoặc bạn không có quyền xem.',
    'recordModal.saved': lang() === 'en' ? 'Products imported.' : 'Đã nhập sản phẩm.',
  }),
  context: {
    fn: 'product_backend.importContext',
    input: (id, creating) => ({ ...(creating ? {} : { id }), locale: lang() }),
  },
  title: (c) => (c.creating ? t(c, 'createTitle') : c.data.record.name),
  body: (c) => (
    <>
      <Stack
        items={[
          c.creating ? (
            <RecordModalForm
              kind={c.kind}
              id={formId}
              command="save"
              fields={[]}
              body={
                <Stack
                  items={[
                    <LinkButton href={c.data.download} label={t(c, 'download')} variant="tertiary" />,
                    <Field
                      id={`${formId}-data`}
                      name="data"
                      label={t(c, 'data')}
                      type="textarea"
                      rows={12}
                      value={c.draft('data', '')}
                      required
                      help={t(c, 'dataHelp')}
                      error={c.fieldError('data')}
                      disabled={c.busy || !c.data.permissions.create}
                    />,
                  ]}
                />
              }
            />
          ) : (
            <Stack
              items={[
                <DescriptionList
                  items={[
                    'actorName',
                    'occurredAt',
                    'rowCount',
                    'createdCount',
                    'changedCount',
                    'variantCount',
                  ].map((key) => ({
                    id: key,
                    label: t(c, key),
                    value:
                      key === 'occurredAt' && c.data.record[key]
                        ? new Date(String(c.data.record[key])).toLocaleString(
                            c.data.lang === 'en' ? 'en-GB' : 'vi-VN',
                            { dateStyle: 'medium', timeStyle: 'short', timeZone: c.data.timezone },
                          )
                        : String(c.data.record[key] ?? ''),
                  }))}
                />,
                <Text tone="muted">{t(c, 'immutable')}</Text>,
                <Section
                  title={t(c, 'products')}
                  body={
                    <Stack
                      items={c.data.items.map((item) => (
                        <Inline
                          items={[
                            item.href ? (
                              <LinkButton
                                href={item.href}
                                label={`${item.code} · ${item.name}`}
                                variant="tertiary"
                              />
                            ) : (
                              <Text>
                                {String(item.name)} · {t(c, 'deleted')}
                              </Text>
                            ),
                            <Text tone="muted">
                              {t(c, item.created ? 'created' : item.changed ? 'changed' : 'unchanged')}
                            </Text>,
                          ]}
                        />
                      ))}
                    />
                  }
                />,
                c.data.record.costRedacted ? (
                  <Notice tone="info" title={t(c, 'redacted')} message="" />
                ) : null,
                <Field
                  id={`${formId}-saved-data`}
                  name="saved-data"
                  label={t(c, 'data')}
                  type="textarea"
                  rows={12}
                  value={c.data.record.data}
                  readOnly
                />,
              ]}
            />
          ),
        ]}
      />
      <ImportHelp lang={c.data.lang} id="product-import-record-help" />
    </>
  ),
  actions: (c) => (
    <RecordActions
      actions={[
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        <RecordCloseTrigger>
          <Button label={t(c, c.creating ? 'cancel' : 'close')} variant="secondary" />
        </RecordCloseTrigger>,
        ...(c.creating && c.data.permissions.create
          ? [<Button type="submit" form={formId} label={t(c, 'create')} variant="primary" loading={c.busy} />]
          : []),
      ]}
    />
  ),
  commands: {
    save: {
      fn: 'product.importProducts',
      input: (form, c) => ({
        id: c.data.record.id,
        data: String(form.get('data') ?? ''),
        locale: c.data.lang,
      }),
      after: 'open',
    },
  },
}
export const importModal = createRecordModal(importModalDefinition)
