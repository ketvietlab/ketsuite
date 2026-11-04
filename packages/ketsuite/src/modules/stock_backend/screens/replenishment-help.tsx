import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Cấu hình bổ sung hàng
Chọn sản phẩm, kho, vị trí và mức tồn tối thiểu/tối đa. Đơn vị bổ sung phải cùng hệ đo với sản phẩm. Nguồn **Theo tuyến** dùng tuyến cung ứng đã cấu hình. Nguồn **Nhà cung cấp** chỉ dùng cho sản phẩm Có thể mua, có quản lý tồn kho, đang hoạt động và không phải combo.

## Nhà cung cấp và thời gian chờ
Chọn một NCC trên sản phẩm hoặc **Theo sản phẩm**. Tự động chọn thử theo thứ tự trong thẻ Nhà cung cấp: dòng đầu đạt số lượng tối thiểu thắng; không dòng nào đạt thì dùng dòng hợp lệ đầu tiên. **Nguồn hàng** trong tóm tắt là NCC mà lượng **Cần đặt** hiện tại sẽ đặt tới.

**Thời gian chờ** nhận số ngày nguyên 0–365. Để trống chỉ khi nguồn NCC có nhà cung cấp trên sản phẩm: dùng số ngày của NCC chỉ định, hoặc NCC hợp lệ đầu tiên. Gõ số ngày sẽ ưu tiên số đó; đổi nguồn hàng sẽ xoá số ngày và NCC đã chọn. Tóm tắt hiển thị dữ liệu đã lưu; hãy lưu thay đổi trước khi đặt hàng.

## Đặt hàng
Dự báo tính tồn có thể dùng và dịch chuyển đã xác nhận đến hết thời gian chờ; hàng trong phiếu nhập nháp và trong yêu cầu báo giá chưa xác nhận được trừ khỏi số còn cần đặt để không đặt trùng. Số đặt được làm tròn lên theo đơn vị bổ sung.

Với nguồn **Nhà cung cấp**, **Chạy bổ sung** thêm một dòng vào **yêu cầu báo giá** nháp của đúng NCC, kho và vị trí, theo giá trong bảng giá NCC; chưa có thì tạo yêu cầu mới. Bộ phận Mua hàng thấy nó ở **Mua hàng → Tổng quan**, mục **Nhu cầu bổ sung từ kho**, rồi kiểm giá, gửi NCC và xác nhận; xác nhận xong mới có phiếu nhập. Yêu cầu đã gửi thì lần chạy sau mở yêu cầu mới. Người có quyền vận hành kho mới được lưu/chạy; người xem chỉ đọc. Nếu có xung đột, tải lại rồi kiểm tra lượng đã đặt trước khi thử lại.`,
  en: `## Configure replenishment
Choose a product, warehouse, location and minimum/maximum levels. The replenishment unit must measure the same thing as the product. **Route** uses configured supply routes. **Supplier** requires an active storable purchasable non-combo product.

## Supplier and lead time
Choose a product supplier or **Follow product**. Automatic selection follows the Suppliers card order: the first eligible row meeting its minimum wins, otherwise the first eligible row is used. **Supply source** in the summary is the supplier the current **To order** quantity would go to.

**Lead days** accepts whole numbers from 0 to 365. Only a supplier rule with product suppliers can leave it blank: use the chosen supplier's days, or the first eligible supplier's days. An explicit number takes precedence; changing the supply source clears the days and the chosen supplier. The summary shows saved values; save edits before ordering.

## Order goods
The forecast includes usable stock and confirmed movements due within the lead horizon. Draft receipts and unconfirmed requests for quotation already on order reduce the remaining need to prevent duplicates. Quantities round up to the replenishment unit increment.

For a **Supplier** source, **Run replenishment** adds a line to the draft **request for quotation** of the selected supplier, warehouse and location, at the vendor price list's price, or starts a new request. Purchasing finds it under **Purchase → Overview**, **Stock replenishment demands**, checks the price, sends it and confirms it; the receipt comes with the confirmation. Once a request is sent, the next run starts a new one. Stock operators may save/run; viewers only read. Reload after a conflict and check quantities already ordered before retrying.`,
}

export function ReplenishmentHelp({ lang }: { lang: 'vi' | 'en' }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id="stock-replenishment-help"
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Bổ sung hàng' : 'Replenishment'}
      closeLabel={vi ? 'Đóng' : 'Close'}
      body={
        <MarkdownContent
          source={guides[lang]}
          lexer={marked.lexer}
          headingOffset={1}
          labels={{
            diagram: vi ? 'Sơ đồ' : 'Diagram',
            table: vi ? 'Bảng' : 'Table',
            source: vi ? 'Nguồn' : 'Source',
            loading: vi ? 'Đang tải' : 'Loading',
            error: vi ? 'Không tải được' : 'Failed to load',
          }}
        />
      }
    />
  )
}
