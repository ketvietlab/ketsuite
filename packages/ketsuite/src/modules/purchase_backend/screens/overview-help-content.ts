// The purchase overview guide (Help drawer) in Markdown, kept apart from ./overview-help.tsx, which
// draws it. It describes ./overview.tsx; change it with that screen.
export const purchaseOverviewHelp = {
  vi: {
    title: 'Tổng quan mua hàng',
    source: `Các hàng việc của bộ phận mua hàng trong công ty đang chọn. Bấm một ô số để mở danh sách tương ứng.

## Các ô số

- **Cần gửi**: yêu cầu báo giá (RFQ) còn nháp. **Đang chờ**: RFQ đã gửi nhà cung cấp. **Chờ duyệt**: đơn đang chờ phê duyệt.
- **Đơn mua hàng**: đơn đã xác nhận. **Chờ lập hoá đơn**: đơn đã nhận hàng mà chưa lập đủ hoá đơn.

## Đơn mua chờ phê duyệt

Mười đơn chờ duyệt đầu tiên. Bấm một dòng để mở đơn.

## Nhu cầu bổ sung từ kho

Yêu cầu báo giá mà quy tắc bổ sung của Kho (nguồn **Nhà cung cấp**) tạo ra và chưa xác nhận. Mỗi nhà cung cấp, kho và vị trí nhận có một yêu cầu nháp; các lần chạy sau thêm dòng vào đó, với giá trong bảng giá NCC.

- Mở yêu cầu, kiểm số lượng và giá, gửi cho nhà cung cấp (**Đánh dấu đã gửi**) rồi **Xác nhận đơn**. Đơn cần duyệt thì đi qua phê duyệt như mọi đơn khác.
- Xác nhận xong, đơn tạo phiếu nhập tới đúng vị trí của quy tắc và rời khỏi mục này.
- Khi còn ở đây, số lượng trong yêu cầu được tính vào **Đã đặt, chưa nhận** của quy tắc, nên kho không đặt trùng.

\`\`\`mermaid
flowchart TD
  rule("Quy tắc bổ sung<br>chạy") --> draft("Có RFQ nháp cùng<br>NCC và kho?"):::kv-decision
  draft -->|Có| line("Thêm dòng vào RFQ")
  draft -->|Không| fresh("Tạo RFQ mới")
  line --> buyer("Mua hàng kiểm giá,<br>gửi và xác nhận")
  fresh --> buyer
  buyer --> receipt("Phiếu nhập<br>tới kho"):::kv-positive
\`\`\``,
  },
  en: {
    title: 'Purchase overview',
    source: `The purchasing queues of the active company. Choose a figure to open its list.

## The figures

- **To Send**: requests for quotation (RFQs) still in draft. **Waiting**: RFQs sent to the vendor. **To Approve**: orders awaiting approval.
- **Purchase Orders**: confirmed orders. **Waiting Bills**: received orders not fully billed.

## Purchase orders awaiting approval

The first ten orders awaiting approval. Choose a line to open the order.

## Stock replenishment demands

Requests for quotation that Stock's reorder rules (with a **Supplier** source) drafted and nobody has confirmed yet. Each vendor, warehouse and receiving location has one draft request; later runs add lines to it, at the vendor price list's price.

- Open the request, check quantities and prices, send it to the vendor (**Mark as Sent**), then **Confirm Order**. An order that needs approval goes through it like any other.
- Once confirmed, the order drafts a receipt to the rule's location and leaves this list.
- While it is here, its quantity counts as the rule's **Already on order**, so Stock does not order it twice.

\`\`\`mermaid
flowchart TD
  rule("Reorder rule<br>runs") --> draft("Draft RFQ for the<br>vendor and warehouse?"):::kv-decision
  draft -->|Yes| line("Add a line to it")
  draft -->|No| fresh("Draft a new RFQ")
  line --> buyer("Purchasing checks,<br>sends and confirms")
  fresh --> buyer
  buyer --> receipt("Receipt to<br>the warehouse"):::kv-positive
\`\`\``,
  },
}
