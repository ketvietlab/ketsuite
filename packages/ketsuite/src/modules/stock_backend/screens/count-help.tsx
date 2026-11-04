import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Phiên kiểm kê là gì
Một phiên kiểm kê đếm lại hàng ở vị trí kho chính của một kho: toàn kho, hoặc chỉ vài mặt hàng (kiểm kê một phần). Mỗi phiên có số theo kho (ví dụ **WH/KK/0001**). Cột **Phạm vi** của danh sách cho biết phiên đếm toàn kho hay bao nhiêu mặt hàng.

## Bắt đầu và đếm
1. Bấm **Bắt đầu kiểm kê**, chọn kho. Để trống **Mặt hàng cần đếm** thì phiên lấy mọi mặt hàng và lô kho đang giữ làm dòng; chọn vài mặt hàng thì phiên chỉ lấy các mặt hàng đó. Dòng xếp theo mã hàng rồi lô hết hạn sớm trước. Kho không giữ gì trong phạm vi đã chọn thì không bắt đầu được. Kho được chọn sẵn khi bạn chỉ được gán một kho (**Nhân viên kho** ở màn **Kho hàng**), hoặc khi bạn chưa được gán kho nào và công ty chỉ có một kho.
2. **Đếm kín** được bật sẵn: trong lúc đếm không ai thấy số trên sổ và chênh lệch, danh sách hiện "—" ở cột **Dòng lệch**. Tắt đếm kín thì người đếm thấy số trên sổ.
3. Gõ thẳng vào bảng dòng như bảng tính: ô **Số đếm** và **Lý do chênh lệch** của mỗi dòng (Enter hoặc gõ để sửa, Tab sang ô kế, dán được cả cột từ Excel). Không thấy hàng thì nhập 0. Ô chưa lưu tô vàng; bấm **Lưu số đếm** để ghi mọi dòng một lần. Mỗi số đếm ghi lại người đếm. Khi đếm không kín, cột **Chênh lệch** tự tính theo số vừa gõ.
4. Gặp hàng sổ không ghi ở kho này thì bấm **Thêm hàng tìm thấy**. Phiên một phần chỉ nhận mặt hàng trong phạm vi của nó. Mặt hàng theo lô phải chọn số lô đã có. Dòng thừa thì chọn dòng trong bảng, bấm **Xóa dòng** rồi **Lưu số đếm**. Một phiên có tối đa 200 dòng.
5. Đếm và lưu xong mọi dòng thì bấm **Gửi duyệt**; còn số chưa lưu thì nút này chờ. Từ lúc này ai cũng thấy số trên sổ và chênh lệch.

## Phẩm chất và biên bản
Nhập **Còn tốt / Kém phẩm chất / Mất phẩm chất** trong bảng dòng: các số không âm và tổng phải bằng **Số đếm**. Ô sai hiện lỗi; sửa rồi **Lưu số đếm**. Trong **Thông tin biên bản**, thêm họ tên, chức vụ, vai trò từng người vào bảng **Ban kiểm kê**, ghi **Ý kiến giải quyết**, rồi **Lưu thông tin biên bản** trước khi gửi duyệt. Sau khi duyệt, **In biên bản 05-VT** mở bản có số lượng; **In 05-VT có giá trị** chỉ dành cho người được xem giá trị kho. Số liệu cũ chưa có được để trống, không tính lại bằng giá hiện tại.

## Xử lý chênh lệch sau duyệt
Kế toán chọn ngày xử lý và cách xử lý từng dòng trong bảng: thiếu vào **632**, **811**, hoặc bồi thường **1388/334** kèm người; thừa vào **711**. Để trống dòng muốn xử lý sau. Các dòng bồi thường cùng lần dùng người đã chọn; khác người thì xử lý thành từng nhóm. Xác nhận để ghi sổ KHO; kỳ đã khóa bị từ chối. Phiên hiển thị chưa xử lý, một phần hoặc đã xử lý. Bộ lọc **Chờ xử lý chênh lệch** giúp tìm phiên còn lại; Đóng kỳ cảnh báo số dư 13811/33811 từ kiểm kê.

## Lý do chênh lệch
Chọn lý do cố định cho mỗi dòng lệch; ghi chú bổ sung là tùy chọn. Ghi chú cũ vẫn đọc được. Gửi duyệt kiểm tra lý do kể cả khi đếm kín. Điều chỉnh tồn kho cũng mở phiên một sản phẩm theo quy trình này.

## Duyệt, trả lại và hủy
- Quản lý kho hoặc chủ doanh nghiệp duyệt. Người đã đếm một dòng hay đã gửi duyệt thì không duyệt được phiên đó, nhưng vẫn trả lại được.
- **Duyệt** tạo ngay các phiếu đã hoàn tất với vị trí **Điều chỉnh tồn kho** của kho: phần thiếu đi bằng phiếu xuất, ghi Nợ 13811 / Có 156; phần thừa vào bằng phiếu nhập, ghi Nợ 156 / Có 33811; cả hai theo giá vốn bình quân.
- Tồn ở kho đổi so với lúc đếm (có phiếu kho hoàn tất giữa chừng) thì duyệt bị từ chối và nêu mặt hàng. Khi đó bấm **Trả lại đếm lại** và nhập lý do: dòng có tồn đổi lấy số mới và cần đếm lại, lô mới vào kho được thêm vào phiên.
- **Hủy phiên** cần lý do và không đổi tồn.

\`\`\`mermaid
flowchart TB
  S["Đang đếm"] -->|"Gửi duyệt, mọi dòng đã đếm"| R["Chờ duyệt"]:::kv-warning
  R --> Q("Tồn không đổi, người duyệt chưa đếm?"):::kv-decision
  Q -->|"Có"| D["Đã điều chỉnh: phiếu xuất/nhập, Nợ 13811 hoặc Có 33811"]:::kv-positive
  D --> P["Kế toán xử lý chênh lệch, ghi KHO"]:::kv-positive
  D --> I["In biên bản 05-VT"]
  Q -->|"Không, trả lại có lý do"| S
  R -->|"Hủy, có lý do"| C["Đã hủy"]:::kv-danger
\`\`\`

## Kiểm kê một phần và theo chu kỳ
- Một kho có thể có nhiều phiên một phần đang mở cùng lúc, miễn chúng không chung mặt hàng nào. Phiên toàn kho thì không mở song song với phiên nào khác của kho đó. Bắt đầu trùng thì bị từ chối và nêu phiên đang mở.
- Kho đặt **Tần suất kiểm kê** ở màn **Kho hàng** thì đến hạn kiểm kê toàn kho sau số ngày đó, tính từ ngày duyệt phiên toàn kho gần nhất. Màn **Tổng quan kho** báo kho đến hạn.
- Phiên một phần không dời hạn đó.

## Lịch sử lô
Dòng có lô được điều chỉnh thì lịch sử lô ghi **Điều chỉnh kiểm kê** cùng số phiên. Người xem được giá trị tồn thấy giá trị từng dòng và tổng thừa, thiếu sau khi duyệt.`,
  en: `## What a physical count is
A physical count recounts the goods in a warehouse's main stock location: all of them, or only a few products (a partial count). Each count is numbered per warehouse (for example **WH/KK/0001**). The list's **Scope** column tells a whole-warehouse count from a partial one and how many products it covers.

## Start and count
1. Select **Start a count** and choose the warehouse. Leave **Products to count** empty to take every product and lot the warehouse holds as lines; choose a few products to take only those. Lines run by product code and then soonest-expiring lot. A count cannot start when the warehouse holds nothing in its scope. The warehouse is chosen for you when you are assigned to one warehouse only (**Warehouse staff** on the **Warehouses** screen), or when you are assigned to none and the company has one warehouse.
2. **Blind count** is on by default: while counting nobody sees the book quantity or the differences, and the list shows "—" under **Differing lines**. Turn it off to let counters see the book.
3. Type straight into the lines table as in a spreadsheet: each line's **Counted** and **Reason for difference** cells (Enter or typing edits, Tab moves on, and a column pastes from a spreadsheet). Enter 0 where nothing was found. Unsaved cells are yellow; **Save counts** records every line at once. Each figure records who counted it. When the count is not blind, **Difference** follows what you type.
4. Goods the book does not hold in this warehouse go in with **Add found goods**. A partial count takes only products in its scope. A lot-tracked product needs an existing lot. To drop a line, select it in the table, choose **Remove rows**, then **Save counts**. A count has at most 200 lines.
5. When every line is counted and saved, select **Send for approval**; it waits while figures are unsaved. From then on everyone sees the book and the differences.

## Quality and minutes
Enter **Good condition / Poor condition / Unusable** in the lines grid: nonnegative quantities must total **Counted**. An invalid cell shows an error; correct it and **Save counts**. In **Minutes details**, add each committee member's full name, job title and role, enter the **Proposed resolution**, then **Save minutes details** before submitting. After approval, **Print form 05-VT** opens the quantity copy; **Print 05-VT with values** requires stock valuation access. Missing historical figures stay blank rather than using today's cost.

## Settle approved differences
Accounting selects a processing date and a method for each selected row: shortages use **632**, **811**, or compensation **1388/334** with a person; excesses use **711**. Leave rows blank to process later. Compensation rows in one batch use the selected person; process separate groups for different people. Confirm to post to KHO; locked periods refuse posting. The session shows pending, partial or settled. Filter **Awaiting difference settlement** for remaining counts; Period close warns about count-origin 13811/33811 balances.

## Difference reasons
Choose a fixed reason for every differing line; notes are optional. Legacy notes remain readable. Submit validates reasons even for blind counts. Inventory adjustment also opens a single-product count.

## Approve, return and cancel
- A stock manager or the owner approves. Whoever counted a line or sent the count for approval cannot approve it, but can still return it.
- **Approve** at once makes done transfers against the warehouse's **Inventory adjustment** location: shortages leave on an issue posted Dr 13811 / Cr 156, excesses come in on a receipt posted Dr 156 / Cr 33811, both at the average cost.
- If the warehouse's stock changed since counting (a transfer was done meanwhile), approval is refused and names the product. Then select **Return to recount** with a reason: lines whose stock changed take the new book and need counting again, and lots that came in meanwhile join the count.
- **Cancel count** needs a reason and changes no stock.

\`\`\`mermaid
flowchart TB
  S["Counting"] -->|"Send for approval, every line counted"| R["Waiting for approval"]:::kv-warning
  R --> Q("Stock unchanged, approver did not count?"):::kv-decision
  Q -->|"Yes"| D["Adjusted: issue/receipt, Dr 13811 or Cr 33811"]:::kv-positive
  D --> P["Accounting settles differences in KHO"]:::kv-positive
  D --> I["Print form 05-VT"]
  Q -->|"No, return with a reason"| S
  R -->|"Cancel with a reason"| C["Cancelled"]:::kv-danger
\`\`\`

## Partial and cycle counts
- A warehouse may have several partial counts open at once as long as they share no product. A whole-warehouse count runs alongside no other count of that warehouse. Starting an overlapping count is refused and names the open count.
- A warehouse with a **Count frequency** on **Warehouses** falls due for a whole-warehouse count that many days after its last whole-warehouse count was approved. **Inventory overview** reports the warehouses due.
- A partial count does not move that date.

## Lot history
A lot whose line was adjusted shows **Count adjustment** with the count number in its history. Viewers of stock value see each line's value and the total excess and shortage once approved.`,
}

/** K38: the physical counts guide, shared by the list and the count's modal. */
/** A list and the record modal it opens each mount a guide, so the list passes its own `id`. */
export function CountHelp({ lang, id = 'stock-count-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={id}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Kiểm kê' : 'Physical counts'}
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
