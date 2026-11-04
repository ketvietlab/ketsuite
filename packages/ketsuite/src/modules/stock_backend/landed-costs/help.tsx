import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Chi phí mua kho là gì
Phí vận chuyển, bốc xếp, bảo hiểm hay thuế nhập khẩu của một lô hàng đã nhập làm giá vốn của hàng đó cao hơn giá mua. Phiếu chi phí mua kho (số \`CPMT/YYYY/NNNN\`) cộng các khoản này vào hàng của một hay nhiều phiếu nhập đã hoàn tất, và ghi khoản phải trả cho nhà cung cấp dịch vụ.

## Danh sách
Mỗi dòng có **Số phiếu**, **Ngày**, **Nhà cung cấp**, **Phiếu nhập**, **Tổng chi phí** và **Tình trạng**, mới nhất trước. Tìm theo số phiếu, nhà cung cấp hoặc phiếu nhập; lọc theo tình trạng. Cuối bảng là tổng chi phí của các phiếu đang hiện, không tính phiếu đã bỏ.

## Lập phiếu
1. Chọn **Tạo mới**, hoặc mở một phiếu nhập đã hoàn tất rồi chọn **Thêm chi phí mua kho** để phiếu mới có sẵn phiếu nhập đó.
2. Chọn **Nhà cung cấp** của dịch vụ, **Ngày** (không sau hôm nay) và một hay nhiều **Phiếu nhập**. Chỉ phiếu nhập đã hoàn tất và có giá trị mới chọn được; phiếu khách trả hàng thì không.
3. Thêm tối đa 20 khoản trong lưới **Khoản chi phí**: tên, cách chia và số tiền lớn hơn 0.
4. Chọn **Lưu**. Phiếu ở trạng thái Nháp và còn sửa được.

| Cách chia | Mỗi dòng hàng nhận |
|---|---|
| Theo số lượng | Theo số lượng dòng đó đã nhập |
| Theo giá trị | Theo giá trị dòng đó lúc nhập |
| Chia đều | Phần bằng nhau |

Số tiền làm tròn theo tiền tệ của công ty; dòng cuối nhận phần lẻ để tổng khớp đúng khoản chi phí.

## Ghi sổ
Chọn **Ghi sổ** (kế toán, chủ doanh nghiệp). Nếu đang sửa phiếu, thao tác này lưu rồi ghi sổ luôn. Phần của mỗi dòng hàng chia tiếp theo hàng còn tồn và hàng đã xuất, tính theo nhập trước xuất trước:

\`\`\`mermaid
flowchart TD
  A["Khoản chi phí"] --> B["Chia cho từng dòng hàng của phiếu nhập"]
  B --> Q("Hàng của dòng còn tồn?"):::kv-decision
  Q -- "Còn tồn" --> S["Nợ 156: giá vốn bình quân tăng"]:::kv-positive
  Q -- "Đã xuất" --> C["Nợ 632: giá vốn hàng bán"]:::kv-warning
\`\`\`

Cả phiếu ghi Có 331 cho nhà cung cấp trong một bút toán sổ kho, hạch toán vào ngày phiếu được ghi sổ. Bảng **Phân bổ** cho thấy từng phiếu nhập, mặt hàng, khoản, số tiền, phần vào tồn kho và phần vào giá vốn. Thanh bên có ngày hạch toán và bút toán.

## Bỏ phiếu
Phiếu nháp không dùng nữa thì chọn **Bỏ phiếu** và ghi lý do. Phiếu đã ghi sổ không bỏ được; muốn đảo thì lập bút toán đảo bên Kế toán.

## Quyền
Quản lý kho lập, sửa và bỏ phiếu nháp nhưng không ghi sổ. Kế toán và chủ doanh nghiệp làm được cả ba và ghi sổ. Kiểm toán nội bộ chỉ xem. Vai trò không xem được giá trị tồn kho, như thủ kho, thấy màn khóa.`,
  en: `## What a landed cost is
Freight, handling, insurance or import duty on goods already received make those goods cost more than their purchase price. A landed cost (numbered \`CPMT/YYYY/NNNN\`) adds these costs to the goods of one or more completed receipts, and records what is owed to the service vendor.

## The list
Each row shows **Number**, **Date**, **Vendor**, **Receipts**, **Total** and **Status**, newest first. Search by number, vendor or receipt; filter by status. Below the table is the total of the costs shown, cancelled ones aside.

## Create a landed cost
1. Select **Create**, or open a completed receipt and select **Add landed cost** so the new cost starts on that receipt.
2. Choose the service **Vendor**, the **Date** (not after today) and one or more **Receipts**. Only completed receipts that carry a value can be chosen, not customer returns.
3. Add up to 20 costs in the **Costs** grid: a name, how it spreads and an amount above 0.
4. Select **Save**. The cost stays a draft and can still be edited.

| Split | Each product line receives |
|---|---|
| By quantity | In proportion to the quantity it received |
| By value | In proportion to its value when received |
| Equal | An equal share |

Amounts round to the company currency; the last line takes the remainder, so the shares add up to the cost exactly.

## Post
Select **Post** (accountant, owner). While you are editing, this saves and posts in one step. Each line's share then splits between goods still held and goods already delivered, first in, first out:

\`\`\`mermaid
flowchart TD
  A["A cost"] --> B["Spread over the receipts' product lines"]
  B --> Q("Is the line's stock still held?"):::kv-decision
  Q -- "Held" --> S["Dr 156: average cost rises"]:::kv-positive
  Q -- "Delivered" --> C["Dr 632: cost of goods sold"]:::kv-warning
\`\`\`

The whole cost is credited to 331 for the vendor in one stock-journal entry dated the day it is posted. The **Allocation** table shows each receipt, product, cost, amount, the part added to stock and the part added to cost of sales. The rail shows when it was posted and its entry.

## Cancel
To drop a draft you will not post, select **Cancel cost** and give a reason. A posted cost cannot be cancelled; reverse its entry in Accounting instead.

## Permissions
A stock manager creates, edits and cancels draft costs but does not post them. An accountant and the owner do all of that and post them. An internal auditor only views them. A role that cannot see stock value, such as a warehouse operator, sees a locked page.`,
}

export function LandedCostHelp({ lang, id = 'stock-landed-cost-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={id}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Chi phí mua kho' : 'Landed costs'}
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
