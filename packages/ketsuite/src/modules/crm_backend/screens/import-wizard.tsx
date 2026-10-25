import { ImportForm, ImportReveal, WithoutScript } from '../../../ui/crm-import.tsx'
import {
  ActionGroup,
  Button,
  DataTable,
  DropZone,
  Field,
  FormGrid,
  Grid,
  LinkButton,
  Metric,
  Notice,
  RecordPage,
  StagePath,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { defaultImportRules, importFields, importNameKey } from '../../crm/import-contract.ts'
import type { ImportRules } from '../../crm/import-contract.ts'
import type { Row } from '@ketvietlab/ketjs'
import {
  Errors,
  Hidden,
  Pager,
  RawTable,
  Status,
  currentHref,
  href,
  issueText,
  optionRows,
  personName,
  readObject,
  records,
  ruleLabel,
  say,
  statusText,
  textValue,
} from './import-ui.tsx'
import type { ImportVm } from './import-ui.tsx'

const steps = ['upload', 'mapping', 'rules', 'review'] as const
const titles = [
  ['Tải lên', 'Upload'],
  ['Ghép cột và nhãn', 'Map columns and tags'],
  ['Quy tắc nhập', 'Import rules'],
  ['Kiểm tra', 'Review'],
] as const

export function ImportWizard(vm: ImportVm) {
  const batch = readObject<Row>(vm.data.batch, {}),
    rules = readObject<ImportRules>(batch.rules, defaultImportRules())
  const requested = steps.indexOf(vm.query.step as (typeof steps)[number]),
    step = !batch.id ? 0 : Math.max(1, requested)
  const headers = readObject<string[]>(batch.headers, []),
    mapping = readObject<string[]>(batch.mapping, []),
    formId = 'crm-import-wizard'
  const preview = readObject<Row>(vm.data.preview, {})
  const actions = (
    <ActionGroup
      actions={[
        <LinkButton
          href={step > 0 ? currentHref(vm, { step: steps[step - 1] }) : href(vm, '/admin/crm/imports')}
          label={step > 0 ? say(vm, 'Quay lại', 'Back') : say(vm, 'Các lô nhập', 'Import batches')}
        />,
        <Button
          type="submit"
          form={formId}
          name="intent"
          value="next"
          variant="primary"
          label={
            step === 3
              ? say(vm, 'Bắt đầu nhập', 'Start import')
              : step === 2
                ? say(vm, 'Kiểm tra', 'Review')
                : say(vm, 'Tiếp tục', 'Continue')
          }
        />,
      ]}
    />
  )
  let body: JSXChild
  if (step === 0)
    body = (
      <Surface
        title={say(vm, 'Chọn dữ liệu khách hàng', 'Choose customer data')}
        body={
          <Stack
            items={[
              <DropZone
                id="import-file"
                name="file"
                label={say(vm, 'File khách hàng', 'Customer file')}
                accept=".csv,.tsv,.xlsx"
                help={say(
                  vm,
                  'CSV, TSV hoặc XLSX · tối đa 10 MB, 20.000 dòng',
                  'CSV, TSV or XLSX · up to 10 MB and 20,000 rows',
                )}
              />,
              <Field
                id="import-paste"
                name="paste"
                label={say(vm, 'Hoặc dán bảng tính', 'Or paste spreadsheet cells')}
                type="textarea"
                rows={6}
                value={textValue(vm.data.paste)}
                help={say(
                  vm,
                  'Dán cả dòng tên cột. Dữ liệu được lưu thành bản nháp để bạn kiểm tra trước khi nhập.',
                  'Include the header row. Data is saved as a draft for review before import.',
                )}
              />,
              <Field
                id="import-name"
                name="name"
                label={say(vm, 'Tên lô', 'Batch name')}
                value={textValue(vm.data.name)}
                maxLength={240}
                placeholder={say(vm, 'Ví dụ: Hội chợ tháng 10', 'For example: October event')}
              />,
              <Field
                id="import-header"
                name="header"
                label={say(vm, 'Dòng đầu là tên cột', 'First row contains column names')}
                type="checkbox"
                checked={true}
              />,
            ]}
          />
        }
      />
    )
  else if (step === 1)
    body = (
      <Stack
        items={[
          readObject<string[]>(batch.sheets, []).length > 1 ? (
            <Surface
              title={say(vm, 'Trang tính', 'Worksheet')}
              body={
                <FormGrid
                  items={[
                    <Field
                      id="import-sheet"
                      name="sheet"
                      label={say(vm, 'Chọn một trang tính', 'Choose one worksheet')}
                      type="select"
                      value={textValue(batch.sheet)}
                      options={readObject<string[]>(batch.sheets, []).map((name) => ({
                        value: name,
                        label: name,
                      }))}
                    />,
                    <Button
                      type="submit"
                      name="intent"
                      value="sheet"
                      label={say(vm, 'Đọc trang tính', 'Read worksheet')}
                    />,
                  ]}
                />
              }
            />
          ) : null,
          <Surface
            title={say(vm, 'Ghép cột', 'Map columns')}
            body={
              <Stack
                items={[
                  <FormGrid
                    items={headers.map((header, index) => (
                      <Field
                        id={`map-${index}`}
                        name={`map.${index}`}
                        label={header}
                        type="select"
                        value={mapping[index] || 'ignore'}
                        options={importFields.map((value) => ({ value, label: ruleLabel(vm, value) }))}
                        help={readObject<string[][]>(batch.preview, [])[0]?.[index] || '—'}
                      />
                    ))}
                  />,
                  <Button
                    type="submit"
                    name="intent"
                    value="mapping"
                    label={say(vm, 'Cập nhật ghép cột', 'Update mapping')}
                  />,
                ]}
              />
            }
          />,
          ...(['recordTags', 'customerLabels'] as const).map((kind) => {
            const values = readObject<string[]>(
              batch[kind === 'recordTags' ? 'tagValues' : 'customerLabelValues'],
              [],
            )
            if (!values.length) return null
            const catalog = kind === 'recordTags' ? vm.options.tags : vm.options.customerLabels
            const configured = kind === 'recordTags' ? rules.tagValues : rules.customerLabelValues
            return (
              <Surface
                title={ruleLabel(vm, kind)}
                description={say(
                  vm,
                  'Chọn nhãn tương ứng cho từng giá trị trong file.',
                  'Choose a matching label for each value in the file.',
                )}
                body={
                  <FormGrid
                    items={values.map((name, index) => {
                      const match = catalog.find((tag) => importNameKey(tag.name) === importNameKey(name))
                      return (
                        <Field
                          id={`${kind}-${index}`}
                          name={`${kind}.${index}`}
                          label={name}
                          type="select"
                          value={
                            configured[name] ??
                            textValue(match?.name ?? (vm.options.permissions.createTags ? name : ''))
                          }
                          options={[
                            { value: '', label: say(vm, 'Bỏ qua giá trị này', 'Ignore this value') },
                            ...catalog.map((tag) => ({ value: String(tag.name), label: String(tag.name) })),
                            ...(!match && vm.options.permissions.createTags
                              ? [{ value: name, label: say(vm, `Tạo: ${name}`, `Create: ${name}`) }]
                              : []),
                          ]}
                        />
                      )
                    })}
                  />
                }
              />
            )
          }),
          <RawTable vm={vm} headers={headers} rows={readObject<string[][]>(batch.preview, [])} />,
        ]}
      />
    )
  else if (step === 2) {
    const tags = [
      ...vm.options.tags.map((tag) => String(tag.name)),
      ...rules.tags.filter(
        (name) => !vm.options.tags.some((tag) => importNameKey(tag.name) === importNameKey(name)),
      ),
    ]
    body = (
      <Stack
        items={[
          <Surface
            title={say(vm, 'Hồ sơ sẽ tạo', 'Records to create')}
            body={
              <FormGrid
                items={[
                  <Field
                    id="kind"
                    name="kind"
                    label={say(vm, 'Loại hồ sơ', 'Record type')}
                    type="radio"
                    value={rules.kind}
                    options={[
                      { value: 'lead', label: 'Lead' },
                      { value: 'opportunity', label: say(vm, 'Cơ hội', 'Opportunity') },
                    ]}
                  />,
                  ...(['source', 'medium', 'campaign'] as const).map((key) => (
                    <Field
                      id={key}
                      name={key}
                      label={ruleLabel(vm, key)}
                      value={rules[key]}
                      maxLength={240}
                    />
                  )),
                ]}
              />
            }
          />,
          <Surface
            title={say(vm, 'Phân công', 'Assignment')}
            body={
              <Stack
                items={[
                  <Field
                    id="assignment"
                    name="assignment"
                    label={say(vm, 'Cách phân công', 'Assignment mode')}
                    type="select"
                    value={rules.assignment}
                    options={[
                      { value: 'rules', label: say(vm, 'Theo quy tắc phân công', 'Use assignment rules') },
                      {
                        value: 'team',
                        label: say(vm, 'Phân công trong một đội', 'Distribute across a team'),
                      },
                      { value: 'person', label: say(vm, 'Giao hết cho một người', 'Assign to one person') },
                      { value: 'unassigned', label: say(vm, 'Chưa phân công', 'Leave unassigned') },
                    ]}
                  />,
                  <ImportReveal part="team" hidden={rules.assignment !== 'team'}>
                    <Field
                      id="teamId"
                      name="teamId"
                      label={say(vm, 'Đội', 'Team')}
                      type="select"
                      value={rules.teamId}
                      disabled={rules.assignment !== 'team'}
                      options={[
                        { value: '', label: say(vm, 'Chọn đội', 'Choose a team') },
                        ...optionRows(vm.options.teams),
                      ]}
                    />
                  </ImportReveal>,
                  <ImportReveal part="person" hidden={rules.assignment !== 'person'}>
                    <Field
                      id="assigneeUserId"
                      name="assigneeUserId"
                      label={say(vm, 'Người phụ trách', 'Assignee')}
                      type="select"
                      value={rules.assigneeUserId}
                      disabled={rules.assignment !== 'person'}
                      options={[
                        { value: '', label: say(vm, 'Chọn người', 'Choose a person') },
                        ...optionRows(vm.options.people),
                      ]}
                    />
                  </ImportReveal>,
                  <WithoutScript>
                    <Button
                      type="submit"
                      name="intent"
                      value="rules"
                      label={say(vm, 'Cập nhật lựa chọn', 'Update choices')}
                    />
                  </WithoutScript>,
                ]}
              />
            }
          />,
          <Surface
            title={say(vm, 'Khách đã có hồ sơ mở', 'Customer with an open record')}
            body={
              <Field
                id="duplicate"
                name="duplicate"
                label={say(vm, 'Xử lý trùng', 'Duplicate policy')}
                type="radio"
                optionsOrientation="vertical"
                value={rules.duplicate}
                options={[
                  {
                    value: 'merge',
                    label: say(
                      vm,
                      'Ghi thêm ghi chú và nhãn, giữ người phụ trách',
                      'Add notes and tags; keep the assignee',
                    ),
                  },
                  { value: 'skip', label: say(vm, 'Bỏ qua dòng', 'Skip the row') },
                  {
                    value: 'create',
                    label: say(
                      vm,
                      'Tạo hồ sơ mới, liên kết khách đã có',
                      'Create another record linked to the customer',
                    ),
                  },
                ]}
              />
            }
          />,
          <Surface
            title={say(vm, 'Nhãn cho cả lô', 'Tags for the batch')}
            body={
              <Stack
                items={[
                  tags.length ? (
                    <Field
                      id="batch-tags"
                      name="tags"
                      label={say(vm, 'Nhãn hồ sơ', 'Record tags')}
                      type="checkbox-group"
                      options={tags.map((name) => ({
                        value: name,
                        label: name,
                        checked: rules.tags.includes(name),
                      }))}
                    />
                  ) : (
                    <Text>{say(vm, 'Chưa có nhãn hồ sơ.', 'No record tags yet.')}</Text>
                  ),
                  vm.options.permissions.createTags ? (
                    <Field
                      id="newTag"
                      name="newTag"
                      label={say(vm, 'Tạo nhãn mới', 'New tag')}
                      maxLength={80}
                      action={
                        <Button type="submit" name="intent" value="addTag" label={say(vm, 'Thêm', 'Add')} />
                      }
                      help={say(
                        vm,
                        'Nhãn mới được chọn cho lô và chỉ tạo khi bắt đầu nhập.',
                        'A new tag is selected for this batch and created when the import starts.',
                      )}
                    />
                  ) : null,
                ]}
              />
            }
          />,
          <Surface
            title={say(vm, 'Việc liên hệ đầu tiên', 'First contact task')}
            body={
              <Stack
                items={[
                  <Field
                    id="firstTask"
                    name="firstTask"
                    label={say(vm, 'Tạo việc liên hệ', 'Create contact task')}
                    type="checkbox"
                    checked={rules.firstTask}
                    help={say(
                      vm,
                      'Hồ sơ chưa phân công: việc liên hệ giao cho người nhập lô.',
                      'For unassigned records, the importer owns the contact task.',
                    )}
                  />,
                  <ImportReveal part="due" hidden={!rules.firstTask}>
                    <Field
                      id="due"
                      name="due"
                      label={say(vm, 'Hạn liên hệ', 'Due')}
                      type="select"
                      disabled={!rules.firstTask}
                      value={rules.due}
                      options={[
                        { value: 'two-hours', label: say(vm, 'Trong 2 giờ', 'Within 2 hours') },
                        { value: 'today', label: say(vm, 'Hôm nay', 'Today') },
                        { value: 'tomorrow', label: say(vm, 'Ngày mai', 'Tomorrow') },
                      ]}
                    />
                  </ImportReveal>,
                ]}
              />
            }
          />,
        ]}
      />
    )
  } else {
    const counts = readObject<Record<string, number>>(preview.counts, {})
    body = (
      <Stack
        items={[
          <Grid
            columns={3}
            items={['created', 'linked', 'merged', 'skipped', 'error'].map((outcome) => (
              <Metric
                label={statusText(vm, outcome)}
                value={String(counts[outcome] || 0)}
                href={currentHref(vm, { outcome, offset: 0 })}
              />
            ))}
          />,
          <Surface
            title={say(vm, 'Thiết lập đã chọn', 'Selected settings')}
            body={
              <Grid
                columns={2}
                items={[
                  <Text>
                    {say(vm, 'Loại hồ sơ', 'Type')}:{' '}
                    {rules.kind === 'lead' ? 'Lead' : say(vm, 'Cơ hội', 'Opportunity')}
                  </Text>,
                  <Text>
                    {ruleLabel(vm, 'source')}: {rules.source || '—'}
                  </Text>,
                  <Text>
                    {ruleLabel(vm, 'campaign')}: {rules.campaign || '—'}
                  </Text>,
                  <Text>
                    {say(vm, 'Nhãn cả lô', 'Batch tags')}: {rules.tags.join(', ') || '—'}
                  </Text>,
                ]}
              />
            }
          />,
          <DataTable
            title={say(vm, 'Chia việc dự kiến', 'Planned assignment')}
            rows={Object.entries(readObject<Record<string, number>>(preview.distribution, {})).map(
              ([id, count]) => ({ id, count }),
            )}
            id={(row) => row.id || 'unassigned'}
            columns={[
              {
                key: 'owner',
                label: say(vm, 'Người phụ trách', 'Assignee'),
                cell: (row) => personName(vm, row.id),
              },
              {
                key: 'count',
                label: say(vm, 'Số hồ sơ', 'Records'),
                cell: (row) => String(row.count),
                kind: 'number',
              },
            ]}
          />,
          records(preview.missingTags).length ||
          [
            ...readObject<string[]>(preview.missingTags, []),
            ...readObject<string[]>(preview.missingLabels, []),
          ].length ? (
            <Notice
              tone="info"
              title={say(vm, 'Nhãn chưa có trong danh mục', 'New catalogue values')}
              message={
                say(
                  vm,
                  vm.options.permissions.createTags
                    ? 'Các nhãn này sẽ được tạo khi bắt đầu nhập: '
                    : 'Các giá trị này sẽ bỏ qua vì bạn không có quyền tạo nhãn: ',
                  vm.options.permissions.createTags
                    ? 'These tags will be created when importing: '
                    : 'These values will be ignored because you cannot create tags: ',
                ) +
                [
                  ...readObject<string[]>(preview.missingTags, []),
                  ...readObject<string[]>(preview.missingLabels, []),
                ].join(', ')
              }
            />
          ) : null,
          <LinkButton
            label={say(vm, 'Tải các dòng lỗi', 'Download invalid rows')}
            href={href(vm, `/admin/crm/imports/${encodeURIComponent(String(batch.id))}/export`, {
              errorsOnly: '1',
            })}
          />,
          <Pager vm={vm} total={Number(preview.filtered || 0)} offset={Number(vm.query.offset || 0)} />,
          <DataTable
            title={say(vm, 'Kiểm tra từng dòng', 'Review rows')}
            rows={records(preview.rows)}
            id={(row) => String(row.rowNumber)}
            responsive="scroll"
            columns={[
              { key: 'row', label: '#', cell: (row) => String(row.rowNumber), kind: 'number' },
              {
                key: 'name',
                label: say(vm, 'Họ tên', 'Name'),
                cell: (row) => textValue(readObject<Row>(row.normalized, {}).name),
              },
              {
                key: 'phone',
                label: say(vm, 'Điện thoại', 'Phone'),
                cell: (row) => textValue(readObject<Row>(row.normalized, {}).phone),
              },
              {
                key: 'result',
                label: say(vm, 'Kết quả', 'Outcome'),
                cell: (row) => <Status vm={vm} value={row.outcome} />,
              },
              {
                key: 'issue',
                label: say(vm, 'Cần chú ý', 'Issue'),
                cell: (row) => (row.issue ? issueText(vm, row.issue) : '—'),
              },
            ]}
          />,
          <Text tone="muted">
            {say(
              vm,
              'Dòng lỗi sẽ không được nhập. Kết quả được đối chiếu lại khi chạy; bạn có thể rời trang sau khi bắt đầu.',
              'Invalid rows will not be imported. Matches are checked again when running; you can leave after starting.',
            )}
          </Text>,
        ]}
      />
    )
  }
  return (
    <ImportForm id={formId} action={vm.action} upload={step === 0}>
      <Hidden
        values={{
          operation: step === 0 ? 'upload' : step === 1 ? 'mapping' : step === 2 ? 'rules' : 'start',
          id: batch.id || vm.requestId,
          version: batch.version,
          step: steps[step],
          lang: vm.lang,
        }}
      />
      <RecordPage
        title={say(vm, 'Nhập lead mới', 'New lead import')}
        variant="operational"
        width="wide"
        actions={actions}
        path={
          <StagePath
            label={say(vm, 'Các bước nhập', 'Import steps')}
            completeLabel={say(vm, 'Đã xong', 'Completed')}
            steps={steps.map((id, i) => ({
              id,
              label: say(vm, titles[i][0], titles[i][1]),
              state: i === step ? 'current' : i < step ? 'complete' : 'upcoming',
              href: batch.id && i > 0 && i < step ? currentHref(vm, { step: id }) : undefined,
            }))}
          />
        }
        body={<Stack items={[<Errors vm={vm} />, body]} />}
      />
    </ImportForm>
  )
}
