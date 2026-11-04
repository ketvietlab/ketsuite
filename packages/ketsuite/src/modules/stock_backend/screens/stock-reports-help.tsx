import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import type { StockReport } from '../reports/shared.ts'

const fifoVi = `\`\`\`mermaid
flowchart TB
  I["Phiếu nhập hoặc chuyển đến: thêm một lớp mới"]:::kv-positive --> L["Các lớp của vị trí, cũ nhất trước"]
  L --> O["Phiếu xuất hoặc chuyển đi: lấy từ lớp cũ nhất"]:::kv-warning
  O --> R["Phần còn lại của các lớp = tồn của vị trí"]
\`\`\``
const fifoEn = `\`\`\`mermaid
flowchart TB
  I["Receipt or transfer in: adds a new layer"]:::kv-positive --> L["The location's layers, oldest first"]
  L --> O["Delivery or transfer out: takes from the oldest layer"]:::kv-warning
  O --> R["What the layers leave = what the location holds"]
\`\`\``

const guides: Record<StockReport, Record<'vi' | 'en', string>> = {
  analysis: {
    vi: `## Phân tích dịch chuyển là gì
Mỗi dòng là một dòng của một phiếu kho, ở mọi trạng thái: nháp, đang chờ, đã giữ hàng, hoàn tất và đã hủy. Bấm một dòng để mở phiếu.

## Các cột
- **Ngày**: ngày hoàn tất; phiếu chưa xong thì là ngày dự kiến. Ngày tính theo múi giờ của công ty.
- **Nhu cầu** là số phiếu yêu cầu. **Đã làm** là số đã dịch chuyển, chỉ có khi phiếu hoàn tất.
- **Giá trị** lấy từ sổ giá trị tồn: hàng vào kho là số dương, hàng ra là số âm. Chuyển giữa các vị trí trong công ty không đổi giá trị nên để trống.
- **Còn lại** chỉ có ở dòng đưa hàng vào một vị trí của công ty: số hàng của dòng đó vẫn còn ở vị trí ấy. **Giá trị còn lại** = giá trị × còn lại ÷ đã làm, tức là theo đúng giá lúc nhập.

## Còn lại được tính thế nào
Kho đọc theo nhập trước, xuất trước, riêng cho từng vị trí và từng mặt hàng. Hàng xuất đi lấy từ lớp cũ nhất. Cùng một thời điểm thì tính hàng vào trước hàng ra. Tồn có từ trước phiếu đầu tiên được ghi là lớp cũ nhất.

${fifoVi}

Giá vốn của công ty vẫn là bình quân gia quyền. Còn lại chỉ cho biết lô hàng nào của phiếu nào đang nằm trong kho.

## Lọc, nhóm và cộng
- Tìm theo số phiếu, mã hoặc tên mặt hàng. Chọn kho ở menu **Kho**: phiếu chuyển giữa hai kho thuộc cả hai kho.
- Bộ lọc có sẵn: **Hoàn tất**, **Chưa hoàn tất**, **Đã hủy**, **Còn hàng trong kho**. Lọc theo kỳ bằng điều kiện trên cột **Ngày**.
- Nhóm theo ngày (tháng, tuần, ngày), mặt hàng, loại dịch chuyển hoặc trạng thái.
- Chân trang cộng **Giá trị** và **Giá trị còn lại** của mọi dòng khớp bộ lọc, không chỉ trang đang xem.

## Ai xem được
Chủ doanh nghiệp, quản lý kho, kế toán và kiểm toán nội bộ, tức những ai xem được Giá trị tồn kho. Vai trò khác thấy màn bị khoá.`,
    en: `## What the moves analysis shows
Each row is one line of one transfer, in any status: draft, waiting, reserved, done and cancelled. Select a row to open its transfer.

## The columns
- **Date**: the day the transfer was done, or its scheduled day while it is open. Days follow the company's time zone.
- **Demand** is what the transfer asks for. **Done** is what moved, shown once the transfer is done.
- **Value** comes from the stock valuation ledger: goods coming in are positive, goods going out negative. Moving goods between the company's own locations does not change value, so it stays blank.
- **Remaining** appears only on lines that brought goods into a company location: how much of that line is still there. **Remaining value** = value × remaining ÷ done, at the price the goods came in at.

## How remaining is worked out
Stock is read first in, first out, for each location and product separately. Goods leaving take the oldest layer first. At the same moment, what came in counts before what left. Stock held before the first recorded transfer is the oldest layer.

${fifoEn}

The company's cost stays the weighted average. Remaining only tells which receipt's goods are still in stock.

## Filter, group and total
- Search by transfer number, product code or name. Choose a warehouse in the **Warehouse** menu: a transfer between two warehouses belongs to both.
- Built-in filters: **Done**, **Not done**, **Cancelled**, **Still in stock**. Filter a period with a condition on **Date**.
- Group by date (month, week, day), product, move type or status.
- The footer totals **Value** and **Remaining value** over every row the filter keeps, not only this page.

## Who can see it
The owner, stock managers, accountants and internal auditors: whoever can read stock value. Other roles see a locked screen.`,
  },
  aging: {
    vi: `## Tuổi tồn kho là gì
Mỗi dòng là một mặt hàng trong một kho: tồn hiện tại chia theo số ngày từ lúc hàng vào kho đến hôm nay: **≤ 30 ngày**, **31–60 ngày**, **61–90 ngày** và **> 90 ngày**.

## Tuổi được tính thế nào
Tuổi đọc theo nhập trước, xuất trước cho từng vị trí: hàng xuất đi lấy từ lớp cũ nhất, phần còn lại giữ ngày nó vào vị trí. Hàng chuyển sang vị trí khác mang ngày chuyển đến. Tồn có từ trước phiếu đầu tiên lấy ngày nhập ghi trên dòng tồn.

${fifoVi}

**Nhập sớm nhất** là ngày vào kho của phần cũ nhất còn lại. Ngày tính theo múi giờ của công ty.

## Giá trị
Giá trị tính theo giá vốn bình quân của công ty, như màn **Giá trị tồn kho**. Không chọn kho thì cộng giá trị bằng tổng của màn Giá trị tồn kho. Chọn một kho thì giá trị là phần của kho đó.

## Lọc và nhóm
- Tìm theo mã, tên mặt hàng hoặc tên kho. Chọn kho ở menu **Kho**.
- Bộ lọc **Có hàng trên 90 ngày** giữ những dòng cần xử lý trước.
- Nhóm theo kho hoặc mặt hàng.

## Ai xem được
Chủ doanh nghiệp, quản lý kho, kế toán và kiểm toán nội bộ. Vai trò khác thấy màn bị khoá.`,
    en: `## What stock aging shows
Each row is one product in one warehouse: what is on hand now, split by days since the goods came in: **≤ 30 days**, **31–60 days**, **61–90 days** and **> 90 days**.

## How age is worked out
Age is read first in, first out for each location: goods leaving take the oldest layer first, and what stays keeps the day it came into the location. Goods moved to another location take the day they arrived there. Stock held before the first recorded transfer takes the in-date on its stock line.

${fifoEn}

**Oldest in** is the day the oldest remaining goods came in. Days follow the company's time zone.

## Value
Value is at the company's average cost, as on **Stock value**. With no warehouse chosen, the total equals the Stock value total. Choosing a warehouse shows that warehouse's share.

## Filter and group
- Search by product code, name or warehouse. Choose a warehouse in the **Warehouse** menu.
- The **Held over 90 days** filter keeps the rows to deal with first.
- Group by warehouse or product.

## Who can see it
The owner, stock managers, accountants and internal auditors. Other roles see a locked screen.`,
  },
  history: {
    vi: `## Lịch sử dịch chuyển là gì
Mỗi dòng là hàng đã thực sự dịch chuyển trên một phiếu đã hoàn tất: nhập, xuất, chuyển kho, phiếu trả, điều chỉnh kiểm kê và hủy hàng. Hàng có lô thì mỗi lô một dòng. Phiếu chưa xong và phiếu đã hủy không ở đây. Bấm một dòng để mở phiếu.

## Các cột
- **Ngày hoàn tất** tính theo múi giờ của công ty; mới nhất ở trên.
- **Từ** và **Đến** ghi mã kho trước tên vị trí, như \`WH/Tồn kho\`, để phân biệt hai kho.
- **Số lượng** theo đơn vị của dòng. **Loại** cho biết đó là nhập, xuất, chuyển kho, trả, điều chỉnh kiểm kê, hủy hàng hay hoàn tác hủy.

## Lọc theo kỳ, kho và loại
- Mở từ menu, màn chỉ hiện **Tháng này**. Đổi sang **Tháng trước**, bỏ bộ lọc để xem mọi kỳ, hoặc đặt điều kiện trên cột **Ngày hoàn tất** cho một kỳ khác.
- Chọn kho ở menu **Kho**: phiếu chuyển giữa hai kho thuộc cả hai kho.
- Bộ lọc theo loại giữ một hay vài loại dịch chuyển. Tìm theo chứng từ, mã hàng, tên hàng hoặc lô.
- Nhóm theo ngày (tháng, tuần, ngày), mặt hàng hoặc loại.

## Khớp với tồn kho
Màn đọc lại từ các phiếu mỗi lần mở, không lưu riêng. Tồn đầu kỳ của một vị trí cộng hàng đến và trừ hàng đi trong kỳ ra đúng tồn của vị trí đó.

## Ai xem được
Những ai xem được **Tồn kho**. Màn chỉ để đọc và không có giá trị; giá trị dịch chuyển ở **Phân tích dịch chuyển**.`,
    en: `## What the moves history shows
Each row is goods that actually moved on a finished transfer: receipts, deliveries, internal transfers, returns, count adjustments and scraps. A product tracked by lot has one row a lot. Open and cancelled transfers are not here. Select a row to open its transfer.

## The columns
- **Done on** follows the company's time zone; the newest is on top.
- **From** and **To** give the warehouse code before the location name, as \`WH/Stock\`, to tell two warehouses apart.
- **Quantity** is in the line's unit. **Type** says whether it was a receipt, delivery, internal transfer, return, count adjustment, scrap or undone scrap.

## Filter by period, warehouse and type
- Opened from the menu, the screen shows **This month** only. Switch to **Last month**, remove the filter to see every period, or set a condition on **Done on** for another period.
- Choose a warehouse in the **Warehouse** menu: a transfer between two warehouses belongs to both.
- The type filters keep one or several kinds of move. Search by document, product code, name or lot.
- Group by date (month, week, day), product or type.

## Matching stock on hand
The screen is read from the transfers each time it opens, never stored apart. A location's opening stock plus what came in less what left over the period equals what it holds.

## Who can see it
Whoever may see **On hand**. The screen is read only and carries no value; move values are on **Moves analysis**.`,
  },
}

const TITLES: Record<StockReport, Record<'vi' | 'en', string>> = {
  analysis: { vi: 'Phân tích dịch chuyển', en: 'Moves analysis' },
  aging: { vi: 'Tuổi tồn kho', en: 'Stock aging' },
  history: { vi: 'Lịch sử dịch chuyển', en: 'Moves history' },
}

export function StockReportHelp({ report, lang }: { report: StockReport; lang: 'vi' | 'en' }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={`stock-${report}-help`}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={TITLES[report][lang]}
      closeLabel={vi ? 'Đóng' : 'Close'}
      body={
        <MarkdownContent
          source={guides[report][lang]}
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
