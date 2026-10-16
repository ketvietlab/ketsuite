import { CollectionSlot } from '../import-collection.tsx'
import {
  ActionGroup,
  Button,
  ConfirmDialog,
  Field,
  FormGrid,
  LinkButton,
  ModalSheet,
  Stack,
} from '@ketvietlab/design-system'
import type { Row } from '@ketvietlab/ketjs'
import { ImportForm } from '../../../ui/crm-import.tsx'
import { ListPage } from '../../../ui/list-page.tsx'
import {
  Errors,
  fieldError,
  Hidden,
  currentHref,
  href,
  listFrame,
  readObject,
  say,
  textValue,
} from './import-ui.tsx'
import type { ImportVm } from './import-ui.tsx'

export function ImportTags(vm: ImportVm) {
  const selected = readObject<Row>(vm.data.selected, {}),
    editing = Boolean(vm.query.tagId || vm.query.dialog === 'new'),
    dialog = vm.query.dialog || ''
  const canEdit = vm.options.permissions.createTags
  return (
    <>
      <ListPage
        variant="operational"
        frame={listFrame}
        title={say(vm, 'Nhãn hồ sơ', 'Record tags')}
        headerActions={
          <ActionGroup
            actions={[
              <LinkButton
                label={say(vm, 'Hồ sơ theo nhãn', 'Tagged records')}
                href={href(vm, '/admin/crm/tagged-records')}
              />,
              canEdit ? (
                <LinkButton
                  variant="primary"
                  label={say(vm, 'Tạo nhãn', 'New tag')}
                  href={currentHref(vm, { dialog: 'new', tagId: '' })}
                />
              ) : null,
            ]}
          />
        }
        controls={<CollectionSlot vm={vm} part="controls" />}
        body={
          <Stack
            items={[
              <Errors vm={vm} />,
              <CollectionSlot vm={vm} part="results" />,
              <CollectionSlot vm={vm} part="footer" />,
            ]}
          />
        }
      />
      {editing && !['archive', 'merge'].includes(dialog) && canEdit ? (
        <ModalSheet
          id="crm-tag-editor"
          title={selected.id ? say(vm, 'Sửa nhãn', 'Edit tag') : say(vm, 'Tạo nhãn', 'New tag')}
          closeHref={currentHref(vm, { tagId: '', dialog: '' })}
          closeLabel={say(vm, 'Đóng', 'Close')}
          body={
            <Stack
              items={[
                <Errors vm={vm} />,
                <ImportForm id="crm-tag-edit" action={vm.action}>
                  <Hidden
                    values={{
                      operation: 'saveTag',
                      id: selected.id || vm.requestId,
                      lang: vm.lang,
                      returnTo: vm.base,
                    }}
                  />
                  <FormGrid
                    items={[
                      <Field
                        id="tag-name"
                        name="name"
                        label={say(vm, 'Tên nhãn', 'Tag name')}
                        error={fieldError(vm, 'name')}
                        value={textValue(selected.name)}
                        required
                        maxLength={80}
                      />,
                      <Field
                        id="tag-color"
                        name="color"
                        label={say(vm, 'Màu', 'Color')}
                        type="color"
                        value={textValue(selected.color || '#7469d5')}
                      />,
                    ]}
                  />
                </ImportForm>,
                selected.id ? (
                  <ImportForm action={vm.action}>
                    <Hidden values={{ operation: 'reviewMergeTag', id: selected.id, lang: vm.lang }} />
                    <FormGrid
                      items={[
                        <Field
                          id="tag-target"
                          name="targetId"
                          label={say(vm, 'Gộp vào', 'Merge into')}
                          type="select"
                          options={[
                            { value: '', label: say(vm, 'Chọn nhãn đích', 'Choose a target tag') },
                            ...vm.options.tags
                              .filter((tag) => tag.id !== selected.id)
                              .map((tag) => ({ value: String(tag.id), label: String(tag.name) })),
                          ]}
                          required
                        />,
                        <Button type="submit" label={say(vm, 'Xem trước gộp', 'Review merge')} />,
                      ]}
                    />
                  </ImportForm>
                ) : null,
              ]}
            />
          }
          actions={
            <ActionGroup
              actions={[
                selected.id && selected.active ? (
                  <LinkButton
                    label={say(vm, 'Lưu trữ', 'Archive')}
                    href={currentHref(vm, { dialog: 'archive' })}
                  />
                ) : null,
                <Button
                  type="submit"
                  form="crm-tag-edit"
                  variant="primary"
                  label={say(vm, 'Lưu nhãn', 'Save tag')}
                />,
              ]}
            />
          }
        />
      ) : null}
      {canEdit && ['archive', 'merge'].includes(dialog) ? (
        <>
          <ImportForm id="tag-confirm" action={vm.action}>
            <Hidden
              values={{
                operation: dialog === 'archive' ? 'archiveTag' : 'mergeTag',
                id: selected.id,
                targetId: vm.query.targetId,
                lang: vm.lang,
              }}
            />
          </ImportForm>
          <ConfirmDialog
            id="tag-confirm-dialog"
            title={
              dialog === 'archive'
                ? say(vm, 'Lưu trữ nhãn?', 'Archive tag?')
                : say(vm, 'Gộp hai nhãn?', 'Merge tags?')
            }
            message={
              dialog === 'archive'
                ? say(
                    vm,
                    'Nhãn được giữ trên hồ sơ cũ nhưng không còn được gắn thêm.',
                    'The tag remains on existing records but cannot be added again.',
                  )
                : say(
                    vm,
                    'Hồ sơ và lô nhập sẽ chuyển sang nhãn đích. Nhãn nguồn được lưu trữ.',
                    'Records and import batches will use the target tag. The source tag is archived.',
                  )
            }
            confirmLabel={
              dialog === 'archive' ? say(vm, 'Lưu trữ', 'Archive') : say(vm, 'Gộp nhãn', 'Merge tags')
            }
            confirmForm="tag-confirm"
            closeHref={currentHref(vm, { dialog: '', targetId: '' })}
            closeLabel={say(vm, 'Quay lại', 'Go back')}
          />
        </>
      ) : null}
    </>
  )
}
