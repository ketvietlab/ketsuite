import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { HELP } from '../../product_backend/screens/help-words.ts'
const source = {
  vi: `## Chọn hàng theo đơn

Nút **Danh mục** ở phần dòng lưu bản nháp dòng và kế hoạch giao trước khi mở trang này. Nếu lưu bị từ chối, bạn ở lại đơn với nội dung đang sửa.

Tìm theo tên không dấu, mã SKU hoặc barcode đóng gói. Chọn nhóm để gồm cả nhóm con. Mỗi thuộc tính chọn một giá trị; kết quả phải khớp các thuộc tính đã chọn. Số bên cạnh lựa chọn là số SKU phù hợp với các bộ lọc còn lại. Bấm **Lọc** để giữ bộ lọc trên URL; có thể chia sẻ đường dẫn hoặc quay lại bằng Back. Mỗi trang có tối đa 24 SKU, không gồm combo.

## Số lượng và giá

Bấm **Thêm**, **+**, **−**, hoặc nhập số lượng rồi Enter/rời ô. Dòng mới được thêm cuối đơn bằng đơn vị mặc định. Nếu SKU đã có, chỉ dòng thường đầu tiên theo thứ tự đơn được sửa; các dòng trùng phía sau và món combo giữ nguyên. Giá trên thẻ là giá một đơn vị của dòng sau chiết khấu, hoặc bảng giá của đơn nếu chưa có dòng.

Giá tự động tính lại theo bậc số lượng khi chưa có lịch sử; giá nhập tay và giá có lịch sử giữ nguyên. Số lượng 0 xóa dòng chưa có tham chiếu kho/hóa đơn. Dòng có lịch sử không thể xóa; cũng không thể giảm dưới số đã giao, lập hóa đơn hoặc nhặt. Với đơn đã xác nhận nhưng chưa khóa, phần nhu cầu kho còn lại được cập nhật cùng lần lưu.

Người chỉ có quyền xem, đơn khóa, đơn hủy và đơn do kênh ngoài quản lý không sửa được. Khi đơn đã bị người khác sửa, kiểm tra số đã lưu và thử lại; không tự ghi đè. Nếu mất kết nối, tải lại để xác định lần lưu trước đã thành công hay chưa.`,
  en: `## Choose products for this order

**Catalogue** in the order lines saves pending line and delivery-plan drafts before opening this page. A refused save keeps you on the order with your edits.

Search accent-insensitive names, SKU codes or packaging barcodes. Categories include descendants. Select one value per attribute; results match every selected attribute. Each facet count applies the other filters. Choose **Filter** to keep the filters in the URL, share the link or use Back. Each page contains at most 24 SKUs and excludes combos.

## Quantities and prices

Choose **Add**, **+**, **−**, or enter a quantity and press Enter/leave the field. A new line is appended using the default unit. For an existing SKU, only its first ordinary order line changes; later duplicates and combo items remain unchanged. Each card shows that line's discounted unit price, or the order pricelist for a new line.

Automatic prices requote quantity tiers before history exists; manual and historical prices stay fixed. Zero removes a line without stock/invoice references. Historical lines cannot be deleted, and quantity cannot fall below delivered, invoiced or picked quantities. Confirmed unlocked orders update remaining stock demand in the same save.

Readers, locked/cancelled orders and externally managed orders cannot edit. After a concurrent change, review saved quantities before retrying. If the connection fails, reload to determine whether the previous save succeeded.`,
}
export const SaleCatalogueHelp = ({ lang }: { lang: 'vi' | 'en' }) => (
  <HelpDrawer
    id="sale-catalogue-help"
    label={HELP[lang].label}
    title={lang === 'en' ? 'Sales catalogue' : 'Danh mục bán hàng'}
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
