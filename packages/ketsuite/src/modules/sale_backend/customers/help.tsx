import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { HELP } from '../../product_backend/screens/help-words.ts'

const guide = {
  vi: {
    title: 'Khách hàng',
    source: `Mở **Bán hàng → Khách hàng** để xem những người và công ty mà công ty bạn bán cho. Danh sách có tên, loại, điện thoại, người bán phụ trách, điều khoản thanh toán, công nợ, hạn mức và số đơn đã xác nhận. Tìm theo tên, mã, điện thoại hoặc email; lọc **Khách của tôi** để xem khách bạn phụ trách, hoặc **Vượt hạn mức** để xem khách đang nợ quá hạn mức.

Nhà cung cấp chưa từng là khách không có trong danh sách. Liên hệ chưa có vai trò nào vẫn hiện ở đây và thành khách hàng khi bạn lưu hồ sơ của họ.

## Tạo và sửa khách hàng

Bấm **Tạo khách hàng**, nhập tên, loại, mã khách, mã số thuế, điện thoại, email; chọn **Người bán phụ trách** trong số người dùng của công ty và **Bảng giá** của khách, rồi bấm **Lưu**. Người bán, quản lý kinh doanh và chủ doanh nghiệp sửa được phần này. Thông tin liên hệ dùng chung cho cả công ty; người bán phụ trách và bảng giá là của riêng công ty đang chọn.

## Công nợ và hạn mức

Thẻ **Công nợ** cộng phần còn phải thu của hoá đơn đã ghi sổ (trừ tiền khách trả trước chưa cấn trừ) với phần chưa xuất hoá đơn của đơn đã xác nhận. Trên trang báo giá, công nợ tính thêm chính báo giá đó.

**Điều khoản thanh toán** và **Hạn mức công nợ** là kiểm soát tín dụng: chỉ quản lý kinh doanh, kế toán và chủ doanh nghiệp sửa, qua nút **Sửa hạn mức và điều khoản**. Để trống hạn mức nghĩa là không giới hạn; hạn mức 0 nghĩa là khách nào còn nợ cũng vượt.

\`\`\`mermaid
flowchart TD
  A["Công nợ của khách"] --> Q("Vượt hạn mức?"):::kv-decision
  Q -->|Có| W["Hồ sơ khách và trang đơn cảnh báo"]:::kv-warning
  Q -->|Không| N["Không cảnh báo"]:::kv-positive
  W --> C["Vẫn xác nhận được đơn"]
\`\`\`

Vượt hạn mức chỉ cảnh báo, không chặn xác nhận đơn. Hồ sơ khách còn liệt kê các đơn gần đây và hoá đơn còn phải thu.

Nếu báo hồ sơ đã thay đổi, tải lại trang rồi nhập lại phần cần sửa.`,
  },
  en: {
    title: 'Customers',
    source: `Open **Sales → Customers** to see the people and companies your company sells to. The list shows name, type, phone, salesperson, payment terms, credit used, credit limit and confirmed orders. Search by name, code, phone or email; filter **My customers** for the ones you look after, or **Over credit limit** for customers owing more than their limit.

A supplier you have never sold to is not listed. A contact with no role yet is listed and becomes a customer when you save their profile.

## Create and edit customers

Choose **New customer**, enter the name, type, customer code, tax ID, phone and email; choose a **Salesperson** among the company's users and the customer's **Pricelist**, then **Save**. Sellers, sales managers and owners can edit this part. Contact details are shared by every company; the salesperson and pricelist belong to the company you are working in.

## Credit and limits

The **Credit** card adds what is still due on posted invoices (less customer payments not yet applied) to the uninvoiced part of confirmed orders. On a quotation's page, credit used also counts that quotation.

**Payment terms** and **Credit limit** are credit control: only sales managers, accountants and owners edit them, with **Edit limit and terms**. An empty limit means no limit; a limit of 0 means any amount owed is over it.

\`\`\`mermaid
flowchart TD
  A["Customer's credit used"] --> Q("Over the limit?"):::kv-decision
  Q -->|Yes| W["Customer page and order page warn"]:::kv-warning
  Q -->|No| N["No warning"]:::kv-positive
  W --> C["The order can still be confirmed"]
\`\`\`

Going over the limit only warns; it never blocks confirming an order. The customer page also lists recent orders and invoices still due.

If the page says the customer changed, reload it and enter your edits again.`,
  },
}

export const CustomerHelp = ({ lang }: { lang: 'vi' | 'en' }) => {
  const words = HELP[lang],
    content = guide[lang]
  return (
    <HelpDrawer
      id="sale-customer-help"
      label={words.label}
      title={content.title}
      closeLabel={words.close}
      body={
        <MarkdownContent
          source={content.source}
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
