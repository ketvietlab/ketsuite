import { CollectionSlot } from '../import-collection.tsx'
import {
  ActionGroup,
  Button,
  ConfirmDialog,
  Field,
  FormGrid,
  LinkButton,
  Stack,
} from '@ketvietlab/design-system'
import { ImportForm } from '../../../ui/crm-import.tsx'
import { ListPage } from '../../../ui/list-page.tsx'
import { Errors, Hidden, href, listFrame, readObject, say } from './import-ui.tsx'
import type { ImportVm } from './import-ui.tsx'

export function ImportRecords(vm: ImportVm) {
  const pending = readObject<{ ids: string[]; tagId: string }>(vm.data.removeTags, { ids: [], tagId: '' })
  return (
    <>
      <ListPage
        variant="operational"
        frame={listFrame}
        title={say(vm, 'Hồ sơ theo nhãn và lô nhập', 'Records by tag and import batch')}
        headerActions={
          <ActionGroup
            actions={[
              <LinkButton
                label={say(vm, 'Tất cả hồ sơ', 'All records')}
                href={href(vm, '/admin/crm/cases')}
              />,
              <LinkButton label={say(vm, 'Nhãn hồ sơ', 'Record tags')} href={href(vm, '/admin/crm/tags')} />,
              <LinkButton
                label={say(vm, 'Các lô nhập', 'Import batches')}
                href={href(vm, '/admin/crm/imports')}
              />,
            ]}
          />
        }
        controls={<CollectionSlot vm={vm} part="controls" />}
        body={
          <Stack
            items={[
              <Errors vm={vm} />,
              vm.options.permissions.tagRecords ? (
                <ImportForm id="record-tags-bulk" action={vm.action}>
                  <Hidden
                    values={{
                      operation: 'recordTags',
                      lang: vm.lang,
                      returnTo: vm.base,
                      query: new URLSearchParams(vm.query).toString(),
                    }}
                  />
                  <FormGrid
                    items={[
                      <Field
                        id="bulk-tag"
                        name="tagId"
                        label={say(vm, 'Nhãn cho hồ sơ đã chọn', 'Tag for selected records')}
                        type="select"
                        options={vm.options.tags.map((tag) => ({
                          value: String(tag.id),
                          label: String(tag.name),
                        }))}
                        required
                      />,
                      <ActionGroup
                        actions={[
                          <Button
                            type="submit"
                            name="intent"
                            value="add"
                            label={say(vm, 'Gắn nhãn', 'Add tag')}
                          />,
                          <Button
                            type="submit"
                            name="intent"
                            value="remove"
                            label={say(vm, 'Gỡ nhãn', 'Remove tag')}
                          />,
                        ]}
                      />,
                    ]}
                  />
                </ImportForm>
              ) : null,
              <CollectionSlot vm={vm} part="results" />,
              <CollectionSlot vm={vm} part="footer" />,
            ]}
          />
        }
      />
      {pending.ids.length ? (
        <>
          <ImportForm id="remove-tags-confirm" action={vm.action}>
            <Hidden
              values={{
                operation: 'recordTags',
                intent: 'removeConfirmed',
                tagId: pending.tagId,
                ids: pending.ids,
                query: new URLSearchParams(vm.query).toString(),
              }}
            />
          </ImportForm>
          <ConfirmDialog
            id="remove-tags-dialog"
            title={say(vm, 'Gỡ nhãn khỏi hồ sơ đã chọn?', 'Remove this tag from selected records?')}
            message={say(
              vm,
              `Bạn đang gỡ nhãn khỏi ${pending.ids.length} hồ sơ.`,
              `You are removing the tag from ${pending.ids.length} records.`,
            )}
            confirmForm="remove-tags-confirm"
            confirmName="intent"
            confirmValue="removeConfirmed"
            confirmLabel={say(vm, 'Gỡ nhãn', 'Remove tag')}
            closeHref={href(vm, vm.base, vm.query)}
            closeLabel={say(vm, 'Quay lại', 'Go back')}
          />
        </>
      ) : null}
    </>
  )
}
