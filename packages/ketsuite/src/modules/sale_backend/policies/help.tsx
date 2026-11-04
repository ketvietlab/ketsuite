import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
export const salePolicyHelp = {
  vi: {
    title: 'Chính sách xuất hoá đơn',
    source: `Mở **Cấu hình → Chính sách xuất hoá đơn** (bánh răng trên rail) để xem các sản phẩm đang bán của công ty và mỗi sản phẩm xuất hoá đơn theo số lượng đặt hay số lượng giao. Cột **Thiết lập** cho biết điều gì quyết định: **Cấu hình chung** (theo ô "Xuất hoá đơn hàng hoá theo" ở Cấu hình bán hàng), **Đặt riêng** hoặc **Dịch vụ**. Tìm theo mã, tên hoặc nhóm, có hoặc không dấu; lọc theo thiết lập; sắp xếp theo mã. Sản phẩm ngừng bán và combo không có ở đây: combo xuất hoá đơn theo các món đã chọn.

## Đặt cho một sản phẩm

Trưởng bán hàng, chủ doanh nghiệp và kế toán bấm một hàng hoá, chọn **Xuất hoá đơn theo** rồi bấm **Lưu thay đổi**:

- **Theo cấu hình chung**: bỏ chính sách riêng, sản phẩm theo cấu hình bán hàng (trong ngoặc là cấu hình hiện tại).
- **Số lượng đặt**: xuất hoá đơn được ngay khi đơn đã xác nhận.
- **Số lượng giao**: chỉ xuất hoá đơn phần đã giao.

Dịch vụ luôn xuất hoá đơn theo số lượng đặt nên không có ô chọn. Người bán chỉ xem.

## Khi nào chính sách có hiệu lực

\`\`\`mermaid
flowchart TD
  A["Đổi chính sách hoặc cấu hình chung"] --> Q("Đơn đã xác nhận?"):::kv-decision
  Q -->|Chưa| B["Theo chính sách mới khi xác nhận"]:::kv-positive
  Q -->|Rồi| C["Mỗi dòng giữ cách xuất cũ; dòng thêm sau theo chính sách mới"]:::kv-warning
\`\`\`

Báo giá xác nhận sau khi lưu và dòng thêm vào đơn sau khi lưu lấy chính sách mới. Dòng của đơn đã xác nhận giữ cách xuất hoá đơn của nó. Nếu người khác vừa sửa sản phẩm, mở lại rồi thử lại.`,
  },
  en: {
    title: 'Invoicing policies',
    source: `Open **Configuration → Invoicing policies** (the gear on the rail) to see the company's products on sale and whether each is invoiced by ordered or delivered quantities. The **Set by** column says what decides: **Sales settings** (the "Invoice goods by" field of the sales settings), an **Own policy** or being a **Service**. Search by code, name or category with or without accents, filter by setting, or sort by code. Products no longer sold and combos are not listed: a combo is invoiced by its chosen items.

## Set one product

Sales managers, business owners and accountants choose a goods product, pick **Invoice by** and choose **Save changes**:

- **Sales settings**: drops the product's own policy so it follows the sales settings (the current one is in brackets).
- **Ordered quantities**: invoice as soon as the order is confirmed.
- **Delivered quantities**: invoice only what has been delivered.

A service is always invoiced by ordered quantities, so it has no field. Salespeople only view.

## When a policy applies

\`\`\`mermaid
flowchart TD
  A["Change a policy or the sales settings"] --> Q("Order confirmed?"):::kv-decision
  Q -->|No| B["Takes the new policy when confirmed"]:::kv-positive
  Q -->|Yes| C["Each line keeps its policy; lines added later take the new one"]:::kv-warning
\`\`\`

Quotations confirmed and lines added to orders after saving take the new policy. Lines of confirmed orders keep how they are invoiced. If someone else just changed the product, open it again and retry.`,
  },
}
export function SalePolicyHelp({ lang, id = 'sale-policy-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = salePolicyHelp[lang]
  return (
    <HelpDrawer
      id={id}
      label={words.label}
      title={guide.title}
      closeLabel={words.close}
      body={
        <MarkdownContent
          source={guide.source}
          lexer={marked.lexer}
          headingOffset={1}
          labels={{
            diagram: words.diagram,
            table: words.table,
            source: words.source,
            loading: words.loading,
            error: words.error,
          }}
        />
      }
    />
  )
}
