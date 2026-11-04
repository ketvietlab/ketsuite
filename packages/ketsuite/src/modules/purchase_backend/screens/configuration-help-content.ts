// The purchasing settings guide (Help drawer) in Markdown, kept apart from ./configuration-help.tsx,
// which draws it.
export const purchaseConfigurationHelp = {
  vi: {
    title: 'Cấu hình mua hàng',
    source: `Mở **Cài đặt → Cấu hình mua hàng**. Cấu hình áp dụng cho công ty đang chọn. Quản lý mua hàng sửa được; nhân viên mua hàng chỉ xem.

## Ngưỡng duyệt

- **Ngưỡng duyệt cấp 1**: đơn có tổng tiền (gồm thuế) từ mức này trở lên phải được **quản lý mua hàng** duyệt trước khi thành đơn mua.
- **Ngưỡng duyệt cấp cuối**: đơn từ mức này trở lên cần thêm **người duyệt cấp cuối**. Ngưỡng này cần ngưỡng cấp 1 và phải lớn hơn ngưỡng đó.
- Để trống cả hai thì không đơn nào phải duyệt: người mua bấm **Xác nhận** là thành đơn mua. Dưới ngưỡng, người mua vẫn bấm **Gửi duyệt** được nếu muốn quản lý xem trước.

\`\`\`mermaid
flowchart TD
  confirm("Người mua bấm Xác nhận") --> one("Tổng tiền từ<br>ngưỡng cấp 1?"):::kv-decision
  one -->|Không| order("Thành đơn mua"):::kv-positive
  one -->|Có| manager("Quản lý mua hàng duyệt")
  manager --> two("Tổng tiền từ<br>ngưỡng cấp cuối?"):::kv-decision
  two -->|Không| order
  two -->|Có| final("Người duyệt cấp cuối duyệt")
  final --> order
\`\`\`

## Đối chiếu hoá đơn nhà cung cấp

Khi ghi sổ một hoá đơn nhà cung cấp lập từ đơn mua, từng dòng được so với đơn mua:

- **Số lượng**: tổng đã lập hoá đơn (các hoá đơn đã ghi sổ trừ phiếu giảm, cộng hoá đơn này) không vượt số **đã nhận**, hoặc số **đã đặt** với hàng lập hoá đơn theo số đặt.
- **Đơn giá**: khi có **Dung sai giá (%)**, đơn giá sau chiết khấu không lệch quá mức đó so với đơn mua. Để trống thì không so đơn giá.

Hoá đơn lệch thì không ghi sổ được. Kế toán sửa số lượng hoặc giá, hoặc bấm **Tạm giữ hoá đơn** kèm lý do để trao đổi với nhà cung cấp. Ghi sổ hoá đơn thì tự bỏ tạm giữ. Hoá đơn tạo tay không gắn đơn mua và phiếu giảm thì không đối chiếu.

## Điều cần biết

- Người lập đơn không tự duyệt đơn của mình, ở cả hai cấp.
- Người duyệt cấp cuối có thể duyệt luôn cả cấp 1 còn chờ.
- Đơn đã gửi duyệt giữ số cấp lúc gửi. Đổi ngưỡng chỉ áp cho lần gửi sau; **Về nháp** xoá các lượt duyệt, gửi lại thì xét theo ngưỡng mới.
- Nếu người khác vừa đổi cấu hình, tải lại rồi nhập lại; không ghi đè bản mới hơn.`,
  },
  en: {
    title: 'Purchasing settings',
    source: `Open **Settings → Purchasing settings**. The settings apply to the active company. Purchasing managers can change them; purchasing operators can only view them.

## Approval thresholds

- **Level 1 approval threshold**: an order whose total (taxes included) reaches this amount needs a **purchasing manager**'s approval before it becomes a purchase order.
- **Final approval threshold**: an order reaching this amount also needs a **final approver**. It needs a level 1 threshold and must exceed it.
- Leave both empty and no order needs approval: a buyer's **Confirm** makes the purchase order. Below the thresholds a buyer can still choose **Request Approval** to have a manager look first.

\`\`\`mermaid
flowchart TD
  confirm("The buyer confirms") --> one("Total reaches the<br>level 1 threshold?"):::kv-decision
  one -->|No| order("Purchase order"):::kv-positive
  one -->|Yes| manager("A purchasing manager approves")
  manager --> two("Total reaches the<br>final threshold?"):::kv-decision
  two -->|No| order
  two -->|Yes| final("A final approver approves")
  final --> order
\`\`\`

## Vendor bill matching

When a vendor bill drafted from a purchase order is posted, each line is compared with the order:

- **Quantity**: everything billed (posted bills less credit notes, plus this bill) may not exceed what was **received**, or what was **ordered** for products billed on ordered quantities.
- **Unit price**: with a **Price tolerance (%)**, the price after discount may not differ from the order's by more than that. Leave it empty and prices are not compared.

A bill that does not match cannot be posted. Accounting corrects the quantity or price, or chooses **Hold Bill** with a reason while the vendor corrects it. Posting the bill releases the hold. Bills entered by hand without a purchase order, and credit notes, are not compared.

## Good to know

- Whoever drafted an order cannot approve it, at either level.
- A final approver can give a pending level 1 approval at the same time.
- An order sent for approval keeps the levels it was sent with. New thresholds apply to later submissions; **Reset to Draft** clears the approvals, and sending again uses the new thresholds.
- If someone else just changed the settings, reload and enter your change again; do not overwrite the newer version.`,
  },
}
