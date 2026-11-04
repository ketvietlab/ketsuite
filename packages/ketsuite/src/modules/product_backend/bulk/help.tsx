import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../screens/help-words.ts'
export const bulkHelp = {
  vi: {
    title: 'Sửa hàng loạt',
    source:
      '## Chọn và áp dụng\nTick từ 1 đến 200 sản phẩm trên trang hiện tại, mở Sửa hàng loạt, chọn trường rồi giá trị mới. Không có lựa chọn đầu tiên được áp dụng ngầm. Nhóm, thẻ, thuế phải có sẵn; ngày giao là số nguyên 0–365; giá bán dùng số thập phân với dấu chấm.\n\n## Quyền và tính nguyên tử\nMỗi trường có cùng quyền và kiểm tra như trang sản phẩm. Tồn thực tế khóa đổi theo dõi tồn. Một sản phẩm bị từ chối thì toàn bộ nhóm không đổi; lỗi nêu sản phẩm và trường, giữ giá trị đang nhập. Khi revision cũ, đóng và mở lại để đọc bản mới.\n\n## Lịch sử SUA\nGiá trị đã đúng, kể cả 03 và 3 ngày, không ghi lại hay tăng revision. Mỗi lần áp dụng thành công tạo phiếu SUA, ghi người, trường, giá trị, số chọn và số đổi. Chỉ sản phẩm đổi có dòng lịch sử SUA. Chưa có danh sách phiếu sửa hàng loạt riêng.',
  },
  en: {
    title: 'Bulk edit',
    source:
      '## Select and apply\nSelect 1–200 products on the current page, open Bulk edit, choose a field and its new value. No first option is applied implicitly. Groups, tags and taxes must exist; lead days are whole numbers from 0–365; sales prices use a decimal point.\n\n## Permission and atomicity\nEach field uses the same permission and validation as the product page. Physical stock locks inventory tracking changes. One refusal rolls back the whole selection; errors name the product and field and retain your draft. Close and reopen after a revision conflict to read current values.\n\n## SUA history\nMatching values, including 03 and 3 days, are not rewritten and retain their revision. Each successful submission creates a SUA receipt with actor, field, value, selected count and changed count. Only changed products receive a SUA history entry. There is no separate bulk receipt list.',
  },
}
export function BulkHelp({ lang, id = 'product-bulk-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = bulkHelp[lang]
  return (
    <HelpDrawer
      id={id}
      label={words.label}
      title={guide.title}
      closeLabel={words.close}
      body={
        <MarkdownContent
          source={guide.source}
          lexer={marked.lexer}
          headingOffset={1}
          labels={{
            diagram: words.diagram,
            table: words.table,
            source: words.source,
            loading: words.loading,
            error: words.error,
          }}
        />
      }
    />
  )
}
