// The guide (Help drawer) in Markdown, kept apart from ./sales-orders-help.tsx, which draws it.
export const salesOrdersHelp = {
  vi: {
    title: 'Đơn bán hàng',
    source: `Màn hình này liệt kê các đơn bán đã xác nhận, mới nhất trước. Báo giá chưa xác nhận nằm ở màn **Báo giá**.

\`\`\`mermaid
flowchart TD
  A[Tìm theo số đơn<br>hoặc khách hàng] --> B[Lọc và nhóm]
  B --> C[Mở đơn]
  D[Phân tích bán hàng<br>của sản phẩm] --> E[Đơn có<br>một biến thể]
  E --> C
  class C kv-positive
\`\`\`

## Tìm, lọc và nhóm

- Ô tìm kiếm tìm theo số đơn, tên khách hàng, thẻ và tên đội.
- Bộ lọc nhanh chọn theo trạng thái lập hoá đơn (**Chờ lập hoá đơn** là hàng đợi cần xuất hoá đơn; mục **Cần xuất hoá đơn** trên thanh bên mở thẳng hàng đợi này) và theo đơn đã khoá hay đang mở. Có thể nhóm theo trạng thái, khách hàng hoặc ngày đặt (ngày, tuần, tháng).
- **Thêm bộ lọc** lọc theo người bán, đội bán hàng (chọn "chưa đặt" để thấy đơn không thuộc đội nào), khách hàng, sản phẩm (đơn có dòng của bất kỳ biến thể nào) hoặc ngày đặt. Các bộ lọc cộng dồn và được giữ trên địa chỉ trang, nên mở một số liệu từ tổng quan hay phân tích bán hàng sẽ ra đúng danh sách đã lọc.
- Bấm một dòng để mở đơn. Cột in mở bản in của đơn khi mẫu in đơn bán đã được bật.

## Đơn có một biến thể

Từ **Phân tích bán hàng** của một sản phẩm, mỗi biến thể mở danh sách này chỉ với các đơn có dòng của biến thể đó; thông báo ở đầu danh sách cho biết đang xem biến thể nào. Bấm **Xem mọi đơn** để bỏ giới hạn này.`,
  },
  en: {
    title: 'Sales orders',
    source: `This screen lists confirmed sales orders, newest first. Quotations not yet confirmed are on the **Quotations** screen.

\`\`\`mermaid
flowchart TD
  A[Search by order<br>or customer] --> B[Filter and group]
  B --> C[Open an order]
  D[A product's<br>sales analysis] --> E[Orders with<br>one variant]
  E --> C
  class C kv-positive
\`\`\`

## Search, filter and group

- Search matches the order number, the customer's name, tags and team names.
- Quick filters pick by invoice status (**To invoice** is the queue waiting for an invoice; the sidebar's **To invoice** entry opens it directly) and by locked or unlocked orders. Rows can be grouped by status, customer or order date (day, week, month).
- **Add filter** narrows by salesperson, sales team (choose "is not set" for orders outside every team), customer, product (orders with a line for any of its variants) or order date. Filters add up and stay in the page address, so a figure opened from the sales overview or analysis lands on the filtered list.
- Select a row to open the order. The print column opens the order's printout when the sales order document is enabled.

## Orders with one variant

From a product's **Sales analysis**, each variant opens this list with only the orders that have a line for it; the notice at the top names the variant. **Show every order** lifts that narrowing.`,
  },
} as const
