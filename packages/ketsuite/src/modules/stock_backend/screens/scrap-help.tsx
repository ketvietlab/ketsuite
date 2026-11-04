import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Phiếu hủy hàng là gì
Phiếu hủy hàng ghi lại hàng phải bỏ đi: hư hỏng, hết hạn, không đạt kiểm nghiệm hoặc thất lạc. Mỗi phiếu có số theo kho (ví dụ **WH/HH/0001**), một mặt hàng, lô nếu mặt hàng theo lô, số lượng và lý do chọn trong danh mục.

## Lập và xác nhận
1. Bấm **Tạo mới**, chọn kho, mặt hàng, lô, số lượng và lý do rồi **Lưu**. Thủ kho, quản lý kho và chủ doanh nghiệp lập được phiếu nháp. Kho được chọn sẵn khi bạn chỉ được gán một kho (**Nhân viên kho** ở màn **Kho hàng**), hoặc khi bạn chưa được gán kho nào và công ty chỉ có một kho.
2. Quản lý kho hoặc chủ doanh nghiệp bấm **Xác nhận hủy**. Hàng rời kho ngay tới vị trí **Hàng hủy** của kho bằng một phiếu kho đã hoàn tất, tính theo giá vốn bình quân. Khi Kho ghi sổ, bút toán là Nợ 632 / Có 156.
3. Chỉ hủy được phần hàng chưa giữ cho phiếu khác. Kho không đủ thì phiếu vẫn là nháp và báo lỗi ở ô số lượng.

\`\`\`mermaid
flowchart TB
  N["Phiếu nháp"] --> Q("Xác nhận hủy?"):::kv-decision
  Q -->|"Đủ hàng chưa giữ"| D["Đã hủy: hàng tới Hàng hủy, Nợ 632 / Có 156"]:::kv-warning
  Q -->|"Không đủ"| N
  D -->|"Hoàn tác, có lý do"| R["Đã hoàn tác: hàng về kho theo giá lúc hủy"]:::kv-positive
\`\`\`

## Lập từ phiếu kho hoặc từ lô
- Trên một phiếu kho đã xác nhận hoặc đã hoàn tất, **Hủy hàng** mở phiếu hủy lấy hàng ở vị trí phiếu đó đang giữ và chỉ cho chọn mặt hàng của phiếu.
- Trên trang lô, **Hủy hàng** hủy ngay phần kho đang giữ của lô. Bỏ trống số lượng là hủy hết. Lô đã hết hạn gợi ý lý do **Hết hạn**, lô bị cách ly gợi ý **Không đạt kiểm nghiệm**. Lịch sử lô ghi lại số phiếu, số lượng và lý do.

## Cần bổ sung
Đánh dấu **Cần bổ sung** thì khi xác nhận, quy tắc bổ sung của mặt hàng ở kho đó đặt lại đúng số đã hủy, ví dụ một dòng trong yêu cầu báo giá gửi nhà cung cấp. Mặt hàng chưa có quy tắc ở kho thì không xác nhận được.

## Hoàn tác
Hủy nhầm thì quản lý kho hoặc chủ doanh nghiệp bấm **Hoàn tác** và nhập lý do. Hàng về lại đúng vị trí đã lấy, theo giá trị lúc hủy, kèm bút toán đảo Nợ 156 / Có 632. Phần đã đặt bổ sung vẫn giữ nguyên. Phiếu nháp bỏ đi thì bấm **Bỏ phiếu**.`,
  en: `## What a scrap order is
A scrap order records goods that must be thrown away: damaged, expired, failed testing or lost. Each order is numbered by its warehouse (for example **WH/HH/0001**) and names one product, its lot when the product is lot-tracked, a quantity and a reason from the list.

## Draft and validate
1. Select **Create**, choose the warehouse, product, lot, quantity and reason, then **Save**. Storekeepers, stock managers and the owner can draft orders. The warehouse is chosen for you when you are assigned to one warehouse only (**Warehouse staff** on the **Warehouses** screen), or when you are assigned to none and the company has one warehouse.
2. A stock manager or the owner selects **Validate**. The goods leave at once for the warehouse's **Scrap** location on a completed transfer at average cost. When stock posts to the books the entry is Dr 632 / Cr 156.
3. Only goods no other transfer has reserved can be scrapped. If the warehouse holds too few, the order stays a draft and the quantity field shows why.

\`\`\`mermaid
flowchart TB
  N["Draft"] --> Q("Validate?"):::kv-decision
  Q -->|"Enough unreserved goods"| D["Done: goods to Scrap, Dr 632 / Cr 156"]:::kv-warning
  Q -->|"Not enough"| N
  D -->|"Undo, with a reason"| R["Undone: goods return at the value they left at"]:::kv-positive
\`\`\`

## From a transfer or a lot
- On a confirmed or completed transfer, **Scrap** opens an order that takes goods from where that transfer holds them and offers only its products.
- On a lot's page, **Scrap** scraps what a warehouse holds of the lot at once. Leave the quantity empty to scrap all of it. An expired lot suggests **Expired**; a quarantined lot suggests **Failed quality test**. The lot history keeps the order number, quantity and reason.

## Replenish
Tick **Replenish** and validating asks the product's reorder rule in that warehouse to order the scrapped quantity again, for example as a line on a request for quotation to the supplier. A product with no rule in the warehouse cannot be validated this way.

## Undo
If goods were scrapped by mistake, a stock manager or the owner selects **Undo** and gives a reason. The goods return to where they left, at the value they left at, with the reverse entry Dr 156 / Cr 632. What the rule ordered stays ordered. To drop a draft, select **Cancel order**.`,
}

export function ScrapHelp({ lang }: { lang: 'vi' | 'en' }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id="stock-scrap-help"
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Phiếu hủy hàng' : 'Scrap orders'}
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
