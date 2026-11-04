import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'

const figures = {
  vi: `\`\`\`mermaid
flowchart TD
  A["Báo giá nháp hoặc đã gửi"]:::kv-warning --> B["Đơn đã xác nhận: Doanh số"]:::kv-positive
  B --> C["Hoá đơn đã ghi sổ: Đã xuất hoá đơn"]:::kv-positive
\`\`\``,
  en: `\`\`\`mermaid
flowchart TD
  A["Draft or sent quotation"]:::kv-warning --> B["Confirmed order: Sales"]:::kv-positive
  B --> C["Posted invoice: Invoiced"]:::kv-positive
\`\`\``,
}

export const salesReportHelp = {
  overview: {
    vi: {
      title: 'Tổng quan bán hàng',
      source: `Mở **Bán hàng → Tổng quan** để biết hôm nay cần làm gì và tháng đang bán ra sao. Bốn ô trên cùng đếm báo giá nháp, báo giá đã gửi, đơn bán và đơn cần xuất hoá đơn; bấm ô nào thì mở danh sách đã lọc sẵn.

## Số liệu của tháng

Chọn một tháng ở hàng tab. Mỗi số so với tháng liền trước (mũi tên xanh là tăng):

- **Doanh số**: tổng tiền chưa thuế của đơn bán đã xác nhận có ngày đặt trong tháng, theo lịch của công ty. Báo giá và đơn đã huỷ không tính. Bấm để mở các đơn đó.
- **Đã xuất hoá đơn**: hoá đơn khách hàng đã ghi sổ trong tháng từ đơn bán, trừ hoá đơn hoàn tiền; hoá đơn đã đảo không tính.
- **Lợi nhuận gộp**: doanh số trừ giá vốn từng dòng, chỉ hiện với người được xem giá vốn. Dòng chưa có giá vốn không cộng vào và được đếm riêng.

${figures.vi}

## Đội, người bán và việc cần làm

**Chỉ tiêu đội** so số đã xuất hoá đơn của đơn thuộc đội với chỉ tiêu tháng đặt ở **Cấu hình → Đội bán hàng**; đội chưa đặt chỉ tiêu không có thanh tiến độ. **Doanh số theo người bán** xếp từ cao xuống; bấm một người hoặc một đội để mở đơn của họ trong tháng. **Báo giá sắp hết hạn** là báo giá đã gửi hết hạn trong 7 ngày tới hoặc đã hết hạn mà chưa xác nhận; mở báo giá để gia hạn hoặc chốt với khách.

Bấm **Phân tích** để xem theo quý, năm hoặc theo khách hàng, sản phẩm.`,
    },
    en: {
      title: 'Sales overview',
      source: `Open **Sales → Overview** to see what needs doing today and how the month is selling. The four tiles at the top count draft quotations, sent quotations, sales orders and orders to invoice; choose a tile to open its list already filtered.

## The month's figures

Choose a month in the tabs. Each figure is compared with the month before (a green arrow is a rise):

- **Sales**: the untaxed total of confirmed sales orders dated in the month, in the company's calendar. Quotations and cancelled orders do not count. Choose it to open those orders.
- **Invoiced**: customer invoices posted in the month from sales orders, less refunds; reversed invoices do not count.
- **Gross profit**: sales less each line's cost, shown only to readers who may see costs. Lines with no cost yet add nothing and are counted apart.

${figures.en}

## Teams, salespeople and to-dos

**Team targets** compare what a team's orders invoiced with the monthly target set under **Configuration → Sales teams**; a team without a target has no progress bar. **Sales by salesperson** runs from highest to lowest; choose a person or a team to open their orders of the month. **Quotations about to expire** are sent quotations expiring in the next 7 days, or already expired without being confirmed; open one to extend it or close the deal.

Choose **Analysis** to look by quarter, by year, or by customer and product.`,
    },
  },
  analysis: {
    vi: {
      title: 'Phân tích bán hàng',
      source: `Mở **Bán hàng → Phân tích** để xem doanh số theo kỳ. Ba ô chọn cạnh tiêu đề đọc thành một câu, ví dụ "Năm 2026 · Doanh số · Theo tháng": ô đầu chọn kỳ (một năm hoặc một quý), ô giữa chọn số đo (doanh số, số đơn, lợi nhuận gộp nếu bạn được xem giá vốn), ô cuối chọn cách nhóm (theo tháng, người bán, đội, khách hàng, sản phẩm). Đổi một ô là trang cập nhật ngay. Địa chỉ trang giữ lựa chọn nên có thể lưu hoặc gửi cho đồng nghiệp.

## Đọc số liệu

Các ô trên cùng so kỳ đã chọn với kỳ liền trước cùng độ dài. Doanh số là tiền chưa thuế của đơn đã xác nhận có ngày đặt trong kỳ; khi nhóm theo sản phẩm, mỗi sản phẩm cộng tiền các dòng của nó và đếm các đơn có dòng đó, nên tổng các nhóm số đơn có thể lớn hơn tổng số đơn. **Tỷ trọng** là phần doanh số của nhóm trong kỳ.

${figures.vi}

## Mở đơn phía sau một con số

Bấm một hàng hoặc một thanh để mở **Đơn bán hàng** đã lọc theo kỳ và nhóm đó; bộ lọc hiện trên thanh tìm kiếm để bạn bỏ hoặc thêm điều kiện. Nhóm **Không có người bán** và **Không thuộc đội** mở các đơn chưa gán. Lợi nhuận của nhóm chỉ cộng các dòng đã có giá vốn; ô trên cùng cho biết bao nhiêu dòng còn thiếu.`,
    },
    en: {
      title: 'Sales analysis',
      source: `Open **Sales → Analysis** to see sales by period. The three choices beside the title read as one phrase, such as "2026 · Sales · By month": the first picks the period (a year or a quarter), the second the measure (sales, orders, gross profit if you may see costs), the last how to group (by month, salesperson, team, customer, product). Changing one updates the page at once. The page address keeps your choices, so you can bookmark it or send it to a colleague.

## Reading the figures

The tiles at the top compare the chosen period with the one of the same length before it. Sales are the untaxed amounts of confirmed orders dated in the period; grouped by product, each product adds up its lines and counts the orders with such a line, so the groups' orders can add up to more than the total. **Share** is the group's part of the period's sales.

${figures.en}

## Open the orders behind a figure

Choose a row or a bar to open **Sales Orders** filtered to that period and group; the filters show in the search bar so you can lift or add conditions. **No salesperson** and **No team** open the orders not assigned. A group's profit adds only the lines that have a cost; the tile at the top says how many are missing.`,
    },
  },
}

export function SalesReportHelp({
  lang,
  screen,
  id = `sale-report-${screen}-help`,
}: {
  lang: 'vi' | 'en'
  screen: 'overview' | 'analysis'
  id?: string
}) {
  const words = HELP[lang],
    guide = salesReportHelp[screen][lang]
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
