import { marked } from 'marked'
import type { Translator } from '@ketvietlab/ketjs'
import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { ImportRoot } from '../../../ui/crm-import.tsx'
import { shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { importIsland, importPresentation } from '../import-island.tsx'
import type { ImportVm } from './import-ui.tsx'
import { say } from './import-ui.tsx'

export function ImportFrame(vm: ImportVm, _: Translator, frame: Frame) {
  const title = say(vm, 'CRM · Nhập lead và nhãn', 'CRM · Lead imports and tags')
  const guide: Record<ImportVm['screen'], [string, string][]> = {
    batches: [
      [
        'Chọn một lô để xem tiến độ, kết quả hoặc tiếp tục bản nháp.',
        'Choose a batch to see progress, results or continue a draft.',
      ],
      [
        'Nhập lead mới nhận CSV, TSV, XLSX hoặc dữ liệu dán từ bảng tính.',
        'New lead import accepts CSV, TSV, XLSX or pasted spreadsheet cells.',
      ],
    ],
    wizard: [
      [
        '1. Tải dữ liệu, kiểm tra đúng trang tính và dòng tên cột.',
        '1. Upload data and verify the worksheet and header row.',
      ],
      [
        '2. Ghép họ tên và điện thoại hoặc email. Ghép giá trị nhãn vào danh mục, tạo mới hoặc bỏ qua.',
        '2. Map name and phone or email. Match label values to the catalogue, create or ignore them.',
      ],
      [
        '3. Chọn nguồn, phân công, cách xử lý trùng, nhãn cả lô và việc liên hệ đầu tiên.',
        '3. Choose source, assignment, duplicates, batch tags and first contact task.',
      ],
      [
        '4. Kiểm tra từng dòng rồi Bắt đầu nhập. Dòng lỗi được bỏ qua và có thể tải về để sửa.',
        '4. Review each row and Start import. Invalid rows are skipped and can be downloaded for correction.',
      ],
      [
        'Không có hồ sơ mới trước bước cuối. Nhập file không tự cấp quyền tiếp thị hay đồng ý liên hệ.',
        'No records are created before the final step. Importing does not grant marketing or contact consent.',
      ],
    ],
    batch: [
      [
        'Tổng quan cho biết kết quả; Các dòng giữ dữ liệu gốc và kết quả từng dòng; Hiệu quả tổng hợp hồ sơ đã tạo hoặc được gộp.',
        'Overview shows results; Rows keeps originals and outcomes; Performance summarizes created or merged records.',
      ],
      [
        'Dừng lô giữ các dòng đã ghi. Chạy tiếp xử lý phần còn lại. Hoàn tác trong 72 giờ lưu trữ hồ sơ mới chưa bị sửa và gỡ nhãn do lô thêm; khách dùng chung và hồ sơ đã xử lý được giữ lại.',
        'Stopping retains written rows. Resume handles the remainder. Undo within 72 hours archives untouched new records and removes tags added by the batch; shared customers and modified records are retained.',
      ],
    ],
    tags: [
      [
        'Tìm nhãn gần giống hoặc không dùng 90 ngày. Chỉ người có quyền cấu hình tạo, sửa, lưu trữ và gộp nhãn.',
        'Find near duplicates or tags unused for 90 days. Only configurators can create, edit, archive and merge tags.',
      ],
      [
        'Lưu trữ giữ nhãn trên hồ sơ cũ. Gộp chuyển hồ sơ và lô nhập sang nhãn đích, rồi lưu trữ nhãn nguồn.',
        'Archiving retains tags on existing records. Merging moves records and batches to the target tag, then archives the source.',
      ],
    ],
    records: [
      [
        'Lọc theo nhãn, chưa có nhãn hoặc mở từ một lô nhập. Bấm vào hồ sơ để xem chi tiết.',
        'Filter by tag, untagged, or open this list from an import batch. Open a record to inspect it.',
      ],
      [
        'Chọn hồ sơ trên trang rồi gắn hoặc gỡ nhãn. Nhãn khác không bị thay đổi. Quyền được kiểm tra lại cho từng hồ sơ.',
        'Select records on this page to add or remove tags. Other tags are preserved. Permissions are checked again for every record.',
      ],
    ],
  }
  return shell(
    _,
    title,
    <>
      <ImportRoot>
        {importPresentation(vm)}
        {trustedMarkup(renderIsland('crm.import-screen', importIsland.view, { model: vm }, { tag: 'div' }))}
      </ImportRoot>
      <HelpDrawer
        id="crm-import-help"
        label={say(vm, 'Hướng dẫn', 'Help')}
        title={title}
        closeLabel={say(vm, 'Đóng hướng dẫn', 'Close help')}
        body={
          <MarkdownContent
            source={guide[vm.screen].map((labels) => say(vm, ...labels)).join('\n\n')}
            lexer={marked.lexer}
            headingOffset={1}
            labels={{
              diagram: say(vm, 'Sơ đồ', 'Diagram'),
              table: say(vm, 'Bảng', 'Table'),
              source: say(vm, 'Mã sơ đồ', 'Diagram source'),
              loading: say(vm, 'Đang tải', 'Loading'),
              error: say(vm, 'Không thể tải sơ đồ', 'Unable to load diagram'),
            }}
          />
        }
      />
    </>,
    {
      ...frame,
      topbar: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: say(vm, 'Hướng dẫn màn hình', 'Screen help') } }
        : {}),
    },
  )
}
