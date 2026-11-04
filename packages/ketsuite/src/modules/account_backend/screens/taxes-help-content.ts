// The guide (Help drawer) of the taxes list and the tax form, in Markdown, kept apart from
// ./help.tsx, which draws it. It describes ./taxes-list.tsx, ./tax-form.tsx and the
// account module's `saveTax`, invoice and posting checks; change it with them.
export const taxesHelp = {
  vi: {
    title: 'Thuế',
    source: `## Màn này dùng để làm gì

Danh sách các mã thuế của công ty dùng trên dòng hoá đơn bán, hoá đơn mua và bút toán. Mỗi mã cho biết dùng cho bán ra hay mua vào, cách tính (phần trăm, số tiền cố định, chia), mức thuế và tài khoản ghi sổ phần thuế.

## Tạo hoặc sửa một mã thuế

1. Bấm **Tạo mới**, hoặc bấm vào một dòng để sửa.
2. Điền tên, chọn **Phạm vi sử dụng** và **Cách tính thuế**, rồi nhập **Số tiền / tỷ lệ**.
3. Chọn tài khoản ghi sổ phần thuế (ví dụ 33311 cho GTGT đầu ra, 1331 cho GTGT được khấu trừ). Khi công ty đã định nhánh tài khoản cho thuế bán ra và mua vào, tài khoản ngoài nhánh đó bị từ chối kèm tên nhánh được phép. Theo TT99: bán ra dưới 3331, 3332, 3333, 3338; mua vào dưới 1331, 1332, 3333 (thuế nhập khẩu).
4. Nếu mức thuế chỉ áp dụng trong một khoảng thời gian, điền **Hiệu lực từ ngày** và/hoặc **Hiệu lực đến ngày**.
5. Bấm **Tạo mới** (mã mới) hoặc **Lưu thay đổi** (mã đang sửa).

## Hiệu lực theo ngày

Cột **Hiệu lực** cho biết mã thuế dùng được cho chứng từ có ngày nào. Hai đầu đều tính cả ngày đó. Để trống là không giới hạn.

\`\`\`mermaid
flowchart TB
  A["Ghi sổ chứng từ"] --> Q{"Hoá đơn giảm hoặc bút toán đảo?"}
  Q -->|Có| K["Giữ thuế của kỳ gốc"]:::kv-positive
  Q -->|Không| D{"Ngày chứng từ trong hiệu lực?"}
  D -->|Có| P["Ghi sổ"]:::kv-positive
  D -->|Không| R["Từ chối, chọn mức thuế khác"]:::kv-danger
  class Q,D kv-decision
\`\`\`

- Khi tạo hoá đơn và khi ghi sổ, hệ thống so **ngày chứng từ** với khoảng hiệu lực của từng thuế trên các dòng. Ngoài khoảng đó thì báo *"Thuế … không còn hoặc chưa có hiệu lực vào ngày …"*.
- Hoá đơn giảm (trả hàng, giảm giá) và bút toán đảo vẫn giữ mức thuế cũ sau ngày hết hiệu lực, vì chúng điều chỉnh một chứng từ của kỳ trước.
- Ví dụ: mức **GTGT 8%** theo Nghị quyết 204/2025/QH15 có hiệu lực từ 01/07/2025 đến 31/12/2026. Từ 01/01/2027, hoá đơn mới phải dùng 10%. Nếu thời hạn giảm thuế được gia hạn, chỉ cần sửa **Hiệu lực đến ngày**.

## Lưu trữ khác hết hiệu lực

- **Lưu trữ** (bỏ chọn **Đang sử dụng**): ẩn mã thuế khỏi mọi lựa chọn. Dùng khi công ty không còn dùng mã đó nữa.
- **Hết hiệu lực**: mã vẫn hiện trong danh sách, chứng từ của kỳ cũ vẫn điều chỉnh được, chỉ có chứng từ mới sau ngày cuối là bị chặn.
`,
  },
  en: {
    title: 'Taxes',
    source: `## What this screen is for

The company's taxes, used on customer invoice, vendor bill and journal entry lines. Each tax says whether it applies to sales or purchases, how it is computed (percent, fixed amount, division), its rate and the account its amount posts to.

## Create or edit a tax

1. Click **Create**, or click a row to edit it.
2. Enter a name, choose **Tax use** and **Tax computation**, then enter **Amount / rate**.
3. Choose the account the tax posts to (for example 33311 for output VAT, 1331 for deductible VAT). When the company has set the branches of its chart for sale and purchase taxes, an account outside them is refused with the branches allowed. Under TT99: sales under 3331, 3332, 3333, 3338; purchases under 1331, 1332, 3333 (import duty).
4. If the rate applies only for a while, fill in **In effect from** and/or **In effect until**.
5. Click **Create** (a new tax) or **Save changes** (a tax being edited).

## Dates in effect

The **In effect** column shows which document dates the tax applies to. Both ends are inclusive; empty means no limit.

\`\`\`mermaid
flowchart TB
  A["Post a document"] --> Q{"Refund or reversal?"}
  Q -->|Yes| K["Keep the original period's tax"]:::kv-positive
  Q -->|No| D{"Document date in effect?"}
  D -->|Yes| P["Post"]:::kv-positive
  D -->|No| R["Refused, choose another rate"]:::kv-danger
  class Q,D kv-decision
\`\`\`

- When an invoice is created and when it is posted, the **document date** is compared with the dates of every tax on its lines. Outside them the document is refused with *"Tax … is not in effect on …"*.
- Refunds (returns, discounts) and reversals keep the old rate after it ends, because they adjust a document of the earlier period.
- Example: the **8% VAT** of Resolution 204/2025/QH15 is in effect from 01/07/2025 to 31/12/2026. From 01/01/2027 new invoices use 10%. If the reduction is extended, only **In effect until** needs to change.

## Archived is not ended

- **Archived** (untick **In use**): the tax disappears from every choice. Use it when the company no longer uses the tax at all.
- **Ended**: the tax stays listed and earlier periods can still be adjusted with it; only new documents after its last day are refused.
`,
  },
} as const
