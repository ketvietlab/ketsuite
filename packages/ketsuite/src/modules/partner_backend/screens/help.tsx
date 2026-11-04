import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { HELP } from '../../product_backend/screens/help-words.ts'
const guide = {
  vi: {
    title: 'Hồ sơ đối tác',
    source: `Hồ sơ giữ tên, vai trò khách hàng/nhà cung cấp, thông tin liên hệ và địa chỉ. Sửa thông tin rồi bấm **Lưu thông tin** ở đầu trang. Địa chỉ và điều khoản công ty có nút lưu riêng.

## Cảnh báo khi bán

Khi công ty bật **Cấu hình bán hàng → Cảnh báo khi bán**, hồ sơ hiện khung **Cảnh báo khi bán** với lời nhắc tối đa 300 ký tự. Người có quyền sửa cảnh báo bấm **Sửa cảnh báo**, nhập nội dung trong hộp thoại rồi bấm **Lưu**; cảnh báo lưu riêng, không cần **Lưu thông tin**. Người chỉ đọc không có nút sửa. Nếu người khác vừa sửa, tải lại và đối chiếu trước khi lưu lại.

Danh bạ liên hệ dùng chung, nhưng cảnh báo và điều khoản thuộc công ty đang chọn. Đổi công ty để đọc hoặc sửa đúng nội dung. Xoá nội dung rồi lưu để bỏ lời nhắc; tắt cấu hình chỉ ẩn, không xoá.

Trên báo giá, lời nhắc của khách xuất hiện trước lời nhắc của từng sản phẩm và quà tặng. Đây là thông tin hỗ trợ, không chặn giao dịch. Đơn huỷ không hiện lời nhắc.

\`\`\`mermaid
flowchart TD
  A[Chọn công ty] --> B[Bật cảnh báo bán hàng]
  B --> C[Lưu cảnh báo khách hoặc sản phẩm]
  C --> D[Chọn khách và sản phẩm trên báo giá]
  D --> E[Đọc lưu ý rồi tiếp tục giao dịch]
  class E kv-positive
\`\`\``,
  },
  en: {
    title: 'Partner profile',
    source: `The profile holds identity, customer/supplier roles, contact details and addresses. Edit identity and choose **Save** at the top. Addresses and company terms have their own save actions.

## Sales warnings

When the company enables **Sales configuration → Sales warnings**, this profile shows a **Sales warnings** card with a note of up to 300 characters. Authorized editors choose **Edit warning**, enter the note in the dialog and choose **Save**; the warning saves on its own, without **Save information**. Read-only viewers have no edit button. If another editor changed it, reload and compare before saving again.

The contact directory is shared, but warnings and terms belong to the active company. Switch company to read or edit its own content. Clear the text and save to remove a note; switching the setting off only hides it.

On quotations, the customer note precedes product and gift notes. Notes provide information without blocking transactions. Cancelled orders hide them.

\`\`\`mermaid
flowchart TD
  A[Choose company] --> B[Enable sales warnings]
  B --> C[Save customer or product note]
  C --> D[Select customer and products on quotation]
  D --> E[Read notes and continue]
  class E kv-positive
\`\`\``,
  },
}
export const PartnerHelp = ({ lang }: { lang: 'vi' | 'en' }) => {
  const words = HELP[lang],
    content = guide[lang]
  return (
    <HelpDrawer
      id="partner-profile-help"
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
