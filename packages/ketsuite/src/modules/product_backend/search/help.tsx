import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../screens/help-words.ts'
export const searchHelp = {
  vi: {
    title: 'Tìm trong Sản phẩm',
    source:
      '## Tìm trong danh mục\nDùng ô tìm kiếm trên thanh đầu trang Sản phẩm. Tìm tên, mã, barcode, barcode đóng gói, giá trị thuộc tính, nhãn hoặc số bản ghi nhập. Tìm kiếm không giữ bộ lọc trạng thái, nhóm, nhãn hay công dụng của danh sách trước.\n\n## Kết quả và quyền\nMỗi trang có tối đa 25 kết quả thuộc tám loại: sản phẩm, biến thể/SKU, thuộc tính, đơn vị tính, nhóm, nhãn, lựa chọn combo và bản ghi nhập. Chỉ thấy bản ghi trong công ty đang chọn, đang hoạt động và bạn có quyền mở. Từ khóa trống chưa hiển thị kết quả.\n\n## Mở bản ghi\nSản phẩm và SKU mở trang sản phẩm gốc. Các mục cấu hình và bản ghi nhập mở cửa sổ bản ghi trên danh sách tương ứng. Trên trang sản phẩm, Quay lại danh sách trở về tìm kiếm. Đóng cửa sổ cấu hình giữ bạn ở danh sách của nó; dùng Quay lại của trình duyệt để trở về tìm kiếm.',
  },
  en: {
    title: 'Search in Products',
    source:
      '## Search the catalogue\nUse search in the Products topbar. Find names, codes, barcodes, packaging barcodes, attribute values, tags or import numbers. Status, category, tag and use filters from the previous list do not narrow this search.\n\n## Results and access\nEach page contains up to 25 results across eight types: products, variants/SKUs, attributes, units, categories, tags, combo choices and imports. Results belong to the selected company, are active and require permission to open. A blank query shows no results.\n\n## Open a record\nProducts and SKUs open the parent product page. Configuration and import results open their native record modal over the corresponding collection. On a product page, Back to list returns to search. Closing a configuration modal leaves its collection open; use browser Back to return to search.',
  },
}
export function SearchHelp({ lang, id = 'product-search-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = searchHelp[lang]
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
