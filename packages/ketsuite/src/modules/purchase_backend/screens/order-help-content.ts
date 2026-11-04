// The guide (Help drawer) in Markdown, kept apart from ./order-help.tsx, which draws it.
export const purchaseOrderHelp = {
  vi: {
    title: 'Yêu cầu báo giá và đơn mua',
    source: `Màn hình này là một yêu cầu báo giá (RFQ) hoặc đơn mua: nhà cung cấp, các dòng sản phẩm, phiếu nhập và hoá đơn nhà cung cấp. Các nút ở đầu trang đổi theo trạng thái của đơn.

\`\`\`mermaid
flowchart TD
  A[RFQ nháp] --> B{Cần người<br>duyệt?}
  B -->|Không| C[Xác nhận đơn]
  B -->|Có| D[Gửi duyệt]
  D --> E[Phê duyệt]
  C --> F[Đơn mua:<br>nhập hàng, hoá đơn]
  E --> F
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
- **Gửi duyệt** chuyển RFQ sang chờ duyệt; người có quyền duyệt bấm **Phê duyệt** để thành đơn mua. **Trả về nháp** đưa RFQ đã gửi hoặc đang chờ duyệt về nháp để sửa, không cần huỷ.
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
  A[Draft RFQ] --> B{Needs an<br>approver?}
  B -->|No| C[Confirm order]
  B -->|Yes| D[Request approval]
  D --> E[Approve]
  C --> F[Purchase order:<br>receive, bill]
  E --> F
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
- **Request Approval** puts the RFQ up for approval; someone allowed to approve presses **Approve** to make it a purchase order. **Reset to draft** returns a sent or pending RFQ to draft for changes, without cancelling it.
- **Sync Receipts** brings the receipts and received quantities in line with the order's lines.
- **Lock** keeps a purchase order from being cancelled; **Unlock** lifts it. **Cancel** is only offered while the order is unlocked.

## Vendor bills

When a purchase order has quantities to bill, a **Create Vendor Bill** section appears. Fill in the accounts and date, then press **Create Bill**. Created bills are listed under **Vendor Bills**; receipts under **Receipts**.`,
  },
} as const
