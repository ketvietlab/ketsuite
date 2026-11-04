import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Dự báo tồn kho
Mỗi dòng là một mặt hàng ở một kho đang giữ, sắp nhập, sắp xuất, đang đặt hoặc có quy tắc bổ sung. Dòng **Thiếu hàng** đứng đầu, ngày thiếu sớm nhất trước; rồi **Dưới tối thiểu**; rồi **Đủ hàng**. Tìm theo tên, mã hàng hoặc kho; lọc theo tình trạng; nhóm theo kho hoặc tình trạng.

## Cách tính
- **Dùng được** là tồn ở các vị trí của kho, trừ lô đã hết hạn hoặc đang cách ly. Phần đó hiện riêng là **Không dùng được** trong trang của mặt hàng.
- **Sắp nhập** và **Sắp xuất** là phiếu nhập, phiếu xuất và phiếu chuyển đã xác nhận, còn chưa hoàn tất. Mỗi phiếu tính theo ngày dự kiến; phiếu trễ hẹn tính từ hôm nay.
- **Dự báo** = Dùng được + Sắp nhập − Sắp xuất.
- **Thiếu từ** là ngày đầu tiên tồn sau một phiếu xuống dưới 0.
- **Đang đặt** là phiếu nhập hoặc phiếu chuyển nháp tới kho. Hàng này chưa vào dự báo, tới khi kho xác nhận phiếu.
- **Dưới tối thiểu**: kho có quy tắc bổ sung cho mặt hàng và dự báo thấp hơn mức tối thiểu.

\`\`\`mermaid
flowchart TB
  A["Dùng được"] --> B["Cộng, trừ phiếu đã xác nhận theo ngày"]
  B --> Q("Có ngày tồn dưới 0?"):::kv-decision
  Q -->|"Có"| S["Thiếu hàng từ ngày đó"]:::kv-danger
  Q -->|"Không"| M["So với tối thiểu của quy tắc"]:::kv-positive
\`\`\`

## Trang của một mặt hàng
Bấm một dòng để mở dự báo của mặt hàng ở kho đó: ngày thiếu và phiếu gây thiếu, từng phiếu sắp tới với tồn sau phiếu và nhãn **Trễ hẹn**, các phiếu nháp chưa tính. Cột bên phải ghi các tổng và quy tắc bổ sung, nếu bạn có quyền xem quy tắc. Bấm số phiếu để mở phiếu.

## Quyền
Ai xem được tồn kho thì xem được dự báo. Bán hàng và kế toán thấy phiếu nhưng không thấy quy tắc bổ sung. Muốn đặt hàng, mở **Bổ sung hàng**.`,
  en: `## Stock forecast
Each row is a product in a warehouse that holds it, expects it, sends it, has it on order or keeps a replenishment rule for it. **Short** rows come first, soonest shortage first; then **Below minimum**; then **Enough**. Search by name, product code or warehouse; filter by status; group by warehouse or status.

## How it is worked out
- **Usable** is the stock in the warehouse's locations, less expired or quarantined lots. That part shows as **Not usable** on the product's page.
- **Incoming** and **Outgoing** are confirmed receipts, deliveries and transfers not yet done. Each counts on its scheduled day; an overdue one counts from today.
- **Forecast** = Usable + Incoming − Outgoing.
- **Short from** is the first day the stock after an operation falls below 0.
- **On order** is draft receipts or transfers into the warehouse. They stay out of the forecast until the warehouse confirms them.
- **Below minimum**: the warehouse keeps a replenishment rule for the product and the forecast is under its minimum.

\`\`\`mermaid
flowchart TB
  A["Usable"] --> B["Add and take confirmed operations by day"]
  B --> Q("Stock below 0 on a day?"):::kv-decision
  Q -->|"Yes"| S["Short from that day"]:::kv-danger
  Q -->|"No"| M["Compare with the rule's minimum"]:::kv-positive
\`\`\`

## A product's page
Select a row to open the product's forecast in that warehouse: the day it runs short and the operation that causes it, each coming operation with the stock left after it and an **Overdue** label, and the drafts not yet counted. The side column shows the totals and the replenishment rule, if you may read rules. Select an operation number to open it.

## Access
Whoever reads the stock reads the forecast. Sales and accounting see operations but not replenishment rules. To order goods, open **Replenishment**.`,
}

export function ForecastHelp({ lang }: { lang: 'vi' | 'en' }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id="stock-forecast-help"
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Dự báo tồn kho' : 'Stock forecast'}
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
