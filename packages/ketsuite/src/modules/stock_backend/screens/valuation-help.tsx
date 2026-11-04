import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Giá trị tồn kho là gì
Mỗi dòng là một mặt hàng công ty đang giữ trong kho: tồn thực tế, đơn vị, **giá vốn bình quân** và **giá trị tồn**. Công ty có một giá bình quân cho mỗi mặt hàng trên mọi kho (bình quân gia quyền tức thời).

## Giá trị thay đổi khi nào
- Phiếu nhập từ nhà cung cấp hoặc xưởng cộng giá trị theo **đơn giá nhập** của dòng phiếu; đơn mua cho giá theo giá đã chiết khấu. Dòng không có đơn giá lấy giá bình quân lúc hoàn tất. Sau mỗi phiếu vào kho (nhập, khách trả hàng, kiểm kê thừa), giá bình quân mới trở thành giá vốn của sản phẩm; dòng đơn bán mới lấy giá này.
- Phiếu xuất lấy phần giá trị tương ứng với số xuất. Lần xuất hết lấy toàn bộ giá trị còn lại, nên không còn số lẻ.
- Kiểm kê thừa hoặc thiếu tính theo giá bình quân. Chuyển giữa các kho không đổi giá trị.
- Hàng tồn từ trước khi có định giá mở theo giá vốn danh mục.

\`\`\`mermaid
flowchart TB
  R["Phiếu nhập: + số lượng × đơn giá nhập"]:::kv-positive --> V["Giá trị tồn ÷ số lượng = giá bình quân"]
  V --> D["Phiếu xuất: giá trị × số xuất ÷ số tồn"]:::kv-warning
\`\`\`

## Lọc và cộng
Tìm theo mã hoặc tên; bấm tiêu đề cột để sắp xếp. **Cộng theo bộ lọc** cộng giá trị mọi dòng khớp bộ lọc, không chỉ trang đang xem. Không chọn kho thì tổng bằng số dư tài khoản hàng hoá (156) khi Kho ghi sổ. Chọn một kho thì số lượng là tồn của kho đó và giá trị là phần tương ứng theo giá bình quân của công ty.

## Ai xem được
Chủ doanh nghiệp, quản lý kho, kế toán và kiểm toán nội bộ. Thủ kho và người bán không thấy giá trị hay đơn giá.`,
  en: `## What stock value shows
One row per product the company holds: quantity on hand, unit, **average cost** and **stock value**. The company keeps one average cost per product across every warehouse (perpetual weighted average).

## When the value changes
- A supplier or production receipt adds value at the line's **unit cost**; a purchase order supplies its discounted price. A line without a unit cost takes the average when the receipt completes. After anything comes in (a receipt, a customer return, a count surplus) the new average becomes the product's cost, which new sales lines take.
- A delivery takes the share of value for the quantity it ships. Shipping the last units takes all that is left, so no remainder stays behind.
- Count surpluses and shortages are valued at the average. Transfers between warehouses do not change value.
- Stock held before valuation began opens at the catalogue cost.

\`\`\`mermaid
flowchart TB
  R["Receipt: + quantity × unit cost"]:::kv-positive --> V["Stock value ÷ quantity = average cost"]
  V --> D["Delivery: value × shipped ÷ on hand"]:::kv-warning
\`\`\`

## Filter and total
Search by code or name; select a column heading to sort. **Filtered total** adds the value of every row the filter keeps, not only this page. With no warehouse chosen it equals the goods account (156) once stock posts to the books. Choosing a warehouse shows that warehouse's quantity and its share of value at the company average.

## Who can see it
The owner, stock managers, accountants and internal auditors. Storekeepers and sales staff see neither values nor unit costs.`,
}

export function ValuationHelp({ lang }: { lang: 'vi' | 'en' }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id="stock-valuation-help"
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Giá trị tồn kho' : 'Stock value'}
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
