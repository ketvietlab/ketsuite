import type { Row } from '@ketvietlab/ketjs'
import {
  ActionGroup,
  Badge,
  Button,
  DataTable,
  Inline,
  LinkButton,
  Notice,
  Text,
} from '@ketvietlab/design-system'
import { HiddenValues as Hidden, ImportForm } from '../../../ui/crm-import.tsx'
import type { Frame } from '../../../ui/index.ts'

export type ImportVm = {
  screen: 'batches' | 'wizard' | 'batch' | 'tags' | 'records'
  lang: 'vi' | 'en'
  query: Record<string, string>
  base: string
  action: string
  requestId: string
  data: Row
  options: {
    teams: Row[]
    people: Row[]
    tags: Row[]
    customerLabels: Row[]
    permissions: Record<string, boolean>
  }
  errors: { field: string; code: string }[]
  notice: string
}
// The shell owns these pages' context and each page names its own header actions, so the
// application ListPage gets a frame without list chrome.
export const listFrame: Pick<Frame, 'chrome'> = { chrome: null }
export const readObject = <T,>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return (value ?? fallback) as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
export const say = (vm: Pick<ImportVm, 'lang'>, vi: string, en: string) => (vm.lang === 'en' ? en : vi)
export const textValue = (value: unknown) => String(value ?? '')
export const records = (value: unknown) => readObject<Row[]>(value, [])
export const href = (vm: ImportVm, path: string, params: Record<string, unknown> = {}) => {
  const query = new URLSearchParams({ lang: vm.lang })
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  return `${path}?${query}`
}
export const currentHref = (vm: ImportVm, params: Record<string, unknown> = {}) =>
  href(vm, vm.base, { ...vm.query, ...params })
export const personName = (vm: ImportVm, id: unknown) =>
  textValue(vm.options.people.find((person) => person.id === id)?.name) ||
  say(vm, 'Chưa phân công', 'Unassigned')
export const optionRows = (rows: Row[]) =>
  rows.map((row) => ({ value: String(row.id), label: String(row.name) }))
export const statusLabels: Record<string, [string, string]> = {
  draft: ['Bản nháp', 'Draft'],
  ready: ['Sẵn sàng', 'Ready'],
  running: ['Đang chạy', 'Running'],
  completed: ['Hoàn tất', 'Completed'],
  partial: ['Hoàn tất, có dòng lỗi', 'Completed with errors'],
  stopped: ['Đã dừng', 'Stopped'],
  undone: ['Đã hoàn tác', 'Undone'],
  created: ['Khách và hồ sơ mới', 'New customer and record'],
  linked: ['Hồ sơ mới, khách đã có', 'New record, existing customer'],
  merged: ['Ghi vào hồ sơ mở', 'Added to open record'],
  skipped: ['Bỏ qua', 'Skipped'],
  error: ['Dòng lỗi', 'Invalid row'],
}
export const statusText = (vm: ImportVm, state: unknown) => {
  const labels = statusLabels[String(state)]
  return labels ? say(vm, ...labels) : String(state ?? '')
}
export const Status = ({ vm, value }: { vm: ImportVm; value: unknown }) => (
  <Badge
    label={statusText(vm, value)}
    tone={
      ['completed', 'created', 'linked', 'merged'].includes(String(value))
        ? 'positive'
        : ['error', 'stopped'].includes(String(value))
          ? 'danger'
          : ['partial', 'skipped'].includes(String(value))
            ? 'warning'
            : 'neutral'
    }
  />
)
const issueCopy: Record<string, [string, string]> = {
  name: ['Thiếu họ tên', 'Name is required'],
  contact: ['Cần điện thoại hoặc email', 'A phone or email is required'],
  phone: ['Điện thoại không hợp lệ', 'Invalid phone'],
  email: ['Email không hợp lệ', 'Invalid email'],
  length: ['Giá trị quá dài', 'Value is too long'],
  columns: ['Số cột không hợp lệ (tối đa 64)', 'Invalid column count (up to 64)'],
  tags: ['Nhãn không hợp lệ hoặc vượt giới hạn', 'Invalid tags or tag limit exceeded'],
  fileDuplicate: ['Trùng dòng trước trong file', 'Duplicate of an earlier file row'],
  openDuplicate: ['Khách đã có hồ sơ mở', 'Customer has an open record'],
  ambiguous: [
    'Điện thoại/email khớp nhiều hồ sơ; cần đối chiếu',
    'Phone/email matches multiple records; review required',
  ],
  scope: ['Không thể nhập trong phạm vi được phép', 'Cannot import within the permitted scope'],
  assignmentPermission: ['Không có quyền phân công người này', 'Assignment is outside your permission'],
  assigneeInactive: ['Người phụ trách đã ngừng hoạt động', 'Assignee is inactive'],
  teamEmpty: ['Đội chưa có thành viên đang hoạt động', 'Team has no active members'],
  permission: ['Bạn không có quyền thực hiện thao tác này', 'You do not have permission for this action'],
  notFound: ['Không tìm thấy lô nhập trong phạm vi của bạn', 'Import was not found within your scope'],
  conflict: ['Dữ liệu đã thay đổi. Tải lại trước khi tiếp tục.', 'Data changed. Reload before continuing.'],
  required: ['Cần chọn giá trị', 'A value is required'],
  duplicateName: [
    'Tên nhãn đã có hoặc trùng sau khi bỏ dấu và khoảng trắng.',
    'This tag name already exists after normalization.',
  ],
  mapping: ['Cột ghép không hợp lệ', 'Invalid mapping'],
  mappingRequired: ['Ghép họ tên và điện thoại hoặc email', 'Map name and either phone or email'],
  mappingDuplicate: ['Một trường chỉ ghép một cột', 'Map each field once'],
  newTags: ['Mỗi lô tạo tối đa 20 nhãn mới', 'Up to 20 new tags per batch'],
  rules: ['Quy tắc không hợp lệ', 'Invalid rules'],
  undoExpired: [
    'Lô chưa thể hoàn tác hoặc đã quá 72 giờ',
    'Batch cannot be undone or the 72-hour window expired',
  ],
  selection: ['Chọn tối đa 100 hồ sơ và 10 nhãn', 'Select up to 100 records and 10 tags'],
  size: ['File trống hoặc quá 10 MB', 'File is empty or exceeds 10 MB'],
  rows: ['File phải có 1–20.000 dòng dữ liệu', 'File must contain 1–20,000 data rows'],
  cell: ['Một ô vượt 8.000 ký tự', 'A cell exceeds 8,000 characters'],
  quotes: ['Dấu nháy trong CSV không hợp lệ', 'Invalid CSV quoting'],
  workbook: [
    'Không đọc được XLSX. Lưu lại file chuẩn, không mã hoá và tải lại.',
    'Cannot read XLSX. Save a standard, unencrypted file and upload again.',
  ],
  format: ['Chọn file CSV, TSV hoặc XLSX', 'Choose a CSV, TSV or XLSX file'],
  encoding: ['Lưu file UTF-8 hoặc UTF-16 rồi tải lại', 'Save as UTF-8 or UTF-16 and upload again'],
  sheet: ['Không tìm thấy trang tính', 'Worksheet was not found'],
  delimiter: ['Dấu phân cách không hợp lệ', 'Invalid delimiter'],
}
export const issueText = (vm: ImportVm, code: unknown) =>
  String(code ?? '')
    .split(',')
    .map((code) => {
      const labels = issueCopy[code.replace(/^crm\.(?:import|error)\./u, '')]
      return labels
        ? say(vm, ...labels)
        : say(
            vm,
            'Thao tác chưa được chấp nhận; kiểm tra dữ liệu và thử lại.',
            'Action was not accepted; check the values and retry.',
          )
    })
    .join('; ')
export const Errors = ({ vm }: { vm: ImportVm }) =>
  vm.errors.length ? (
    <Notice
      tone="danger"
      title={say(vm, 'Chưa thể tiếp tục', 'Cannot continue')}
      message={[vm.notice, ...vm.errors.map((error) => issueText(vm, error.code))].filter(Boolean).join(' ')}
    />
  ) : vm.notice ? (
    <Notice tone="positive" title={say(vm, 'Đã cập nhật', 'Updated')} message={vm.notice} />
  ) : (
    <></>
  )
export { Hidden }
export const Pager = ({ vm, total, offset = 0 }: { vm: ImportVm; total: number; offset?: number }) => (
  <Inline
    align="between"
    items={[
      <Text>
        {total
          ? `${offset + 1}–${Math.min(offset + 50, total)} / ${total}`
          : say(vm, '0 kết quả', '0 results')}
      </Text>,
      <ActionGroup
        actions={[
          offset > 0 ? (
            <LinkButton
              label={say(vm, 'Trước', 'Previous')}
              href={currentHref(vm, { offset: Math.max(0, offset - 50) })}
            />
          ) : null,
          offset + 50 < total ? (
            <LinkButton label={say(vm, 'Tiếp', 'Next')} href={currentHref(vm, { offset: offset + 50 })} />
          ) : null,
        ]}
      />,
    ]}
  />
)
export const Command = ({
  vm,
  operation,
  label,
  id,
  version,
  tone,
}: {
  vm: ImportVm
  operation: string
  label: string
  id?: unknown
  version?: unknown
  tone?: 'primary' | 'destructive'
}) => (
  <ImportForm action={vm.action}>
    <Hidden values={{ operation, id, version, returnTo: vm.base, lang: vm.lang }} />
    <Button label={label} type="submit" variant={tone} />
  </ImportForm>
)
export const RawTable = ({ vm, headers, rows }: { vm: ImportVm; headers: string[]; rows: string[][] }) => (
  <DataTable
    title={say(vm, 'Dữ liệu trong file', 'File data')}
    columns={headers.map((header, index) => ({
      key: String(index),
      label: header,
      cell: (row: { values: string[] }) => row.values[index] || '—',
    }))}
    rows={rows.map((values, index) => ({ id: String(index), values }))}
    id={(row) => row.id}
    responsive="scroll"
  />
)
export const fieldLabels: Record<string, [string, string]> = {
  name: ['Họ tên', 'Name'],
  phone: ['Điện thoại', 'Phone'],
  email: ['Email', 'Email'],
  contactName: ['Người liên hệ', 'Contact'],
  description: ['Ghi chú', 'Notes'],
  source: ['Nguồn', 'Source'],
  medium: ['Kênh', 'Medium'],
  campaign: ['Chiến dịch', 'Campaign'],
  recordTags: ['Nhãn hồ sơ', 'Record tags'],
  customerLabels: ['Nhãn khách hàng', 'Customer labels'],
  ignore: ['Bỏ qua', 'Ignore'],
}
export const ruleLabel = (vm: ImportVm, rule: string) =>
  fieldLabels[rule] ? say(vm, ...fieldLabels[rule]) : rule

export const fieldError = (vm: ImportVm, field: string) =>
  vm.errors
    .filter((error) => error.field === field)
    .map((error) => issueText(vm, error.code))
    .join(' ') || undefined
