// The guide (Help drawer) in Markdown, kept apart from ./order-help.tsx, which draws it.
export const purchaseOrderHelp = {
  vi: {
    title: 'Yêu cầu báo giá và đơn mua',
    source: `Màn hình này là một yêu cầu báo giá (RFQ) hoặc đơn mua: nhà cung cấp, các dòng sản phẩm, phiếu nhập và hoá đơn nhà cung cấp. Các nút ở đầu trang đổi theo trạng thái của đơn.

\`\`\`mermaid
flowchart TD
  A[RFQ nháp] --> B{Tổng tiền từ<br>ngưỡng duyệt?}
  B -->|Không| C[Xác nhận đơn]
  B -->|Có| D[Gửi duyệt]
  D --> E[Quản lý mua hàng<br>phê duyệt]
  E --> G{Từ ngưỡng<br>cấp cuối?}
  G -->|Có| H[Duyệt cấp cuối]
  G -->|Không| F
  C --> F[Đơn mua:<br>nhập hàng, hoá đơn]
  H --> F
  class F kv-positive
\`\`\`

## Thêm và sửa dòng

- RFQ còn nháp hoặc đã gửi, và chưa khoá, thì phần **Sản phẩm** của đơn là một bảng sửa trực tiếp: sửa ngay trong ô, rồi bấm **Lưu các dòng** để lưu mọi thay đổi một lần. Có một dòng không lưu được thì không dòng nào được lưu, và lỗi hiện phía trên bảng. Trên trang chi tiết của đơn, bấm **Sửa các dòng** để mở bảng này.
- **Thêm dòng** thêm một hàng trống. Ở ô **Sản phẩm**, gõ để tìm trong mọi sản phẩm có thể mua; không cần gõ dấu, và mã hay barcode cũng tìm được. Sản phẩm chưa bật **Có thể mua**, hoặc biến thể đã ngừng, không có trong kết quả.
- Chọn sản phẩm thì đơn vị tính của sản phẩm tự điền, và ô **Đơn vị tính** chỉ hiện các đơn vị quy đổi được với nó. Dòng đã lưu giữ nguyên sản phẩm; muốn đổi sản phẩm thì xoá dòng rồi thêm dòng mới.
- Để trống **Đơn giá** trên dòng mới thì hệ thống dùng bảng giá nhà cung cấp. **Thành tiền** tự tính theo số lượng, đơn giá và chiết khấu.
- Khi còn thay đổi chưa lưu, các nút **Đánh dấu đã gửi**, **Xác nhận đơn** và **Gửi duyệt** bị tắt cho tới khi bạn lưu.
- Bảng giá được xét theo thứ tự dòng, gồm dòng chung sản phẩm và dòng đúng biến thể, chỉ của nhà cung cấp trên đơn còn hoạt động và còn hạn. Dòng đầu đạt số lượng tối thiểu được dùng; nếu không dòng nào đạt thì dùng dòng hợp lệ đầu tiên. Số lượng và giá được đổi theo đơn vị mua; đơn giá nhập tay được giữ nguyên.

## Trạng thái và hành động

- **Đánh dấu đã gửi** ghi nhận RFQ đã gửi cho nhà cung cấp. Bạn vẫn sửa được các dòng.
- **Xác nhận đơn** chuyển RFQ thành đơn mua và tạo phiếu nhập. RFQ phải có ít nhất một dòng.
- Công ty đặt ngưỡng ở **Cài đặt → Cấu hình mua hàng**. Đơn có tổng tiền từ ngưỡng cấp 1 thì chỉ còn nút **Gửi duyệt**: quản lý mua hàng bấm **Phê duyệt**. Đơn từ ngưỡng cấp cuối cần thêm **Duyệt cấp cuối**; người duyệt cấp cuối duyệt được cả cấp 1 còn chờ. Khối **Phê duyệt** trên trang cho biết đơn cần mấy cấp, ai đã duyệt và còn chờ ai.
- Dưới ngưỡng, **Xác nhận đơn** thành đơn mua ngay; bấm **Gửi duyệt** nếu muốn quản lý xem trước.
- Người lập đơn không tự duyệt đơn của mình. **Trả về nháp** đưa RFQ đã gửi hoặc đang chờ duyệt về nháp để sửa, không cần huỷ; các lượt duyệt bị xoá và gửi lại thì duyệt lại theo tổng tiền mới.
- **Đồng bộ nhập hàng** cập nhật phiếu nhập và số lượng đã nhận theo các dòng của đơn mua.
- **Khoá đơn** giữ đơn mua không bị huỷ; **Mở khoá** bỏ khoá. Nút **Huỷ** chỉ có khi đơn chưa khoá.

## Hoá đơn nhà cung cấp

Khi đơn mua có số lượng cần lập hoá đơn, phần **Tạo hoá đơn nhà cung cấp** sẽ hiện. Điền các tài khoản và ngày, rồi bấm **Tạo hoá đơn**. Hoá đơn đã tạo nằm trong bảng **Hoá đơn nhà cung cấp**; phiếu nhập nằm trong bảng **Phiếu nhập**.`,
  },
  en: {
    title: 'RFQs and purchase orders',
    source: `This page is one request for quotation (RFQ) or purchase order: its vendor, product lines, receipts and vendor bills. The buttons at the top change with the order's state.

\`\`\`mermaid
flowchart TD
  A[Draft RFQ] --> B{Total reaches the<br>approval threshold?}
  B -->|No| C[Confirm order]
  B -->|Yes| D[Request approval]
  D --> E[A purchasing<br>manager approves]
  E --> G{Reaches the<br>final threshold?}
  G -->|Yes| H[Final approval]
  G -->|No| F
  C --> F[Purchase order:<br>receive, bill]
  H --> F
  class F kv-positive
\`\`\`

## Adding and editing lines

- While an RFQ is a draft or sent, and unlocked, the order's **Products** are an editable grid: change them in their cells, then press **Save lines** to save every change at once. If one line cannot be saved, none is, and the reason shows above the grid. On the order's own page, press **Edit lines** to open this grid.
- **Add line** adds an empty row. In its **Product** cell, type to search every product that can be bought; accents are optional, and codes and barcodes match too. A product not marked **Can be purchased**, or a variant that was retired, is not found.
- Choosing a product fills in its unit, and **Unit** then offers only the units it converts into. A saved line keeps its product; to change the product, remove the line and add a new one.
- Leave **Unit Price** blank on a new line to use the vendor pricelist. **Subtotal** follows the quantity, unit price and discount.
- While changes are unsaved, **Mark as Sent**, **Confirm Order** and **Request Approval** are disabled until you save.
- Vendor prices follow row order, including template-wide and matching-variant rows for the order's active vendor within their validity dates. The first row meeting its minimum quantity wins; otherwise the first eligible row is used. Quantities and prices are converted to the purchase unit. An explicit unit price is preserved.

## States and actions

- **Mark as Sent** records that the RFQ went to the vendor. Its lines stay editable.
- **Confirm Order** turns the RFQ into a purchase order and creates a receipt. The RFQ needs at least one line.
- The company sets thresholds under **Settings → Purchasing settings**. An order totalling the level 1 threshold or more offers only **Request Approval**: a purchasing manager presses **Approve**. From the final threshold it also needs **Final approval**; a final approver can give a pending level 1 approval too. The **Approval** block on the page shows how many levels the order needs, who approved and who is still awaited.
- Below the thresholds, **Confirm Order** makes the purchase order at once; choose **Request Approval** to have a manager look first.
- Whoever drafted an order cannot approve it. **Reset to draft** returns a sent or pending RFQ to draft for changes, without cancelling it; its approvals are cleared and a resubmission is approved again at its new total.
- **Sync Receipts** brings the receipts and received quantities in line with the order's lines.
- **Lock** keeps a purchase order from being cancelled; **Unlock** lifts it. **Cancel** is only offered while the order is unlocked.

## Vendor bills

When a purchase order has quantities to bill, a **Create Vendor Bill** section appears. Fill in the accounts and date, then press **Create Bill**. Created bills are listed under **Vendor Bills**; receipts under **Receipts**.`,
  },
} as const
