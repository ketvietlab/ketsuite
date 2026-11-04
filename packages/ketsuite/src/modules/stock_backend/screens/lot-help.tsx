import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Theo dõi ngày và cách ly lô
Chọn sản phẩm, nhập số lô và ngày sản xuất. Khi tạo lô mới, hạn dùng được tính theo số tháng đã cấu hình trên sản phẩm; ngày cuối tháng được giữ trong tháng đích. Bạn có thể nhập hạn dùng khác.

**Tốt nhất trước ngày**, **Ngày ngừng xuất** và **Ngày cảnh báo** mặc định được lùi từ hạn dùng theo số ngày trên sản phẩm. Khi đổi hạn dùng, các ngày tự tính sẽ dịch theo; ngày đã sửa riêng được giữ. Đổi cấu hình sản phẩm không sửa ngày của lô đã tạo.

## Tình trạng trong danh sách
Danh sách lô có cột **Hạn dùng** và **Trạng thái**, tính lại mỗi lần mở: **Đã lưu trữ**, **Đang cách ly**, **Đã hết** (không còn tồn ở vị trí kho), **Hết hạn** (đã tới hạn dùng), **Sắp hết hạn** (đã tới ngày cảnh báo; lô không có ngày cảnh báo thì 90 ngày trước hạn dùng), **Còn hạn** hoặc **Không hạn dùng**. Bộ lọc có từng tình trạng này, cạnh **Còn tồn** và **Hết tồn**. Lô hết hạn hoặc đang cách ly vẫn là tồn thực tế nhưng không được giữ cho phiếu giao.

## Giữ và xuất hàng
Hệ thống ưu tiên lô có ngày ngừng xuất sớm nhất, dùng hạn dùng khi chưa có ngày ngừng xuất. Lô cách ly, hết hạn hoặc tới ngày ngừng xuất không được giữ thêm hoặc xuất cho khách. Hoàn tất phiếu luôn dùng đúng lô đang giữ.

Đổi ngày hoặc trạng thái lô sẽ phân bổ lại các phiếu đang giữ chưa lấy hàng. Nếu lô đã được lấy trên phiếu, hãy bỏ lấy hàng trước khi sửa; không đổi lô trên dữ liệu khi hàng thực tế đã được lấy.

## Cách ly và lịch sử
Chọn **Đang cách ly** hoặc **Không cách ly**, nhập lý do rồi lưu. Lịch sử ghi người thực hiện, thời gian và thay đổi. Bỏ cách ly chỉ cho phép dùng lô nếu các ngày vẫn hợp lệ.

**Mở sản phẩm** ở đầu trang mở trang của sản phẩm mà lô thuộc về, khi bạn có quyền xem sản phẩm.

## Thông báo, truy xuất và số liệu
- Lô đang cách ly, đã hết hạn hoặc sắp hết hạn có thông báo ở đầu trang, kèm lý do cách ly hoặc hạn dùng.
- **Truy xuất lô** liệt kê mọi dòng đã hoàn tất của lô, mới nhất trước: từ tồn kiểm kê hoặc phiếu nhập, qua phiếu chuyển, tới phiếu xuất và phiếu hủy. Mỗi dòng có phiếu (bấm để mở), từ, đến, số lượng, loại, đối tác và chứng từ gốc; chứng từ gốc là đơn bán thì bấm mở được đơn, khi bạn được xem đơn bán.
- Cột bên phải (**Số liệu lô**): **Đã nhập** từ nhà cung cấp và kiểm kê, **Đang tồn**, **Đang giữ** cho phiếu khác, **Đã giao** cho khách trừ hàng trả về, và số **Khách đã nhận**.

## Hủy hàng của lô
Quản lý kho và chủ doanh nghiệp bấm **Hủy hàng**, chọn kho đang giữ lô, số lượng (bỏ trống là hủy hết phần chưa giữ cho phiếu khác), lý do và ghi chú bắt buộc. Lô đã hết hạn gợi ý **Hết hạn**, lô đang cách ly gợi ý **Không đạt kiểm nghiệm**. Hàng rời kho ngay bằng một phiếu hủy đã xác nhận, ghi Nợ 632 / Có 156 theo giá vốn. Lịch sử lô ghi số phiếu, số lượng và lý do. Hủy nhầm thì hoàn tác trên màn **Phiếu hủy hàng**.

## Điều chỉnh kiểm kê
Khi một phiên kiểm kê được duyệt, lô có số đếm lệch với sổ ghi dòng **Điều chỉnh kiểm kê** trong lịch sử: số phiên, số trên sổ, số đếm được và lý do người đếm ghi.

Quyền cấu hình kho cho phép sửa; người có quyền xem chỉ đọc thông tin và lịch sử. Nếu báo lô đã thay đổi, tải lại bản ghi trước khi lưu.`,
  en: `## Lot dates and quarantine
Choose a product, enter the lot number and manufacturing date. New lots calculate expiry from the product's shelf life in calendar months, clamping to the last day of the target month. You can enter a different expiry.

**Best before**, **Removal date** and **Alert date** default to the configured number of days before expiry. Changing expiry shifts generated dates while preserving dates you overrode. Updating product defaults never rewrites existing lots.

## Condition in the list
The lots list shows **Expiry** and **Status**, worked out each time it opens: **Archived**, **Quarantined**, **Depleted** (nothing left in a stock location), **Expired** (its expiry has come), **Expiring soon** (its alert date has come; without one, 90 days before expiry), **In date** or **No expiry**. The filter offers each of them beside **In stock** and **Out of stock**. An expired or quarantined lot still counts as on hand but is never reserved for a delivery.

## Reservation and delivery
Reservation prefers the earliest removal date, falling back to expiry. Quarantined, expired and removed lots cannot receive new reservations or be delivered to customers. Completion consumes the exact reserved lot.

Changing dates or status reassigns open, unpicked reservations. Unpick a transfer before changing a lot already picked; its physical stock must stay aligned with its recorded identity.

## Quarantine and history
Select **Quarantined** or **Released**, enter a reason and save. History records who changed the lot, when and what changed. Releasing quarantine only makes a lot available if its dates remain valid.

**Open product** at the top opens the page of the product the lot belongs to, when you may read products.

## Notices, traceability and figures
- A quarantined, expired or soon expiring lot has a notice at the top of its page, with the quarantine reason or the expiry date.
- **Lot traceability** lists every finished line of the lot, newest first: from the count or receipt, through transfers, to deliveries and scraps. Each line gives the transfer (select it to open), from, to, quantity, type, partner and source document; when the source is a sales order you may read, it opens the order.
- The right-hand column (**Lot figures**): **Received** from suppliers and counts, **On hand**, **Reserved** for other transfers, **Delivered** to customers less returns, and **Customers reached**.

## Scrap goods of the lot
Stock managers and the owner select **Scrap**, choose a warehouse that holds the lot, the quantity (empty scraps all that no other transfer has reserved), a reason and a required note. An expired lot suggests **Expired**; a quarantined lot suggests **Failed quality test**. The goods leave at once on a validated scrap order, posted Dr 632 / Cr 156 at cost. The lot history keeps the order number, quantity and reason. If it was a mistake, undo it on the **Scrap orders** screen.

## Count adjustments
When a physical count is approved, a lot whose counted figure differs from the book gets a **Count adjustment** row in its history: the count number, the book quantity, the counted quantity and the counter's reason.

Stock configuration permission allows edits. Viewers can read information and history. Reload if another person changed the lot before you saved.`,
}
export function LotHelp({ lang, id = 'stock-lot-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={id}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Lô và hạn dùng' : 'Lots and shelf life'}
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
