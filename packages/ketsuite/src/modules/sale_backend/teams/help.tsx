import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
export const saleTeamHelp = {
  vi: {
    title: 'Đội bán hàng',
    source: `Mở **Cấu hình → Đội bán hàng** (bánh răng trên rail) để xem các đội của công ty: tên, trưởng đội, số thành viên và chỉ tiêu xuất hoá đơn mỗi tháng. Tìm theo tên đội hoặc tên trưởng đội, có hoặc không dấu; lọc theo trạng thái; sắp xếp theo tên hoặc chỉ tiêu.

## Tạo và sửa đội

Trưởng bán hàng và chủ doanh nghiệp bấm **Tạo đội**, nhập tên (tối đa 60 ký tự, không trùng với đội khác của công ty kể cả đội đã lưu trữ, không phân biệt hoa thường), chọn **Trưởng đội**, chọn **Thành viên** (có thể để trống) và nhập **Chỉ tiêu tháng** (số tiền nguyên; để trống là 0) rồi bấm **Tạo đội**. Trưởng đội và thành viên là người dùng đang hoạt động của công ty. Bấm một dòng để mở đội. Người bán và kế toán chỉ xem.

Mỗi người bán thuộc tối đa một đội đang dùng. Chọn một người đang ở đội khác thì không lưu được: bỏ họ khỏi đội kia trước.

## Người bán và đội trên đơn

Báo giá mới lấy **người bán phụ trách** của khách (màn Khách hàng); khách chưa có thì lấy người tạo. Đội theo đội của người bán. Ô **Người bán** và **Đội bán hàng** khi tạo báo giá cho phép chọn khác.

Trên trang báo giá hoặc đơn bán, bấm **Sửa người bán** trong thẻ **Thông tin đơn hàng**. Đổi người bán thì đơn theo đội của người đó, trừ khi bạn chọn đội khác; xoá ô đội để đơn không thuộc đội nào. Sửa được cả khi đơn đã xác nhận và không đổi phiên bản đơn, vì đây không phải điều khoản bán hàng. Ở danh sách báo giá và đơn bán, gõ tên đội vào ô tìm kiếm để thấy các đơn thuộc đội đó.

## Lưu trữ và khôi phục

Lưu trữ đội thì thành viên được vào đội khác; báo giá, đơn đang thuộc đội vẫn giữ đội, nhưng đội không còn trong lựa chọn. Khôi phục chỉ được khi không thành viên nào đã vào một đội khác đang dùng. Nếu người khác vừa sửa đội, tải lại rồi thử lại.`,
  },
  en: {
    title: 'Sales teams',
    source: `Open **Configuration → Sales teams** (the gear on the rail) to see the company's teams: name, leader, number of members and monthly invoicing target. Search by team or leader name with or without accents, filter by status, or sort by name or target.

## Create and edit

Sales managers and business owners choose **Create team**, enter a name (at most 60 characters, unique among the company's teams including archived ones, regardless of case), choose the **Leader**, choose the **Members** (may be empty) and enter the **Monthly target** (a whole amount; empty is 0), then choose **Create team**. Leaders and members are active users of the company. Choose a row to open a team. Salespeople and accountants only view teams.

A salesperson is in at most one team in use. Choosing someone who sells in another team cannot be saved: take them out of that team first.

## Salesperson and team on an order

A new quotation takes the customer's **salesperson** (Customers screen), or the person creating it when the customer has none, and that salesperson's team. The **Salesperson** and **Sales team** fields of the create form let you choose others.

On a quotation or sales order page, choose **Edit salesperson** in the **Order information** card. A new salesperson brings their team unless you choose another; clear the team to leave the order in none. This works on confirmed orders too and does not change the order's version, since these are not sales terms. In the quotation and sales order lists, type a team's name in the search box to find its orders.

## Archive and restore

Archiving a team frees its members to join another; quotations and orders in it keep it, but it is no longer offered. A team can be restored only while none of its members sells in another team in use. If someone else just changed the team, reload and try again.`,
  },
}
export function SaleTeamHelp({ lang, id = 'sale-team-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = saleTeamHelp[lang]
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
