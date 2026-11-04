import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { HELP } from '../../product_backend/screens/help-words.ts'
const source = {
  vi: `## Chọn biến thể bằng lưới

Người giữ danh mục chọn **Lưới số lượng** ở Thông tin chung của sản phẩm. Combo luôn chọn trên dòng hàng. Menu **Chọn biến thể** chỉ hiện sản phẩm còn bán có ít nhất hai biến thể đang hoạt động. Chọn một sản phẩm sẽ lưu nháp dòng và kế hoạch giao trước khi mở hộp này.

Lưới có một dòng cho mỗi biến thể đang bán: mỗi thuộc tính một cột theo thứ tự trong trình sửa sản phẩm, rồi **Đơn vị tính**, **Đơn giá**, **Số lượng** và **Thành tiền**. Chỉ cột **Số lượng** sửa được; di chuyển bằng phím mũi tên, Enter để sửa, dán được cả cột từ bảng tính.

Giá và đơn vị của mỗi dòng theo dòng bán đầu tiên của SKU đó, nếu chưa có thì theo bảng giá/đơn vị mặc định. Ô trống hoặc 0 xóa dòng đầu tiên khi chưa có lịch sử; dòng trùng phía sau giữ nguyên. Những dòng không đổi không được gửi. Giá tự động tính lại theo bậc khi chưa có lịch sử; giá nhập tay/lịch sử được giữ.

**Lưu số lượng** ghi toàn bộ thay đổi cùng lúc. Nếu một ô bị chặn do lịch sử giao hàng/hóa đơn hoặc phiên bản đã thay đổi, không ô nào được lưu. Bản nháp vẫn còn. Đóng và mở lại lưới để đọc cấu hình mới trước khi nhập lại phần cần giữ. Đơn khóa/hủy hoặc do hệ thống khác quản lý và người chỉ xem không được sửa.`,
  en: `## Choose variants in a quantity matrix

Catalogue editors select **Quantity matrix** in the product’s General information. Combos always use order lines. **Choose variants** lists active selling products with at least two active SKUs. Choosing a product saves pending order-line and delivery-plan drafts before opening this dialog.

The grid has one row per variant on sale: a column per attribute in the product editor’s order, then **Unit**, **Unit price**, **Quantity** and **Amount**. Only **Quantity** is editable; move with the arrow keys, press Enter to edit, and paste a whole column from a spreadsheet.

Each row uses the first ordinary order line’s price and unit, otherwise the order pricelist/default unit. Blank or zero removes that first line only when history permits. Later duplicates remain unchanged. Unchanged rows are omitted. Automatic prices requote before history; manual and historical prices stay fixed.

**Save quantities** writes every change together. A history, revision or configuration refusal saves no cells and preserves your draft. Close and reopen to read the latest configuration before re-entering changes you need to keep. Locked, cancelled and externally managed orders and read-only viewers cannot edit.`,
}
export const SaleMatrixHelp = ({ lang }: { lang: 'vi' | 'en' }) => (
  <HelpDrawer
    id="sale-matrix-help"
    label={HELP[lang].label}
    title={lang === 'en' ? 'Variant quantities' : 'Số lượng biến thể'}
    closeLabel={HELP[lang].close}
    body={
      <MarkdownContent
        source={source[lang]}
        lexer={marked.lexer}
        headingOffset={1}
        labels={{
          diagram: HELP[lang].diagram,
          table: HELP[lang].table,
          source: HELP[lang].source,
          loading: HELP[lang].loading,
          error: HELP[lang].error,
        }}
      />
    }
  />
)
