import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { HELP } from '../../product_backend/screens/help-words.ts'
const guide = {
  vi: {
    title: 'Mẫu bán hàng',
    source: `Mở **Cài đặt → Mẫu bán hàng** để quản lý mẫu báo giá và nhóm hàng mẫu. Quản lý kinh doanh hoặc người có quyền cấu hình mẫu được tạo, sửa và lưu trữ. Người bán chỉ chọn được mẫu đang hoạt động cho đội của mình; không chọn đội nghĩa là mọi đội.

**Mẫu báo giá** chứa sản phẩm, số lượng, đơn vị, nhóm hàng/ghi chú, sản phẩm tùy chọn, số ngày hiệu lực và điều khoản. Chọn mẫu khi tạo báo giá, hoặc dùng **Dùng báo giá mẫu** trên báo giá nháp/đã gửi. Thay dòng hiện có cần xác nhận. Giá tính theo bảng giá của đơn tại thời điểm áp dụng. Tùy chọn ký và trả trước được lưu làm yêu cầu; màn này không phát hành liên kết ký hoặc thu tiền.

**Nhóm hàng mẫu** là một nhóm dòng lưu lại để thêm vào báo giá khác. Nhóm chứa ít nhất một sản phẩm, có thể kèm ghi chú, không có giá, combo, dòng tự do, nhóm lồng nhau hoặc sản phẩm tùy chọn. Từ đơn chưa hủy, mở **Nhóm hàng mẫu → Lưu “tên nhóm” làm mẫu**. Mẫu thuộc người lưu. Trùng tên của chính bạn cần xác nhận ghi đè; mẫu đã lưu trữ được khôi phục cùng ID. Trùng tên của người khác vẫn là mẫu riêng.

**Thêm nhóm hàng mẫu** nối các dòng vào cuối đơn chưa khóa; giữ nguyên dòng cũ và tính giá mới. Đơn tối đa 100 dòng, kể cả nhóm hàng và ghi chú. Lưu thay đổi đang nhập trên đơn trước khi lưu hoặc thêm nhóm hàng mẫu.

Để sửa mẫu, mở bản ghi, sửa dòng rồi **Lưu**. Nhóm hàng mẫu không có nút thêm nhóm con. Bấm **Lưu trữ** và xác nhận để ngừng dùng; bấm **Khôi phục** để dùng lại. Lưu nháp đang sửa trước khi đổi trạng thái. Không xóa lịch sử. Nếu có thông báo bản ghi đã thay đổi, tải lại và nhập lại phần cần giữ; không ghi đè bản mới.`,
  },
  en: {
    title: 'Sales templates',
    source: `Open **Settings → Sales templates** to manage quotation and section templates. Sales managers and users with template configuration permission may create, edit and archive them. Sellers can choose active templates for their teams; no assigned teams means every team.

**Quotation templates** contain products, quantities, units, sections/notes, optional products, validity days and terms. Choose one when creating a quotation, or use **Apply quotation template** on a draft/sent quotation. Replacing existing lines asks for confirmation. Prices use the order pricelist when applied. Signature and prepayment preferences are stored requirements; this screen does not issue signing or payment links.

**Section templates** require at least one product and may include notes, but no prices, combos, free lines, nested sections or optional products. On a non-cancelled order, open **Section templates → Save “section name” as template**. The saver owns the template. Reusing your own name asks before overwrite and restores the same archived template. Another person's matching name remains a separate template.

**Add section from template** appends to an unlocked order, preserving old lines and calculating new prices. Orders allow at most 100 rows including sections and notes. Save pending order changes before either section operation.

Open a template, edit its lines and choose **Save**. Section templates have no nested-section action. Choose **Archive** and confirm to stop using a template; choose **Restore** to use it again. Save pending edits before changing status. History remains. If the record changed, reload before entering your edits again.`,
  },
}
export const TemplateHelp = ({ lang }: { lang: 'vi' | 'en' }) => {
  const words = HELP[lang],
    content = guide[lang]
  return (
    <HelpDrawer
      id="sale-template-help"
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
