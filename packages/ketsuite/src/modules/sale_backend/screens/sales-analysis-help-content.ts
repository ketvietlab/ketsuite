// The guide (Help drawer) in Markdown, kept apart from ./sales-analysis-help.tsx, which draws it.
export const salesAnalysisHelp = {
  vi: {
    title: 'Phân tích bán hàng',
    source: `Màn hình này cho biết một sản phẩm đã bán được bao nhiêu trong 30 ngày gần đây, mỗi biến thể một dòng. Mở nó từ thẻ **Đã bán 30 ngày** trên trang sản phẩm.

\`\`\`mermaid
flowchart TD
  A[Thẻ Đã bán 30 ngày<br>trên trang sản phẩm] --> B[Phân tích:<br>mỗi biến thể một dòng]
  B --> C[Đơn có<br>biến thể đó]
  C --> D[Mở đơn]
  class B kv-positive
\`\`\`

## Đọc số liệu

- Chỉ tính đơn bán đã xác nhận có ngày đặt trong kỳ. Báo giá và đơn đã huỷ không được tính.
- **Đã bán** quy về đơn vị tính của sản phẩm, kể cả khi dòng đơn bán theo đơn vị khác. **Số đơn** đếm mỗi đơn một lần dù đơn có nhiều dòng của biến thể đó.
- **Doanh thu chưa thuế** chỉ hiện với người được xem giá vốn và giá bán; người khác vẫn thấy số lượng và số đơn.
- Biến thể chưa bán được trong kỳ không có dòng.

## Từ biến thể tới đơn

Bấm một dòng để mở danh sách **Đơn bán hàng** chỉ với các đơn có dòng của biến thể đó. **Về trang sản phẩm** quay lại trang bạn vừa mở.`,
  },
  en: {
    title: 'Sales analysis',
    source: `This screen shows how much of one product sold in the last 30 days, one row per variant. Open it from the **Sold in 30 days** card on the product's page.

\`\`\`mermaid
flowchart TD
  A[Sold in 30 days<br>on the product page] --> B[Analysis:<br>a row per variant]
  B --> C[Orders with<br>that variant]
  C --> D[Open an order]
  class B kv-positive
\`\`\`

## Reading the figures

- Only confirmed sales orders dated in the period count. Quotations and cancelled orders do not.
- **Sold** is in the product's own unit of measure, even when a line sold in another unit. **Orders** counts each order once, however many lines it has for the variant.
- **Untaxed revenue** is shown only to readers who may see costs and prices; anyone else still sees quantities and order counts.
- A variant that did not sell in the period has no row.

## From a variant to its orders

Select a row to open **Sales orders** with only the orders that have a line for that variant. **Back to the product** returns to the page you came from.`,
  },
} as const
