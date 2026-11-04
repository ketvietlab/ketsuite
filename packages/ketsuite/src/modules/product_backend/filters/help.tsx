import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../screens/help-words.ts'
export const filterHelp = {
  vi: {
    title: 'Bộ lọc công dụng và đã lưu',
    source:
      '## Công dụng\nLọc sản phẩm có thể bán, có thể mua, không bán hoặc theo dõi theo lô. SKU dùng công dụng của sản phẩm cha. Cờ bán/mua chưa đặt được hiểu là bật; theo lô phải được khai rõ.\n\n## Lưu và áp dụng\nMenu Đã lưu áp dụng tìm kiếm, trạng thái, nhóm, thẻ, công dụng và sắp xếp đã lưu. Phân trang, dòng đã chọn và modal không được lưu. Sản phẩm và SKU có danh sách bộ lọc riêng.\n\n## Riêng tư và chia sẻ\nNhập tên tối đa 60 ký tự, không trùng tên bộ lọc của bạn trong cùng danh sách. Chia sẻ chỉ hiển thị trong công ty hiện tại; người khác chỉ áp dụng, không sửa hoặc xóa. Người có quyền xem danh mục được lưu bộ lọc riêng.\n\n## Sửa hoặc xóa\nKhi trạng thái hiện tại khớp bộ lọc của bạn, menu Đã lưu có Sửa bộ lọc "tên" (tên bộ lọc của bạn) để đổi tên, chia sẻ, đặt mặc định hoặc xóa. Để lưu trạng thái đang xem, chọn Lưu bộ lọc này. Bạn đổi tên, chế độ chia sẻ hoặc xóa với xác nhận. Nếu có người sửa đồng thời, đóng và mở lại để lấy bản mới. Lỗi giữ nguyên nội dung đang nhập.',
  },
  en: {
    title: 'Use and saved filters',
    source:
      '## Use\nFilter products that can be sold, can be purchased, are not sold or are tracked by lot. SKUs inherit use from their parent. Missing sale/purchase flags mean enabled; lot tracking must be explicit.\n\n## Save and apply\nThe Saved menu restores search, status, category, tags, use and sorting. Paging, selected rows and modal context are excluded. Products and SKUs have separate saved filters.\n\n## Private and shared\nNames have up to 60 characters and must be unique among your filters in the same list. Sharing is limited to the current company; others can apply but cannot edit or delete. Catalogue readers may save private filters.\n\n## Edit or delete\nWhen the current state matches one of your filters, Saved offers Edit filter "name" (the name of your filter) to rename, share, set as default or delete it. To keep what you are viewing, choose Save this filter. Rename, change sharing or delete with confirmation. After a concurrent edit, close and reopen to read the latest version. Refusals preserve your input.',
  },
} as const
export function FilterHelp({ lang, id = 'product-filter-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = filterHelp[lang]
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
