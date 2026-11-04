import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'

// The bill of materials guide (Help drawer), in Markdown. It describes ./bom-view.tsx, its grids
// in ./bom-grid.tsx and the version commands of `manufacturing`; change it with them.
export const bomHelp = {
  vi: {
    title: 'Định mức nguyên liệu',
    source: `Một phiên bản định mức: thành phẩm, cho bao nhiêu (một mẻ), cách xử lý khi dùng quá, các **Công đoạn** và **Nguyên vật liệu** trong hai bảng nhập liệu.

\`\`\`mermaid
flowchart LR
  draft[Nháp] -- Gửi duyệt --> review[Chờ duyệt]
  review -- Người khác duyệt --> active[Đang dùng]
  review -- Trả lại --> draft
\`\`\`

## Sửa

- Chỉ phiên bản **Nháp** sửa được. Sửa trong hai bảng rồi bấm **Lưu**: phần cài đặt và cả hai bảng lưu cùng lúc; có một dòng sai thì không dòng nào được lưu, và lỗi ghi rõ bảng và số dòng.
- Mỗi nguyên liệu có số lượng cho một mẻ, **Hao hụt %** (0–50) và công đoạn dùng nó. Cột công đoạn chỉ có các công đoạn đã lưu: thêm công đoạn mới thì lưu trước rồi mới gán cho nguyên liệu.
- Mỗi công đoạn có khu sản xuất, số phút và cách tính: **Theo sản lượng** nhân số phút theo số lượng lệnh so với mẻ; **Cố định** giữ nguyên số phút cho mỗi lệnh (như ủ).
- Số cần của một nguyên liệu khi xác nhận lệnh = số lượng × (1 + hao hụt) × số lượng lệnh ÷ số lượng mẻ.

## Duyệt và phiên bản

- **Gửi duyệt** cần ít nhất một nguyên liệu và một lý do đổi định mức. Người gửi không tự duyệt. **Trả lại** cần lý do; lý do hiện trên bản nháp.
- Duyệt một phiên bản thì phiên bản đang dùng trước đó chuyển sang lưu trữ và trao lại mã. Lệnh đã xác nhận trên bản cũ giữ nguyên số của bản cũ.
- **Tạo bản mới** chép phiên bản đang dùng thành bản nháp kế tiếp. Khung **Phiên bản** liệt kê mọi bản cùng họ.`,
  },
  en: {
    title: 'Bills of materials',
    source: `One version of a bill of materials: the product, how much one batch makes, what happens when more is used, and its **Operations** and **Components** in two grids.

\`\`\`mermaid
flowchart LR
  draft[Draft] -- Submit --> review[In review]
  review -- Another person approves --> active[In use]
  review -- Send back --> draft
\`\`\`

## Editing

- Only a **Draft** version changes. Edit both grids and press **Save**: the settings and both grids save together; if one row is refused none is saved, and the refusal names the grid and the row.
- Each component has a quantity for one batch, a **Loss %** (0–50) and the operation that uses it. The operation column offers saved operations only: save a new operation before assigning components to it.
- Each operation has a work center, minutes and how they count: **By quantity** scales the minutes by the order against the batch; **Fixed** keeps them per order (like curing).
- A component's need when an order is confirmed = quantity × (1 + loss) × order quantity ÷ batch quantity.

## Approval and versions

- **Submit** needs at least one component and a reason for the change. Whoever submits does not approve. **Send back** needs a reason, shown on the draft.
- Approving a version archives the one in use, which hands over its code. Orders already confirmed on the old version keep its numbers.
- **New version** copies the version in use into the next draft. The **Versions** panel lists every version of the family.`,
  },
} as const

export function bomPageScreen(_: Translator, frame: Frame, island: JSXChild) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const words = HELP[lang]
  return shell(
    _,
    _('manufacturing_backend.boms.title'),
    <>
      {island}
      <HelpDrawer
        id="manufacturing-bom-help"
        label={words.label}
        title={bomHelp[lang].title}
        closeLabel={words.close}
        body={
          <MarkdownContent
            source={bomHelp[lang].source}
            lexer={marked.lexer}
            headingOffset={1}
            labels={words}
          />
        }
      />
    </>,
    {
      ...frame,
      topbar: false,
      titled: false,
      ...(frame.applications ? { applications: { ...frame.applications, helpLabel: words.trigger } } : {}),
    },
  )
}
