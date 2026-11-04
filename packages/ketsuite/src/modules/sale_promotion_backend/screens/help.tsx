import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { HELP } from '../../product_backend/screens/help-words.ts'
const guide = {
  vi: {
    title: 'Chương trình khuyến mãi',
    source: `Mở **Cài đặt → Khuyến mãi** để xem, tìm và lọc chương trình. Quản lý kinh doanh và quản trị công ty được tạo, sửa, lưu trữ và phát phiếu; người bán, kế toán và kiểm toán chỉ xem cấu hình.

Mỗi dòng cho biết **Mã** (mã giảm giá, nếu có), **Phần thưởng** tóm tắt mức giảm hoặc quà, **Áp dụng đến** là ngày kết thúc (— là không hạn) và **Đã dùng**: số lần thưởng đã vào đơn đã xác nhận; có giới hạn lượt thì hiện dạng đã dùng/giới hạn, phiếu ưu đãi hiện đã dùng/số phiếu đã phát. **Xuất CSV** tải mọi chương trình khớp ô tìm và bộ lọc đang chọn, với đúng các cột này.

Chọn **Tạo chương trình**, nhập tên và chọn một trong sáu loại. Khi mở một chương trình, thẻ đầu trang tóm tắt **Phần thưởng** và **Đã dùng** như trên danh sách; nhãn dưới tên là loại chương trình, kèm **Đã lưu trữ** nếu chương trình đã lưu trữ. Các trường điều kiện, tích điểm và phần thưởng thay đổi theo lựa chọn. Tên không được trùng, kể cả chương trình đã lưu trữ. Chương trình đã có thẻ không đổi được loại.

**Điều kiện** gồm ngày của báo giá, bảng giá, số lượng và giá trị tối thiểu. Có thể chọn nhiều sản phẩm, nhóm hoặc thẻ; nhóm bao gồm nhóm con. Không chọn giới hạn sản phẩm nghĩa là áp dụng mọi sản phẩm. Combo tính số lượng một lần tại dòng cha. **Số lượt tối đa** chỉ có ở khuyến mãi, mã giảm giá và mua X tặng Y; để trống nghĩa là không giới hạn.

**Phần thưởng** có thể giảm theo phần trăm hoặc số tiền chưa thuế, cho cả đơn, một đơn vị rẻ nhất hoặc sản phẩm chỉ định. Mức giảm không vượt giá trị đủ điều kiện. Quà tặng giữ giá danh mục, giảm 100% và đi theo luồng giao hàng thông thường; không chọn combo làm quà. Mua X tặng Y tính số lần mua tròn theo số lượng điều kiện.

**Thẻ tích điểm** tích điểm theo giá trị sau ưu đãi đã gồm thuế, theo đơn hoặc theo đơn vị. Theo giá trị chỉ tính số bước tròn. Điểm vừa tích trong đơn không được dùng để đổi thưởng ngay trên chính đơn đó.

Với **Phiếu ưu đãi**, lưu chương trình rồi chọn **Tạo phiếu ưu đãi**, nhập 1–100 phiếu, khách hàng và ngày hết hạn nếu cần. Bỏ trống khách hàng nghĩa là không giới hạn người dùng. Lưu nháp chương trình trước khi mở thao tác này. Chọn **Xem thẻ** để tìm mã, khách hàng, số dư và trạng thái; danh sách có phân trang.

\`\`\`mermaid
flowchart LR
  A[Tạo chương trình] --> B[Lưu điều kiện và thưởng]
  B --> C[Tạo phiếu hoặc tích điểm]
  C --> D[Xem thẻ và trạng thái]
  B --> E[Lưu trữ hoặc khôi phục]
\`\`\`

**Lưu trữ** cần xác nhận và giữ lịch sử. **Khôi phục** cho phép dùng chương trình trở lại. Nếu bản ghi đã thay đổi, tải lại trước khi sửa tiếp; không ghi đè bản mới. Hủy đơn hoàn lại lượt dùng, điểm/thẻ đã đổi và đảo điểm đã tích; phiếu đơn sau chưa dùng được hủy theo đơn nguồn.`,
  },
  en: {
    title: 'Promotion programs',
    source: `Open **Settings → Promotions** to browse, search and filter programs. Sales managers and company administrators may create, edit, archive and issue coupons. Sellers, accountants and auditors can inspect configuration.

Each row shows the **Code** (for promotion codes), a one-line **Reward**, **Valid until** (the end date; — means no end) and **Used**: how many confirmed sales took the reward. With a usage limit it reads used/limit; coupon programs read used/coupons issued. **Export CSV** downloads every program matching the current search and filters, with these columns.

Choose **Create program**, enter a name and select one of six types. An open program starts with a card summarising its **Reward** and **Used** count, as the list does; the badge under its name gives its type, with **Archived** when it is archived. Conditions, earning and reward fields follow your choices. Names must be unique, including archived programs. A program with cards cannot change type.

**Conditions** use the quotation date, pricelist, minimum quantity and amount. Select multiple products, categories or tags; categories include descendants. No product restrictions means all products. A combo counts once at its parent. **Maximum uses** applies to promotions, promotion codes and buy-X-get-Y; leave it blank for unlimited use.

**Rewards** reduce an untaxed amount by percentage or a fixed amount, across the order, one cheapest unit or specified products. The discount cannot exceed eligible merchandise. Gifts retain list price with a 100% discount and follow normal delivery; a combo cannot be a gift. Buy-X-get-Y uses the whole number of qualifying purchases.

**Loyalty card** earns from the final tax-inclusive value after benefits, per order or per unit. Value-based earning counts whole steps. Points earned by the current order cannot fund redemption on that same order.

For **Coupons**, save the program, choose **Generate coupons** and enter 1–100 coupons, an optional customer and an optional expiry date. No customer restriction allows any customer to use the coupon. Save pending program changes first. **View cards** opens a paged list of codes, customers, balances and statuses.

\`\`\`mermaid
flowchart LR
  A[Create program] --> B[Save conditions and reward]
  B --> C[Issue coupons or earn points]
  C --> D[Inspect cards and statuses]
  B --> E[Archive or restore]
\`\`\`

**Archive** asks for confirmation and retains history. **Restore** enables the program again. If a record changed, reload before editing; do not overwrite the newer version. Cancelling a sale frees its usage, restores redeemed points/cards and reverses earning; unused next-order coupons are cancelled with their source sale.`,
  },
}
export const PromotionHelp = ({ lang }: { lang: 'vi' | 'en' }) => {
  const words = HELP[lang],
    content = guide[lang]
  return (
    <HelpDrawer
      id="sale-promotion-help"
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
