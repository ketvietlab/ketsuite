import { ImportForm } from '../../../ui/crm-import.tsx'
import {
  ActionGroup,
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  FormGrid,
  Grid,
  LinkButton,
  Metric,
  Notice,
  RecordPage,
  RecordForm,
  Stack,
  Surface,
  Tabs,
} from '@ketvietlab/design-system'
import type { Row } from '@ketvietlab/ketjs'
import type { ImportRules } from '../../crm/import-contract.ts'
import { defaultImportRules } from '../../crm/import-contract.ts'
import {
  Command,
  Errors,
  Hidden,
  Pager,
  RawTable,
  Status,
  currentHref,
  href,
  issueText,
  ruleLabel,
  personName,
  readObject,
  records,
  say,
  statusText,
  textValue,
} from './import-ui.tsx'
import type { ImportVm } from './import-ui.tsx'

export function ImportBatch(vm: ImportVm) {
  const batch = readObject<Row>(vm.data.batch, {}),
    counts = readObject<Record<string, number>>(batch.counts, {}),
    rules = readObject<ImportRules>(batch.rules, defaultImportRules()),
    tab = vm.query.tab || 'overview'
  const mutable =
    batch.canManage &&
    vm.options.permissions.import &&
    ['completed', 'partial', 'stopped'].includes(String(batch.state))
  const canUndo =
    mutable && Date.parse(String(batch.undoUntil)) > Number(vm.data.clock || 0) && vm.options.permissions.undo
  const rows = records(vm.data.rows),
    selected = rows.find((row) => String(row.rowNumber) === vm.query.row)
  return (
    <>
      <RecordPage
        title={textValue(batch.name)}
        status={<Status vm={vm} value={batch.state} />}
        variant="operational"
        width="wide"
        actions={
          <ActionGroup
            actions={[
              <LinkButton
                label={say(vm, 'Các lô nhập', 'Import batches')}
                href={href(vm, '/admin/crm/imports')}
              />,
              <LinkButton
                label={say(vm, 'Hồ sơ của lô', 'Batch records')}
                href={href(vm, '/admin/crm/tagged-records', { batchId: batch.id })}
              />,
              batch.canManage && vm.options.permissions.import && batch.state === 'running' ? (
                <LinkButton
                  label={say(vm, 'Dừng lô', 'Stop batch')}
                  href={currentHref(vm, { dialog: 'stop' })}
                />
              ) : null,
              batch.canManage &&
              vm.options.permissions.import &&
              (batch.state === 'stopped' ||
                (batch.state === 'running' &&
                  Number(vm.data.clock || 0) - Date.parse(String(batch.updatedAt)) >= 60_000)) ? (
                <Command
                  vm={vm}
                  operation="resume"
                  id={batch.id}
                  version={batch.version}
                  tone="primary"
                  label={say(vm, 'Chạy tiếp', 'Resume')}
                />
              ) : null,
              canUndo ? (
                <LinkButton
                  label={say(vm, 'Hoàn tác lô', 'Undo batch')}
                  href={currentHref(vm, { dialog: 'undo' })}
                />
              ) : null,
            ]}
          />
        }
        navigation={
          <Tabs
            label={say(vm, 'Lô nhập', 'Import batch')}
            items={['overview', 'rows', 'performance'].map((id, index) => ({
              id,
              label: say(
                vm,
                ['Tổng quan', 'Các dòng', 'Hiệu quả'][index],
                ['Overview', 'Rows', 'Performance'][index],
              ),
              href: currentHref(vm, { tab: id, offset: 0, row: '', dialog: '' }),
              active: tab === id,
            }))}
          />
        }
        body={
          <Stack
            items={[
              <Errors vm={vm} />,
              batch.state === 'running' ? (
                <Notice
                  tone="info"
                  title={say(
                    vm,
                    `Đang nhập ${batch.cursor}/${batch.total} dòng`,
                    `Importing ${batch.cursor}/${batch.total} rows`,
                  )}
                  message={say(
                    vm,
                    'Bạn có thể rời trang. Lô tiếp tục chạy ở nền.',
                    'You can leave this page. The batch continues in the background.',
                  )}
                />
              ) : null,
              batch.stoppedReason === 'permission' ? (
                <Notice
                  tone="warning"
                  title={say(vm, 'Lô dừng vì quyền đã thay đổi', 'Stopped after permissions changed')}
                  message={issueText(vm, 'permission')}
                />
              ) : null,
              tab === 'overview' ? (
                <Stack
                  items={[
                    <Grid
                      columns={3}
                      items={['created', 'linked', 'merged', 'skipped', 'error'].map((outcome) => (
                        <Metric
                          label={statusText(vm, outcome)}
                          value={String(counts[outcome] || 0)}
                          href={currentHref(vm, { tab: 'rows', outcome, offset: 0 })}
                        />
                      ))}
                    />,
                    <Surface
                      title={say(vm, 'Thiết lập của lô', 'Batch settings')}
                      body={
                        <FormGrid
                          items={[
                            <Field
                              id="batch-filename"
                              name="filename"
                              label={say(vm, 'File', 'File')}
                              value={textValue(batch.filename)}
                              readOnly
                            />,
                            <Field
                              id="batch-kind"
                              name="kind"
                              label={say(vm, 'Loại hồ sơ', 'Record type')}
                              value={rules.kind === 'lead' ? 'Lead' : say(vm, 'Cơ hội', 'Opportunity')}
                              readOnly
                            />,
                            <Field
                              id="batch-source"
                              name="source"
                              label={say(vm, 'Nguồn', 'Source')}
                              value={rules.source || '—'}
                              readOnly
                            />,
                            <Field
                              id="batch-campaign"
                              name="campaign"
                              label={say(vm, 'Chiến dịch', 'Campaign')}
                              value={rules.campaign || '—'}
                              readOnly
                            />,
                            <Field
                              id="batch-tags"
                              name="tags"
                              label={say(vm, 'Nhãn cả lô', 'Batch tags')}
                              value={rules.tags.join(', ') || '—'}
                              readOnly
                            />,
                          ]}
                        />
                      }
                    />,
                    mutable && vm.options.permissions.import ? (
                      <Surface
                        title={say(vm, 'Gắn thêm nhãn cho lô', 'Add tags to the batch')}
                        body={
                          <ImportForm action={vm.action}>
                            <Hidden
                              values={{
                                operation: 'batchTags',
                                id: batch.id,
                                version: batch.version,
                                lang: vm.lang,
                              }}
                            />
                            <Stack
                              items={[
                                <Field
                                  id="add-batch-tags"
                                  name="tags"
                                  type="checkbox-group"
                                  label={say(vm, 'Nhãn', 'Tags')}
                                  options={vm.options.tags.map((tag) => ({
                                    value: String(tag.name),
                                    label: String(tag.name),
                                  }))}
                                />,
                                <Button type="submit" label={say(vm, 'Gắn nhãn', 'Add tags')} />,
                              ]}
                            />
                          </ImportForm>
                        }
                      />
                    ) : null,
                  ]}
                />
              ) : tab === 'rows' ? (
                <Stack
                  items={[
                    <RecordForm
                      action={vm.base}
                      method="get"
                      applyOnInput
                      submitLabel={say(vm, 'Lọc', 'Filter')}
                      hidden={{ tab: 'rows', lang: vm.lang }}
                      fields={[
                        {
                          id: 'outcome',
                          name: 'outcome',
                          label: say(vm, 'Kết quả', 'Outcome'),
                          type: 'select',
                          value: vm.query.outcome || '',
                          options: [
                            { value: '', label: say(vm, 'Tất cả', 'All') },
                            ...['created', 'linked', 'merged', 'skipped', 'error'].map((value) => ({
                              value,
                              label: statusText(vm, value),
                            })),
                          ],
                        },
                        {
                          id: 'assignee',
                          name: 'assigneeUserId',
                          label: say(vm, 'Người phụ trách', 'Assignee'),
                          type: 'select',
                          value: vm.query.assigneeUserId || '',
                          options: [
                            { value: '', label: say(vm, 'Tất cả', 'All') },
                            ...vm.options.people.map((person) => ({
                              value: String(person.id),
                              label: String(person.name),
                            })),
                          ],
                        },
                      ]}
                    />,
                    <LinkButton
                      label={say(vm, 'Tải dòng lỗi', 'Download invalid rows')}
                      href={href(vm, `${vm.base}/export`, { errorsOnly: '1' })}
                    />,

                    <Pager
                      vm={vm}
                      total={Number(vm.data.total || 0)}
                      offset={Number(vm.query.offset || 0)}
                    />,
                    <DataTable
                      title={say(vm, 'Kết quả từng dòng', 'Row outcomes')}
                      rows={rows}
                      id={(row) => String(row.rowNumber)}
                      rowHref={(row) => currentHref(vm, { row: row.rowNumber })}
                      responsive="scroll"
                      columns={[
                        { key: 'row', label: '#', cell: (row) => String(row.rowNumber), kind: 'number' },
                        {
                          key: 'name',
                          label: say(vm, 'Họ tên', 'Name'),
                          cell: (row) => textValue(readObject<Row>(row.normalized, {}).name),
                        },
                        {
                          key: 'outcome',
                          label: say(vm, 'Kết quả', 'Outcome'),
                          cell: (row) => <Status vm={vm} value={row.outcome} />,
                        },
                        {
                          key: 'assignee',
                          label: say(vm, 'Phụ trách', 'Assignee'),
                          cell: (row) => personName(vm, row.assigneeUserId),
                        },
                        {
                          key: 'issue',
                          label: say(vm, 'Vấn đề', 'Issue'),
                          cell: (row) => (row.issue ? issueText(vm, row.issue) : '—'),
                        },
                      ]}
                    />,
                    selected ? (
                      <Surface
                        title={say(vm, `Dòng ${selected.rowNumber}`, `Row ${selected.rowNumber}`)}
                        actions={
                          <ActionGroup
                            actions={[
                              selected.caseId ? (
                                <LinkButton
                                  label={say(vm, 'Mở hồ sơ', 'Open record')}
                                  href={href(
                                    vm,
                                    `/admin/crm/cases/${encodeURIComponent(String(selected.caseId))}`,
                                  )}
                                />
                              ) : null,
                              <LinkButton
                                label={say(vm, 'Đóng', 'Close')}
                                href={currentHref(vm, { row: '' })}
                              />,
                            ]}
                          />
                        }
                        body={
                          <Stack
                            items={[
                              selected.activityId ? (
                                <Field
                                  id="row-first-contact"
                                  name="first-contact"
                                  label={say(vm, 'Hạn liên hệ đầu tiên', 'First contact deadline')}
                                  readOnly
                                  value={textValue(
                                    readObject<Row>(selected.activitySnapshot, {}).dueAt ||
                                      readObject<Row>(selected.activitySnapshot, {}).dueDate ||
                                      '—',
                                  )}
                                />
                              ) : null,
                              <RawTable
                                vm={vm}
                                headers={readObject<string[]>(batch.headers, [])}
                                rows={[readObject<string[]>(selected.original, [])]}
                              />,
                              <DataTable
                                title={say(vm, 'Giá trị đã chuẩn hoá', 'Normalized values')}
                                rows={Object.entries(readObject<Row>(selected.normalized, {})).map(
                                  ([key, value]) => ({
                                    key,
                                    value: Array.isArray(value) ? value.join(', ') : String(value || '—'),
                                  }),
                                )}
                                id={(row) => row.key}
                                columns={[
                                  {
                                    key: 'key',
                                    label: say(vm, 'Trường', 'Field'),
                                    cell: (row) => ruleLabel(vm, row.key),
                                  },
                                  {
                                    key: 'value',
                                    label: say(vm, 'Giá trị', 'Value'),
                                    cell: (row) => row.value,
                                  },
                                ]}
                              />,
                            ]}
                          />
                        }
                      />
                    ) : null,
                  ]}
                />
              ) : (
                <Stack
                  items={[
                    <Grid
                      columns={3}
                      items={[
                        <Metric
                          label={say(vm, 'Hồ sơ đã liên hệ', 'Contacted records')}
                          value={String(vm.data.contacted || 0)}
                        />,
                        <Metric
                          label={say(vm, 'Hồ sơ thắng', 'Won records')}
                          value={String(vm.data.won || 0)}
                        />,
                        <Metric
                          label={say(vm, 'Giá trị hồ sơ thắng', 'Won record value')}
                          value={Number(vm.data.wonValue || 0).toLocaleString(
                            vm.lang === 'vi' ? 'vi-VN' : 'en-GB',
                          )}
                        />,
                      ]}
                    />,
                    ...(['byOwner', 'byTag'] as const).map((key) => (
                      <DataTable
                        title={
                          key === 'byOwner'
                            ? say(vm, 'Theo người phụ trách', 'By assignee')
                            : say(vm, 'Theo nhãn', 'By tag')
                        }
                        rows={records(vm.data[key])}
                        id={(row) => String(row.id)}
                        columns={[
                          {
                            key: 'name',
                            label:
                              key === 'byOwner' ? say(vm, 'Phụ trách', 'Assignee') : say(vm, 'Nhãn', 'Tag'),
                            cell: (row) => textValue(row.name),
                          },
                          {
                            key: 'total',
                            label: say(vm, 'Hồ sơ', 'Records'),
                            cell: (row) => String(row.total),
                            kind: 'number',
                          },
                          {
                            key: 'contacted',
                            label: say(vm, 'Đã liên hệ', 'Contacted'),
                            cell: (row) => String(row.contacted),
                            kind: 'number',
                          },
                          {
                            key: 'won',
                            label: say(vm, 'Thắng', 'Won'),
                            cell: (row) => String(row.won),
                            kind: 'number',
                          },
                          {
                            key: 'value',
                            label: say(vm, 'Giá trị thắng', 'Won value'),
                            cell: (row) =>
                              Number(row.wonValue || 0).toLocaleString(vm.lang === 'vi' ? 'vi-VN' : 'en-GB'),
                            kind: 'currency',
                          },
                        ]}
                      />
                    )),
                  ]}
                />
              ),
            ]}
          />
        }
      />
      {['stop', 'undo'].includes(vm.query.dialog || '') ? (
        <>
          <ImportForm id="import-confirm" action={vm.action}>
            <Hidden
              values={{ operation: vm.query.dialog, id: batch.id, version: batch.version, lang: vm.lang }}
            />
          </ImportForm>
          <ConfirmDialog
            id="import-confirm-dialog"
            title={
              vm.query.dialog === 'undo'
                ? say(vm, 'Hoàn tác lô nhập?', 'Undo this import?')
                : say(vm, 'Dừng lô nhập?', 'Stop this import?')
            }
            message={
              vm.query.dialog === 'undo'
                ? say(
                    vm,
                    'Hồ sơ mới chưa được xử lý sẽ được lưu trữ, nhãn do lô thêm được gỡ. Hồ sơ đã thay đổi và thông tin khách hàng dùng chung được giữ lại.',
                    'Untouched new records will be archived and tags added by the batch removed. Modified records and shared customer identities are kept.',
                  )
                : say(
                    vm,
                    'Các dòng đã ghi vẫn được giữ. Bạn có thể chạy tiếp các dòng còn lại.',
                    'Written rows are kept. You can resume the remaining rows.',
                  )
            }
            confirmLabel={
              vm.query.dialog === 'undo' ? say(vm, 'Hoàn tác', 'Undo') : say(vm, 'Dừng lô', 'Stop batch')
            }
            confirmForm="import-confirm"
            closeHref={currentHref(vm, { dialog: '' })}
            closeLabel={say(vm, 'Quay lại', 'Go back')}
          />
        </>
      ) : null}
    </>
  )
}
