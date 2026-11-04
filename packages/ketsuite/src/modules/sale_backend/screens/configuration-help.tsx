import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { HELP } from '../../product_backend/screens/help-words.ts'
const guide = {
  vi: {
    title: 'Cấu hình bán hàng',
    source: `Mở **Cài đặt → Cấu hình bán hàng**. **Bắt buộc sản phẩm** mặc định tắt và áp dụng trong công ty đang chọn. Người có quyền cấu hình bán hàng mới sửa được.

Khi tắt, dòng báo giá có thể chỉ có diễn giải, số lượng, đơn giá, chiết khấu và thuế. Dòng không tạo sản phẩm trong danh mục, không giao hàng và lập hóa đơn theo số lượng đặt; giá vốn bằng 0.

Khi bật, báo giá vẫn lưu được nhưng không xác nhận nếu có dòng chưa gắn sản phẩm. Lỗi chỉ rõ tên dòng. Quy tắc nằm ở lệnh xác nhận chung, kể cả khi một luồng khác gọi lệnh đó. Đơn đã xác nhận trước đó và hóa đơn lịch sử giữ nguyên.

**Cảnh báo khi bán** mặc định tắt. Bật để hiện lưu ý của khách và sản phẩm ngay khi chọn trên báo giá, kể cả dòng chưa lưu và quà tặng. Mỗi sản phẩm chỉ có một cảnh báo; khách hàng hiện trước. Đây là lưu ý, không chặn lưu hay xác nhận. Tắt chỉ ẩn cảnh báo, giữ lại nội dung đã lưu.

## Báo giá mới

- **Hiệu lực báo giá (ngày)**: từ 1 đến 365. Báo giá mới chưa có hạn thì hạn báo giá là ngày đặt cộng số ngày này. Để trống thì báo giá không có hạn.
- **Yêu cầu ký trực tuyến** và **Yêu cầu thanh toán trực tuyến**: báo giá mới tạo từ trang báo giá mà không chọn mẫu thì mang hai yêu cầu này. Khi bật thanh toán, nhập **Trả trước (%)**, lớn hơn 0 và tối đa 100.
- Các mục này chỉ áp cho báo giá tạo sau khi lưu. Báo giá tạo từ mẫu lấy hiệu lực, yêu cầu ký và thanh toán của mẫu.

## Đơn đã xác nhận

- **Khoá đơn khi xác nhận**: bật thì đơn bị khoá ngay khi xác nhận. Trưởng bán hàng bấm **Mở khoá** khi cần sửa.
- **Xuất hoá đơn hàng hoá theo**: số lượng đặt hoặc số lượng giao. Đây là mặc định cho hàng hoá chưa đặt chính sách riêng ở **Cấu hình → Chính sách xuất hoá đơn**; dịch vụ luôn theo số lượng đặt. Báo giá lấy chính sách đang áp dụng lúc xác nhận. Đơn đã xác nhận giữ chính sách của từng dòng; dòng thêm sau đó lấy chính sách lúc thêm.

Trưởng bán hàng và chủ doanh nghiệp sửa được; người bán, kế toán và kiểm toán nội bộ chỉ xem. Mỗi thẻ có nút **Lưu** riêng và chỉ lưu các mục trong thẻ đó. Nếu người khác đã đổi cấu hình, tải lại rồi nhập lại lựa chọn; không ghi đè phiên bản mới.`,
  },
  en: {
    title: 'Sales configuration',
    source: `Open **Settings → Sales configuration**. **Require a product** defaults to off and applies to the active company. Only users with Sales configuration permission may change it.

When off, a quotation line may contain only a description, quantity, price, discount and tax. It creates no catalogue product or delivery and invoices ordered quantities; its cost is zero.

When on, quotations can still be saved, but confirmation refuses lines without products and names the first affected line. The shared confirmation command enforces this for every caller. Previously confirmed orders and historical invoices remain unchanged.

**Sales warnings** defaults to off. Enable it to show customer and product notes as you select them on a quotation, including unsaved lines and gifts. Each product appears once, after the customer note. Notes never block saving or confirmation. Switching off hides notes without deleting their content.

## New quotations

- **Quotation validity (days)**: from 1 to 365. A new quotation without an expiry date expires that many days after its order date. Leave it empty and quotations do not expire.
- **Ask for an online signature** and **Ask for an online payment**: a quotation created on the quotation page without a template carries these requests. With payment on, enter the **Prepayment (%)**, above 0 and at most 100.
- These apply to quotations created after saving. A quotation created from a template takes the template's validity, signature and payment.

## Confirmed orders

- **Lock orders when confirmed**: when on, an order is locked as it is confirmed. A sales manager chooses **Unlock** to edit it.
- **Invoice goods by**: ordered or delivered quantities. This is the default for goods without their own policy under **Configuration → Invoicing policies**; services are always invoiced by ordered quantities. A quotation takes the policy in force when it is confirmed. A confirmed order keeps each line's policy; a line added later takes the policy in force when it is added.

Sales managers and business owners can change these settings; salespeople, accountants and internal auditors can only view them. Each card has its own **Save** and saves only that card's settings. If another user changed the configuration, reload and enter your choice again; do not overwrite the newer revision.`,
  },
}
export const SalesConfigurationHelp = ({ lang }: { lang: 'vi' | 'en' }) => {
  const words = HELP[lang],
    content = guide[lang]
  return (
    <HelpDrawer
      id="sale-configuration-help"
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
