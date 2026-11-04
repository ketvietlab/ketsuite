// The guides (Help drawer) of the accounting screens, in Markdown, one per first path segment
// under /admin/accounting. ./help.tsx picks the guide for a route and draws it. Each guide
// describes the screens, functions and checks this module and the account module ship; change
// it with them. The taxes guide lives in ./taxes-help-content.ts.
import { taxesHelp } from './taxes-help-content.ts'

export type AccountingGuide = { readonly title: string; readonly source: string }
export type AccountingGuides = { readonly vi: AccountingGuide; readonly en: AccountingGuide }

const documentFlowVi = `\`\`\`mermaid
flowchart TB
  A["Tạo chứng từ nháp"] --> B["Kiểm tra dòng, thuế, tài khoản"]
  B --> Q{"Ghi sổ được?"}
  Q -->|Được| P["Đã ghi sổ, có số chứng từ"]:::kv-positive
  Q -->|Bị từ chối| R["Sửa theo thông báo rồi ghi sổ lại"]:::kv-warning
  P --> T["Ghi nhận thanh toán"]
  P --> V["Sai sót: đảo bút toán"]:::kv-danger
  class Q kv-decision
\`\`\``

const documentFlowEn = `\`\`\`mermaid
flowchart TB
  A["Create a draft"] --> B["Check lines, taxes, accounts"]
  B --> Q{"Can it post?"}
  Q -->|Yes| P["Posted, numbered"]:::kv-positive
  Q -->|Refused| R["Fix what the message says, post again"]:::kv-warning
  P --> T["Register a payment"]
  P --> V["Mistake: reverse it"]:::kv-danger
  class Q kv-decision
\`\`\``

const documentStatesVi = `## Trạng thái

- **Nháp**: chưa vào sổ, chưa có số chứng từ; còn thêm dòng, ghi sổ hoặc huỷ được.
- **Đã ghi sổ**: đã vào sổ cái, có số theo sổ nhật ký. Không sửa trực tiếp; muốn điều chỉnh thì **Đảo bút toán**.
- **Đã huỷ**: chứng từ nháp đã bỏ, không ảnh hưởng sổ.
- Cột **Thanh toán**: *Chưa thanh toán*, *Thanh toán một phần*, *Đã thanh toán* hoặc *Đã đảo*, tính từ phần còn lại trên tài khoản công nợ.

## Khi bị từ chối

- **Sổ đã khoá đến hết ngày …**: ngày chứng từ nằm trong kỳ đã khoá ở **Đóng kỳ**. Đổi ngày sang kỳ đang mở, hoặc nhờ người có quyền mở lại kỳ.
- **Thuế … không còn hoặc chưa có hiệu lực**: chọn mức thuế khác (xem hướng dẫn ở **Cấu hình → Kế toán → Thuế**).
- Chứng từ do module khác tạo (ví dụ từ phiếu kho) không có nút đảo ở đây; điều chỉnh từ chứng từ gốc của module đó.`

const documentStatesEn = `## States

- **Draft**: not in the books yet and not numbered; you can still add lines, post or cancel it.
- **Posted**: in the general ledger, numbered by its journal. It is not edited in place; to correct it, use **Reverse entry**.
- **Cancelled**: a draft that was dropped; the books are untouched.
- The **Payment** column reads *Not paid*, *Partially paid*, *Paid* or *Reversed*, from what is still open on the receivable or payable account.

## When it is refused

- **The books are locked through …**: the document date falls in a period locked under **Period closing**. Move the date into an open period, or ask someone allowed to reopen the period.
- **Tax … is not in effect on …**: pick another tax (see the guide under **Settings → Accounting → Taxes**).
- A document another module created (for example from a stock transfer) has no reverse button here; correct it from that module's own document.`

const invoiceGuide = (party: 'customer' | 'vendor'): AccountingGuides => {
  const customer = party === 'customer'
  return {
    vi: {
      title: customer ? 'Hoá đơn khách hàng' : 'Hoá đơn nhà cung cấp',
      source: `## Màn này dùng để làm gì

${
  customer
    ? 'Lập hoá đơn bán hàng, ghi sổ doanh thu và theo dõi công nợ phải thu của từng khách hàng.'
    : 'Ghi nhận hoá đơn mua hàng, ghi sổ chi phí và theo dõi công nợ phải trả cho từng nhà cung cấp.'
} Hoá đơn tạo từ đơn ${customer ? 'bán' : 'mua'} cũng hiện ở đây.

## Tạo hoá đơn

1. Bấm **Tạo mới**.
2. Chọn ${customer ? 'khách hàng' : 'nhà cung cấp'}, **Ngày hoá đơn** và **Điều khoản thanh toán** (quyết định ngày đến hạn). Không có điều khoản thì nhập **Hạn thanh toán**, không được trước ngày hoá đơn; bỏ trống thì hạn là chính ngày hoá đơn.
3. Nhập dòng đầu tiên: sản phẩm, số lượng, đơn giá, chiết khấu % và thuế (tối đa hai thuế).
4. **Tài khoản ${customer ? 'doanh thu' : 'chi phí'}** để trống thì lấy theo nhóm sản phẩm, rồi tới mặc định của công ty. **Tài khoản ${customer ? 'phải thu' : 'phải trả'}** để trống thì lấy theo đối tác, rồi tới mặc định của công ty (xem **Cấu hình → Kế toán → Tài khoản mặc định**).
5. Lưu. Hoá đơn mở ra ở trạng thái **Nháp**; thêm dòng nếu cần, rồi bấm **Ghi sổ**.

${documentFlowVi}

Ngày hoá đơn phải nằm trong hiệu lực của từng thuế trên dòng; hoá đơn điều chỉnh giảm của kỳ trước vẫn giữ mức thuế cũ. Ô **Thuế** chỉ liệt kê các mức còn hiệu lực ở **Ngày hoá đơn** (mặc định là hôm nay); đổi ngày thì thuế đã chọn được bỏ và cần chọn lại.

${documentStatesVi}

## Danh sách

Dùng ô tìm kiếm và bộ lọc ở đầu danh sách để thu hẹp. Bấm một dòng để mở chứng từ, xem dòng bút toán, phần còn lại và trao đổi ở cột bên.`,
    },
    en: {
      title: customer ? 'Customer invoices' : 'Vendor bills',
      source: `## What this screen is for

${
  customer
    ? 'Raise sales invoices, post revenue and follow what each customer still owes.'
    : 'Record purchase bills, post expenses and follow what you still owe each vendor.'
} Invoices created from ${customer ? 'sales' : 'purchase'} orders show up here too.

## Create an invoice

1. Click **Create**.
2. Pick the ${customer ? 'customer' : 'vendor'}, the **Invoice date** and the **Payment terms** (they set the due date). Without a term, enter the **Due date**, no earlier than the invoice date; left empty, the invoice is due the day it is issued.
3. Enter the first line: product, quantity, unit price, discount % and taxes (up to two).
4. Leave the **${customer ? 'Income' : 'Expense'} account** empty to take it from the product category, then the company default. Leave the **${customer ? 'Receivable' : 'Payable'} account** empty to take it from the partner, then the company default (see **Settings → Accounting → Default accounts**).
5. Save. The invoice opens as a **Draft**; add more lines if needed, then click **Post**.

${documentFlowEn}

The invoice date must fall inside each line tax's validity; a credit note for an earlier period keeps its original tax. The **Tax** fields list only the rates in effect on the **Invoice date** (today by default); changing the date clears the chosen tax, so pick it again.

${documentStatesEn}

## The list

Use the search box and filters above the list to narrow it. Click a row to open the document, its journal items, what is still open and the conversation beside it.`,
    },
  }
}

const guides: Record<string, AccountingGuides> = {
  '': {
    vi: {
      title: 'Tổng quan kế toán',
      source: `## Màn này dùng để làm gì

Bức tranh tài chính của công ty, tính thẳng từ các bút toán **đã ghi sổ**: doanh thu, lợi nhuận, tiền, tài sản, nợ phải trả, công nợ và dòng tiền. Chứng từ nháp không được tính.

## Chọn kỳ báo cáo

- Chọn một khoảng có sẵn (hôm nay, 7/14/30/90 ngày qua, tháng này, tháng trước), hoặc chọn năm rồi thu hẹp bằng ngày bắt đầu và kết thúc.
- Số **kết quả** (doanh thu, lợi nhuận, chi phí, dòng tiền) tính trong kỳ. Số **dư** (tiền, tài sản, nợ phải trả, công nợ) tính đến ngày cuối kỳ.
- Mỗi chỉ số so với **kỳ liền trước cùng độ dài**. Chưa có số liệu kỳ trước thì ghi *chưa có kỳ so sánh*.
- Bấm vào một thẻ chỉ số để mở bảng cân đối tài khoản của cùng kỳ: các tài khoản cộng thành con số đó nằm ở đây.

## Đọc các khối

- **Doanh thu theo thời gian**: mỗi điểm là doanh thu phát sinh trong khoảng đó, không cộng dồn.
- **Cơ cấu doanh thu** và **Chi phí theo tài khoản**: chia theo tài khoản doanh thu, chi phí đã ghi sổ.
- **Công nợ phải thu/phải trả**: các đối tác còn số mở, tách phần trong hạn và quá hạn.
- **Dòng tiền**: tiền thực đi qua tài khoản tiền mặt và ngân hàng, phân loại theo tài khoản đối ứng (bán hàng, mua hàng, chi phí hoạt động, khác).

## Khi số liệu trông sai

- Số bằng 0: kiểm tra chứng từ đã **Ghi sổ** chưa, và ngày chứng từ có nằm trong kỳ đang chọn không.
- Doanh thu hoặc chi phí rơi sai nhóm: kiểm tra tài khoản trên dòng hoá đơn và **Tài khoản mặc định**.`,
    },
    en: {
      title: 'Accounting overview',
      source: `## What this screen is for

The company's financial picture, computed straight from **posted** entries: revenue, profit, cash, assets, liabilities, open balances and cash flow. Drafts are not counted.

## Pick the reporting period

- Choose a preset (today, last 7/14/30/90 days, this month, last month), or pick a year and narrow it with a start and end date.
- **Result** figures (revenue, profit, expenses, cash flow) cover the period. **Balance** figures (cash, assets, liabilities, open items) are as of the period's last day.
- Each figure is compared with the **previous period of the same length**. Without earlier data it reads *no comparison yet*.
- Click a headline card to open the trial balance for the same period: the accounts that add up to that figure are listed there.

## Reading the blocks

- **Revenue over time**: each point is the revenue of that interval, not a running total.
- **Revenue mix** and **Expenses by account**: split by the posted income and expense accounts.
- **Receivables/payables**: partners with open balances, split into not yet due and overdue.
- **Cash flow**: money that actually moved through cash and bank accounts, grouped by the counterpart account (sales, purchases, operating costs, other).

## When a figure looks wrong

- A zero: check that the documents are **Posted** and dated inside the selected period.
- Revenue or expenses in the wrong group: check the accounts on the invoice lines and the **Default accounts**.`,
    },
  },
  'customer-invoices': invoiceGuide('customer'),
  'vendor-bills': invoiceGuide('vendor'),
  entries: {
    vi: {
      title: 'Bút toán',
      source: `## Màn này dùng để làm gì

Ghi các nghiệp vụ không đi qua hoá đơn hay thanh toán: phân bổ, điều chỉnh, kết chuyển, trích trước. Danh sách cũng hiện bút toán do module khác tạo.

## Tạo bút toán thủ công

1. Bấm **Tạo mới**, chọn **Sổ nhật ký**, **Ngày** và **Tham chiếu**.
2. Lưu để mở bút toán nháp.
3. Thêm từng dòng: tài khoản, nội dung và đúng một bên **Nợ** hoặc **Có**.
4. Khi tổng Nợ bằng tổng Có, bấm **Ghi sổ**. Bút toán lệch bị từ chối.

\`\`\`mermaid
flowchart TB
  A["Bút toán nháp"] --> Q{"Tổng Nợ = tổng Có?"}
  Q -->|Lệch| F["Thêm hoặc sửa dòng"]:::kv-warning
  Q -->|Cân| P["Ghi sổ"]:::kv-positive
  P --> R["Cần sửa: Đảo bút toán"]:::kv-danger
  class Q kv-decision
\`\`\`

## Sửa sai sau khi ghi sổ

Bút toán đã ghi sổ không sửa được. Bấm **Đảo bút toán** để tạo bút toán ngược chiều, rồi lập lại bút toán đúng. Bút toán do module khác ghi sổ (kho, bán hàng…) phải điều chỉnh từ chứng từ gốc của module đó. Đảo một bút toán bù trừ công nợ thì các hoá đơn nó đã bù mở lại.

## Khi bị từ chối

- **Sổ đã khoá**: ngày bút toán nằm trong kỳ đã đóng; chọn ngày trong kỳ đang mở.
- Dòng có thuế ngoài hiệu lực: đổi sang thuế còn hiệu lực vào ngày bút toán.`,
    },
    en: {
      title: 'Journal entries',
      source: `## What this screen is for

Record operations that do not go through an invoice or a payment: allocations, adjustments, closing transfers, accruals. The list also shows entries other modules created.

## Create a manual entry

1. Click **Create**, pick the **Journal**, the **Date** and a **Reference**.
2. Save to open the draft entry.
3. Add lines: account, label and exactly one of **Debit** or **Credit**.
4. When debits equal credits, click **Post**. An unbalanced entry is refused.

\`\`\`mermaid
flowchart TB
  A["Draft entry"] --> Q{"Debits = credits?"}
  Q -->|No| F["Add or fix lines"]:::kv-warning
  Q -->|Yes| P["Post"]:::kv-positive
  P --> R["Needs a fix: Reverse entry"]:::kv-danger
  class Q kv-decision
\`\`\`

## Correcting a posted entry

A posted entry cannot be edited. Click **Reverse entry** to create the opposite entry, then record the right one. An entry another module posted (stock, sales…) is corrected from that module's own document. Reversing a netting entry opens the invoices it netted again.

## When it is refused

- **The books are locked**: the entry date falls in a closed period; use a date in an open period.
- A line tax that is not in effect: switch to a tax valid on the entry date.`,
    },
  },
  payments: {
    vi: {
      title: 'Thanh toán',
      source: `## Màn này dùng để làm gì

Ghi nhận tiền thu từ khách hàng và tiền chi cho nhà cung cấp qua sổ tiền mặt hoặc ngân hàng, và tất toán công nợ đang mở.

## Ghi nhận một khoản thu hoặc chi

1. Bấm **Ghi nhận thanh toán**.
2. Chọn **Loại thanh toán** (*Nhận tiền* hoặc *Gửi tiền*), **Loại đối tác** và đối tác.
3. Chọn **Sổ nhật ký** tiền mặt hoặc ngân hàng, nhập **Số tiền**, ngày và nội dung.
4. **Tài khoản đối ứng** là tài khoản công nợ được tất toán: phải thu với khách hàng, phải trả với nhà cung cấp.
5. Muốn trừ thẳng vào một hoá đơn, chọn khoản ở **Đối soát với khoản mở**.
6. Bấm **Ghi nhận thanh toán**: hệ thống lập và ghi sổ bút toán tiền ngay.

\`\`\`mermaid
flowchart TB
  A["Nhập khoản thu/chi"] --> Q{"Chọn khoản mở?"}
  Q -->|Có| M["Trừ vào hoá đơn đó"]:::kv-positive
  Q -->|Không| U["Ghi sổ, công nợ còn mở"]:::kv-warning
  class Q kv-decision
\`\`\`

## Quy tắc đối soát

- Khoản mở phải nằm trên đúng **Tài khoản đối ứng** đã chọn và cùng chiều (thu tiền tất toán phải thu, chi tiền tất toán phải trả).
- Số tiền không được lớn hơn phần còn lại của khoản mở. Thanh toán ít hơn thì hoá đơn chuyển *Thanh toán một phần*.
- Ngày thanh toán nằm trong kỳ đã khoá thì bị từ chối.`,
    },
    en: {
      title: 'Payments',
      source: `## What this screen is for

Record money received from customers and paid to vendors through a cash or bank journal, and settle open receivables or payables.

## Record a receipt or a payment

1. Click **Register payment**.
2. Pick the **Payment type** (*Receive* or *Send*), the **Partner type** and the partner.
3. Pick a cash or bank **Journal**, enter the **Amount**, the date and a memo.
4. The **Counterpart account** is the receivable or payable account being settled.
5. To settle a specific invoice, pick it under **Reconcile with open item**.
6. Click **Register payment**: the cash entry is created and posted at once.

\`\`\`mermaid
flowchart TB
  A["Enter the payment"] --> Q{"Open item picked?"}
  Q -->|Yes| M["Settles that invoice"]:::kv-positive
  Q -->|No| U["Posted, balance stays open"]:::kv-warning
  class Q kv-decision
\`\`\`

## Reconciliation rules

- The open item must sit on the chosen **Counterpart account** and run the same way (receipts settle receivables, payments settle payables).
- The amount cannot exceed what is still open on that item. A smaller amount leaves the invoice *Partially paid*.
- A payment dated inside a locked period is refused.`,
    },
  },
  nettings: {
    vi: {
      title: 'Bù trừ công nợ',
      source: `## Màn này dùng để làm gì

Bù khoản đối tác còn nợ công ty với khoản công ty còn nợ chính đối tác đó, không cần chuyển tiền. Chỉ đối tác còn mở cả phải thu lẫn phải trả trên chứng từ đã ghi sổ mới hiện trong danh sách.

\`\`\`mermaid
flowchart TB
  A["Đối tác còn mở phải thu và phải trả"] --> B["Xem phân bổ: hạn trước bù trước"]
  B --> Q{"Số tiền đúng?"}
  Q -->|Đúng| P["Ghi sổ: Nợ phải trả, Có phải thu"]:::kv-positive
  Q -->|Sai| B
  P --> R["Đảo bút toán: chứng từ mở lại"]:::kv-warning
  class Q kv-decision
\`\`\`

## Bù trừ một đối tác

1. Chọn **Đối tác**, **Sổ nhật ký** (sổ tổng hợp ghi phiếu bù trừ) và **Ngày hạch toán**.
2. Nhập **Số tiền bù trừ**, hoặc để trống để bù hết bên nhỏ hơn.
3. Bấm **Xem phân bổ**. Hai bảng **Phải thu được bù** và **Phải trả được bù** cho biết mỗi chứng từ còn mở bao nhiêu và được bù bao nhiêu, chứng từ đến hạn trước được bù trước.
4. Bấm **Ghi sổ bù trừ**. Hệ thống tạo một bút toán trong sổ đã chọn, mỗi chứng từ một dòng trên đúng tài khoản công nợ của nó, và đối trừ ngay vào chứng từ đó. Màn chuyển sang bút toán vừa ghi.

## Lưu ý

- Số tiền không vượt quá bên nhỏ hơn; vượt thì hệ thống từ chối và báo mức tối đa.
- Phân bổ được tính lại lúc ghi sổ, nên nếu có thanh toán chen vào giữa thì số theo dữ liệu mới nhất.
- Bù nhầm thì mở bút toán và bấm **Đảo bút toán**: các chứng từ đã bù mở lại như trước.`,
    },
    en: {
      title: 'Netting',
      source: `## What this screen is for

Set what a partner owes the company against what the company owes that same partner, without moving money. Only partners still open on both the receivable and the payable side of posted documents are listed.

\`\`\`mermaid
flowchart TB
  A["Partner open on both sides"] --> B["Preview: due first is netted first"]
  B --> Q{"Amount right?"}
  Q -->|Yes| P["Post: debit payables, credit receivables"]:::kv-positive
  Q -->|No| B
  P --> R["Reverse the entry: documents reopen"]:::kv-warning
  class Q kv-decision
\`\`\`

## Net a partner

1. Pick the **Partner**, the **Journal** (the general journal nettings are kept in) and the **Accounting date**.
2. Enter the **Amount to net**, or leave it empty to net the whole smaller side.
3. Click **Preview allocation**. **Receivables netted** and **Payables netted** show what each document still holds and how much is netted, the one due first first.
4. Click **Post netting**. One entry goes into that journal, a line per document on that document's own receivable or payable account, each matched against its document at once. You land on the posted entry.

## Notes

- The amount never exceeds the smaller side; a larger one is refused with the maximum.
- The allocation is read again when posting, so a payment recorded in between is taken into account.
- Netted by mistake? Open the entry and click **Reverse entry**: the netted documents open again as before.`,
    },
  },
  'trial-balance': {
    vi: {
      title: 'Bảng cân đối phát sinh',
      source: `## Màn này dùng để làm gì

Mỗi tài khoản một dòng: số dư **đầu kỳ**, số **phát sinh** trong kỳ và số dư **cuối kỳ**, mỗi phần tách cột **Nợ** và **Có**, tính trên các bút toán đã ghi sổ. Dùng trước khi đóng kỳ và trước khi lập báo cáo tài chính.

## Cách dùng

1. Chọn **Từ ngày** và **Đến ngày**. Số dư đầu kỳ là mọi bút toán đã ghi sổ trước **Từ ngày**; để trống **Từ ngày** thì đầu kỳ bằng 0 và cả sổ tính vào phát sinh.
2. Bấm **Tính báo cáo**.
3. Xem ô **Kiểm tra Nợ = Có** ở đầu trang: tổng Nợ và tổng Có phải bằng nhau ở cả ba cặp cột.
4. Bấm số hiệu tài khoản để mở **Sổ cái** của tài khoản đó trong cùng kỳ.

## Tài khoản đang ẩn

Tài khoản không có số dư đầu kỳ và không phát sinh trong kỳ được ẩn để bảng gọn. Bấm **Hiện cả … tài khoản đang ẩn** để xem toàn bộ hệ thống tài khoản, bấm **Ẩn tài khoản không có số liệu** để quay lại.

## Khi báo Lệch hoặc thiếu số

- Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.
- Tài khoản thiếu số: bút toán còn nháp chưa được tính; mở **Bút toán** và ghi sổ.
- Mở **Sổ cái** theo tài khoản để xem từng dòng phát sinh.`,
    },
    en: {
      title: 'Trial balance',
      source: `## What this screen is for

One row per account: the **opening** balance, what the period **moved** and the **closing** balance, each split into **debit** and **credit** columns, across posted entries. Use it before closing a period and before preparing the financial statements.

## How to use it

1. Pick **Date from** and **Date to**. The opening balance is every entry posted before **Date from**; leave **Date from** empty and the opening is zero, with the whole ledger counted as movement.
2. Click **Calculate**.
3. Check **Debits equal credits** at the top: total debits and total credits must match in all three pairs of columns.
4. Click an account code to open its **General ledger** for the same period.

## Hidden accounts

Accounts with no opening balance and no movement in the period are hidden to keep the table short. Click **Show the … hidden accounts** to see the whole chart, and **Hide accounts with nothing to report** to go back.

## When it says Not equal or figures are missing

- The end date must be on or after the start date.
- An account looks short: drafts are not counted; open **Journal entries** and post them.
- Open the **General ledger** for that account to see each line.`,
    },
  },
  'general-ledger': {
    vi: {
      title: 'Sổ cái',
      source: `## Màn này dùng để làm gì

Xem từng dòng phát sinh Nợ, Có của một tài khoản (hoặc mọi tài khoản) trên bút toán đã ghi sổ.

## Cách dùng

1. Chọn tài khoản, hoặc để trống để xem mọi dòng.
2. Chọn khoảng ngày nếu cần, rồi áp dụng.
3. Tìm theo bút toán, tài khoản hoặc nội dung.
4. Bấm số bút toán để mở chứng từ gốc.

## Lưu ý

- Chỉ dòng của bút toán **đã ghi sổ** mới hiện.
- Tài khoản đã lưu trữ không còn trong bộ lọc; nếu đường dẫn cũ còn giữ tài khoản đó, màn báo *Tài khoản không còn khả dụng*: xoá bộ lọc tài khoản.`,
    },
    en: {
      title: 'General ledger',
      source: `## What this screen is for

See every debit and credit line of one account (or all accounts) on posted entries.

## How to use it

1. Pick an account, or leave it empty for every line.
2. Narrow the dates if needed, then apply.
3. Search by entry, account or label.
4. Click an entry number to open the source document.

## Notes

- Only lines of **posted** entries appear.
- Archived accounts drop out of the filter; if an old link still carries one, the screen says *Account no longer available*: clear the account filter.`,
    },
  },
  'partner-statement': {
    vi: {
      title: 'Sổ đối tác',
      source: `## Màn này dùng để làm gì

Theo dõi công nợ của một khách hàng hoặc nhà cung cấp: phát sinh Nợ, Có và phần chưa đối soát trên tài khoản phải thu, phải trả.

## Cách dùng

1. Chọn đối tác. Chưa chọn thì màn để trống.
2. Chọn khoảng ngày nếu cần.
3. Đọc cột **Còn lại**: phần chứng từ chưa được thanh toán hoặc đối soát.
4. Bấm số chứng từ để mở hoá đơn hoặc thanh toán gốc.

## Lưu ý

- Chỉ tính tài khoản phải thu, phải trả trên bút toán đã ghi sổ.
- Muốn tất toán khoản còn lại, vào **Thanh toán** và chọn khoản đó ở **Đối soát với khoản mở**.`,
    },
    en: {
      title: 'Partner statement',
      source: `## What this screen is for

Follow one customer's or vendor's balance: debits, credits and the unreconciled part on receivable and payable accounts.

## How to use it

1. Pick the partner. The screen stays empty until you do.
2. Narrow the dates if needed.
3. Read **Residual**: what has not been paid or reconciled yet.
4. Click a document number to open the source invoice or payment.

## Notes

- Only receivable and payable accounts on posted entries count.
- To settle what is left, go to **Payments** and pick that item under **Reconcile with open item**.`,
    },
  },
  books: {
    vi: {
      title: 'Sổ kế toán',
      source: `## Màn này dùng để làm gì

In và đối chiếu các sổ kế toán theo kỳ, với số đầu kỳ, phát sinh, số dư luỹ kế và số cuối kỳ chính xác.

## Các loại sổ

- **Sổ nhật ký chung**: mọi bút toán theo thứ tự ngày, cột tài khoản là tài khoản của chính dòng. Sổ này không có số dư.
- **Sổ cái** và **Sổ chi tiết tài khoản**: một tài khoản bất kỳ.
- **Sổ quỹ tiền mặt**, **Sổ tiền gửi ngân hàng**: một tài khoản tiền mà sổ nhật ký tiền mặt hoặc ngân hàng ghi vào. Mọi bút toán chạm tài khoản đó đều lên sổ, kể cả bút toán viết ở sổ nhật ký khác.
- **Sổ đối tác**: một tài khoản theo dõi công nợ (phải thu, phải trả). Chọn một đối tác, hoặc để **Mọi đối tác** để xem cả tài khoản với cột đối tác.

Khi công ty dùng chế độ kế toán có mẫu sổ, số hiệu mẫu (ví dụ *Mẫu số S07-DN*) hiện dưới tên sổ.

## Cách dùng

1. Chọn **Loại sổ** và khoảng ngày rồi bấm **Tính báo cáo**.
2. Sổ chỉ cho chọn những tài khoản nó được mở cho. Chưa chọn thì sổ mở tài khoản đầu tiên có phát sinh trong kỳ; chọn tài khoản khác rồi bấm **Tính báo cáo** lại.
3. Mỗi dòng mở về bút toán đã tạo ra số liệu. Cột **TK đối ứng** là các tài khoản phía bên kia của cùng bút toán.
4. Số đầu kỳ cộng Nợ trừ Có phải bằng số cuối kỳ; lệch thì kiểm tra bút toán nháp hoặc kỳ chọn.
5. **Tải CSV** lấy đúng sổ đang xem, cột theo thứ tự của mẫu sổ: ngày hạch toán, số và ngày chứng từ, diễn giải, TK đối ứng, Nợ, Có, số dư. Dòng đầu là số dư đầu kỳ, cuối file là cộng phát sinh và số dư cuối kỳ.`,
    },
    en: {
      title: 'Accounting books',
      source: `## What this screen is for

Print and check the accounting books for a period, with exact opening balance, movements, running balance and closing balance.

## Books

- **General journal**: every entry in date order; the account column is the line's own account. This book carries no balance.
- **General ledger** and **Account detail**: any one account.
- **Cash book**, **Bank book**: one money account a cash or bank journal pays through. Every entry that touches it is listed, including entries written in another journal.
- **Partner book**: one account tracked per partner (receivable, payable). Pick a partner, or leave **All partners** to see the whole account with a partner column.

When the company's accounting standard numbers its books, the form number (for example *Form S07-DN*) shows under the book's name.

## How to use it

1. Pick the **Book** and the dates, then **Calculate**.
2. A book offers only the accounts it is kept for. Left empty, it opens the first account with movement in the period; pick another and calculate again.
3. Each line opens the entry that produced it. **Contra account** lists the accounts on the other side of the same entry.
4. Opening plus debits minus credits must equal closing; if not, look for drafts or a wrong period.
5. **Download CSV** exports the book on screen in the form's column order: date recorded, document number and date, description, contra account, debit, credit, balance. The first row is the opening balance; the file ends with the period totals and the closing balance.`,
    },
  },
  'opening-balances': {
    vi: {
      title: 'Số dư đầu kỳ',
      source: `## Màn này dùng để làm gì

Đưa số dư của hệ thống cũ vào sổ khi bắt đầu dùng KetSuite, theo từng **đợt** có tổng kiểm soát và checksum nguồn để kiểm toán lại.

## Nhập một đợt

1. Bấm **Nhập số dư đầu kỳ**.
2. Nhập **Tên nguồn**, **Ngày hạch toán** và chọn sổ nhật ký loại **Nghiệp vụ khác**.
3. Nhập **Tổng Nợ kiểm soát** và **Tổng Có kiểm soát** lấy từ hệ thống cũ.
4. Nhập **Các dòng nguồn** trong bảng (gõ hoặc dán từ bảng tính): mỗi dòng có mã dòng nguồn, tài khoản, nội dung và đúng một số tiền Nợ hoặc Có. Cần ít nhất hai dòng; hàng cuối của bảng cộng sẵn tổng Nợ, tổng Có.
5. Bấm **Kiểm tra dữ liệu**. Hệ thống tự tính **Checksum nguồn** từ các dòng đã dán để đối chiếu về sau.

\`\`\`mermaid
flowchart TB
  A["Nhập đợt số dư"] --> Q{"Dòng khớp tổng kiểm soát?"}
  Q -->|Không| F["Sửa dòng nguồn"]:::kv-warning
  Q -->|Khớp| V["Đã kiểm tra"]
  V --> P["Ghi sổ số dư"]:::kv-positive
  class Q kv-decision
\`\`\`

## Ghi sổ

Đợt **Đã kiểm tra** mới ghi sổ được. Bấm **Ghi sổ số dư** để tạo một bút toán; sau đó mọi chỉnh sửa phải làm bằng bút toán đảo. Bấm **Mở bút toán** để xem bút toán đã tạo.

## Khi bị từ chối

- Tổng Nợ, tổng Có của dòng phải bằng nhau và bằng đúng tổng kiểm soát.
- Mã đợt đã dùng cho dữ liệu khác thì không nhập lại được; tạo đợt mới.
- Ngày hạch toán nằm trong kỳ đã khoá thì không ghi sổ được.`,
    },
    en: {
      title: 'Opening balances',
      source: `## What this screen is for

Bring balances from the previous system into the books when you start on KetSuite, in **batches** with control totals and a source checksum so they can be audited again.

## Import a batch

1. Click **Import opening balances**.
2. Enter the **Source name**, the **Accounting date** and pick a **Miscellaneous** journal.
3. Enter the **Control debit** and **Control credit** from the previous system.
4. Enter the **Source rows** in the grid (type or paste from a spreadsheet): each has a source key, an account, a label and exactly one debit or credit. At least two rows; the grid's last row sums the debits and credits.
5. Click **Validate data**. The **Source checksum** is computed from the pasted lines so the batch can be checked later.

\`\`\`mermaid
flowchart TB
  A["Import a batch"] --> Q{"Lines match the control totals?"}
  Q -->|No| F["Fix the source lines"]:::kv-warning
  Q -->|Yes| V["Validated"]
  V --> P["Post the balances"]:::kv-positive
  class Q kv-decision
\`\`\`

## Posting

Only a **Validated** batch can be posted. Click **Post opening balances** to create one entry; after that, corrections go through a reversal. **Open journal entry** shows the entry it created.

## When it is refused

- Line debits and credits must balance and equal the control totals exactly.
- A batch id already used for different data cannot be imported again; start a new batch.
- An accounting date inside a locked period cannot be posted.`,
    },
  },
  'period-closes': {
    vi: {
      title: 'Đóng kỳ',
      source: `## Màn này dùng để làm gì

Khoá sổ theo kỳ sau khi đã kiểm tra đủ, để không ai ghi thêm chứng từ vào kỳ đã báo cáo.

## Đóng một kỳ

1. Bấm **Tạo kỳ đóng sổ**, nhập **Kỳ** và khoảng ngày.
2. Mở kỳ để xem **Checklist đóng kỳ**: không còn bút toán nháp, tổng Nợ bằng tổng Có, bằng chứng chuẩn kế toán, đối chiếu ngân hàng, đóng kho, đối chiếu tài sản.
   Cột **Bằng chứng** chỉ chỗ cần xử lý: mỗi danh sách còn chứng từ nháp trong kỳ (**Hoá đơn khách hàng**, **Hoá đơn nhà cung cấp**, **Bút toán**) có một dòng riêng, bấm vào là mở danh sách đó đã lọc sẵn các chứng từ nháp trong kỳ. Bước Nợ/Có có link mở **Bảng cân đối phát sinh** cùng kỳ.
3. Xử lý các bước **Bắt buộc** đang bị chặn rồi bấm **Chạy lại kiểm tra**.
   **Chạy lại kiểm tra** và **Khóa mềm** đều cập nhật lại bằng chứng của chuẩn kế toán đang dùng trước. Từng mục hiện ở **Bằng chứng theo chuẩn kế toán**: mục bắt buộc chưa đạt sẽ chặn kỳ, mục **Nên xử lý** thì không.
4. Khi không còn bước chặn, nhập **Lý do** và bấm **Khóa mềm**.

\`\`\`mermaid
flowchart TB
  A["Kỳ đang mở"] --> Q{"Còn bước bắt buộc bị chặn?"}
  Q -->|Còn| F["Xử lý rồi chạy lại kiểm tra"]:::kv-warning
  Q -->|Hết| S["Khóa mềm"]:::kv-positive
  S --> R["Mở lại kỳ, cần lý do"]
  S --> H["Khóa cứng vĩnh viễn"]:::kv-danger
  class Q kv-decision
\`\`\`

## Khoá mềm, khoá cứng, mở lại

- **Khóa mềm**: chặn ghi sổ vào kỳ; người có quyền **Mở lại kỳ** được, bắt buộc ghi lý do.
- Muốn mở lại một kỳ thì phải mở lại các kỳ đã khoá sau nó trước.
- **Khóa cứng vĩnh viễn**: không mở lại, không chạy lại kiểm tra. Chỉ dùng khi đã nộp báo cáo và chắc chắn không còn điều chỉnh.
- Mỗi bước giữ checksum bằng chứng để kiểm toán lại.

## Khóa theo loại và người còn được ghi sổ

Kế toán trưởng đặt hai thứ này ở mục **Khóa theo loại và người còn được ghi sổ**, rồi bấm **Lưu khóa kỳ**:

- **Khóa trước**: khi kỳ còn mở, chọn loại chứng từ (hóa đơn bán, hóa đơn mua, thu chi, bút toán) không được ghi sổ vào ngày của kỳ nữa, trong lúc các loại khác vẫn ghi bình thường. Bút toán kết chuyển kết quả vẫn ghi được.
- **Còn được ghi sổ khi khóa mềm**: sau khi khóa mềm, chỉ những người được chọn còn ghi sổ được vào kỳ, thường để ghi bút toán điều chỉnh cuối kỳ.
- Khóa cứng chặn cả những người này. Mỗi lần thay đổi được ghi vào **Nhật ký kiểm toán** kèm giá trị trước và sau.`,
    },
    en: {
      title: 'Period closing',
      source: `## What this screen is for

Lock the books for a period once it has been checked, so nobody posts into a period that has already been reported.

## Close a period

1. Click **Create close period**, enter the **Period** and its dates.
2. Open it to see the **Close checklist**: no draft entries, debits equal credits, localization evidence, bank reconciliation, inventory closed, assets tied out.
   The **Evidence** column points to what needs doing: each list still holding drafts dated in the period (**Customer invoices**, **Vendor bills**, **Journal entries**) gets its own line that opens the list filtered to those drafts. The debit/credit step links to the **Trial balance** of the same dates.
3. Clear the blocked **Required** steps, then click **Refresh checks**.
   **Refresh checks** and **Soft close** both update the evidence of the accounting standard in use first. Each item shows under **Accounting standard evidence**: a required item not met blocks the period, an **Advised** one does not.
4. When nothing blocks, enter a **Reason** and click **Soft close**.

\`\`\`mermaid
flowchart TB
  A["Open period"] --> Q{"Required step blocked?"}
  Q -->|Yes| F["Fix it, refresh checks"]:::kv-warning
  Q -->|No| S["Soft close"]:::kv-positive
  S --> R["Reopen, with a reason"]
  S --> H["Permanent hard close"]:::kv-danger
  class Q kv-decision
\`\`\`

## Soft close, hard close, reopen

- **Soft close**: blocks posting into the period; someone allowed can **Reopen period**, with a reason.
- To reopen a period, reopen every later locked period first.
- **Permanent hard close**: cannot be reopened or re-checked. Use it only once returns are filed and no adjustment remains.
- Each step keeps an evidence checksum so it can be audited again.

## Locks by kind and who may still post

The chief accountant sets these under **Locks by kind and who may still post**, then clicks **Save period locks**:

- **Locked ahead**: while the period is open, the kinds you pick (customer invoices, vendor bills, payments, entries) can no longer be posted on its dates; the others still post. The result transfer still posts.
- **May still post once soft closed**: after the soft close, only the people you pick may still post into the period, usually for the period-end adjustments.
- A hard close stops them too. Every change goes to the **Audit log** with what it was before and after.`,
    },
  },
  accounts: {
    vi: {
      title: 'Hệ thống tài khoản',
      source: `## Màn này dùng để làm gì

Danh mục tài khoản kế toán của công ty. Mỗi tài khoản có mã, tên và **Loại tài khoản**; loại quyết định tài khoản rơi vào báo cáo nào (tài sản, nợ, vốn, doanh thu, chi phí).

## Tạo hoặc sửa tài khoản

1. Bấm **Tạo mới**, hoặc bấm một dòng để sửa.
2. Nhập **Mã** (duy nhất trong công ty), **Tên** và tên tiếng Anh theo chế độ kế toán nếu có.
3. Chọn **Loại tài khoản**.
4. Bật **Cho phép đối soát** cho tài khoản công nợ cần theo dõi phần còn lại (phải thu, phải trả, tạm ứng).
5. Lưu.

## Lưu trữ

Bỏ chọn **Đang sử dụng** để lưu trữ: tài khoản không còn trong danh sách chọn nhưng số liệu cũ vẫn giữ trong sổ. Tài khoản do bộ chuẩn kế toán cài sẵn nên giữ nguyên mã.`,
    },
    en: {
      title: 'Chart of accounts',
      source: `## What this screen is for

The company's chart of accounts. Each account has a code, a name and an **Account type**; the type decides which report it lands in (assets, liabilities, equity, income, expenses).

## Create or edit an account

1. Click **Create**, or click a row to edit it.
2. Enter the **Code** (unique within the company), the **Name** and, if any, the English name from the accounting regime.
3. Pick the **Account type**.
4. Turn on **Allow reconciliation** for balance accounts whose open part you follow (receivables, payables, advances).
5. Save.

## Archiving

Untick **In use** to archive: the account leaves every picker but its history stays in the books. Keep the codes that the installed accounting package ships.`,
    },
  },
  journals: {
    vi: {
      title: 'Sổ nhật ký',
      source: `## Màn này dùng để làm gì

Sổ nhật ký phân loại chứng từ và đánh số: mỗi chứng từ ghi sổ lấy số theo sổ của nó.

## Loại sổ

- **Bán hàng**, **Mua hàng**: hoá đơn khách hàng, hoá đơn nhà cung cấp.
- **Tiền mặt**, **Ngân hàng**: thanh toán; bắt buộc có **Tài khoản mặc định** thuộc loại tiền. Phiếu thu, phiếu chi ghi dòng tiền vào tài khoản này, nên sổ thiếu nó hoặc chọn tài khoản loại khác thì không lưu được.
- **Nghiệp vụ khác**: bút toán thủ công, số dư đầu kỳ.

## Tạo hoặc sửa sổ

1. Bấm **Tạo mới**, nhập **Mã** (duy nhất) và **Tên**.
2. Chọn **Loại** và tài khoản mặc định.
3. **Số thứ tự** sắp sổ trong danh sách chọn.
4. Lưu. Bỏ chọn **Đang sử dụng** để lưu trữ sổ không còn dùng.`,
    },
    en: {
      title: 'Journals',
      source: `## What this screen is for

Journals group documents and number them: each posted document takes its number from its journal.

## Journal types

- **Sales**, **Purchase**: customer invoices and vendor bills.
- **Cash**, **Bank**: payments; a **Default account** of the cash type is required. Receipts and payments post their money to it, so a journal without one, or with an account of another type, cannot be saved.
- **Miscellaneous**: manual entries and opening balances.

## Create or edit a journal

1. Click **Create**, enter a unique **Code** and a **Name**.
2. Pick the **Type** and the default account.
3. **Sequence** orders journals in pickers.
4. Save. Untick **In use** to archive a journal you no longer use.`,
    },
  },
  terms: {
    vi: {
      title: 'Điều khoản thanh toán',
      source: `## Màn này dùng để làm gì

Điều khoản thanh toán chia số tiền hoá đơn thành các **mốc đến hạn**. Hoá đơn chọn điều khoản nào thì hạn thanh toán và tuổi nợ tính theo các mốc đó.

## Tạo điều khoản

1. Bấm **Tạo mới**, nhập tên và ghi chú hiển thị trên chứng từ.
2. Lưu, rồi bấm **Thêm mốc thanh toán**.
3. Mỗi mốc có **Kiểu giá trị** (*Phần trăm* hoặc *Số tiền cố định*), **Giá trị** và **Cách tính hạn**:
   - *Số ngày sau ngày hoá đơn*;
   - *Số ngày sau cuối tháng* hoặc *sau cuối tháng kế tiếp*;
   - *Cộng ngày rồi chốt ngày trong tháng sau* (dùng thêm **Ngày trong tháng sau**).
4. Bấm một mốc để sửa.

## Lưu ý

Điều khoản chưa có mốc nào thì hoá đơn đến hạn ngay trong ngày lập.`,
    },
    en: {
      title: 'Payment terms',
      source: `## What this screen is for

Payment terms split an invoice amount into **due milestones**. The invoice's due dates and ageing follow the milestones of the terms it uses.

## Create payment terms

1. Click **Create**, enter a name and the note shown on documents.
2. Save, then click **Add due milestone**.
3. Each milestone has a **Value type** (*Percent* or *Fixed amount*), a **Value** and a **Due computation**:
   - *Days after invoice date*;
   - *Days after end of month* or *Days after end of next month*;
   - *Days after, then day of next month* (uses **Day of next month**).
4. Click a milestone to edit it.

## Note

Terms without milestones make the invoice due on its own date.`,
    },
  },
  defaults: {
    vi: {
      title: 'Tài khoản mặc định',
      source: `## Màn này dùng để làm gì

Quyết định trước tài khoản hạch toán cho hoá đơn, để dòng hoá đơn khỏi phải chọn tài khoản mỗi lần.

## Thứ tự lấy tài khoản

\`\`\`mermaid
flowchart TB
  A["Dòng hoá đơn"] --> Q{"Dòng đã chọn tài khoản?"}
  Q -->|Có| L["Dùng tài khoản của dòng"]:::kv-positive
  Q -->|Chưa| C{"Nhóm sản phẩm có tài khoản?"}
  C -->|Có| G["Dùng tài khoản của nhóm"]:::kv-positive
  C -->|Không| D["Dùng mặc định của công ty"]
  class Q,C kv-decision
\`\`\`

- **Doanh thu, chi phí**: theo dòng, rồi nhóm sản phẩm, rồi mặc định của công ty.
- **Phải thu, phải trả**: theo hoá đơn, rồi đối tác, rồi mặc định của công ty.

## Cách dùng

1. Ở **Mặc định của công ty**, chọn tài khoản doanh thu, chi phí, phải thu, phải trả rồi lưu. Tài khoản nào chuẩn kế toán đã cố định thì hiện ở khối **Cố định theo chuẩn kế toán**, chỉ xem, không đổi được. Công ty đã chọn tài khoản khác trước khi có quy định này thì giữ nguyên lựa chọn đó.
2. Nhóm sản phẩm cần hạch toán riêng: ở khối **Đặt tài khoản cho nhóm sản phẩm**, chọn **Nhóm sản phẩm**, tài khoản doanh thu, chi phí rồi lưu.
3. Bấm một dòng trong **Nhóm sản phẩm đã cấu hình** để sửa. Nhóm không có ở đây dùng mặc định của công ty.`,
    },
    en: {
      title: 'Default accounts',
      source: `## What this screen is for

Decide the accounts invoices post to in advance, so invoice lines need not pick one each time.

## Which account is used

\`\`\`mermaid
flowchart TB
  A["Invoice line"] --> Q{"Line has an account?"}
  Q -->|Yes| L["Use the line's account"]:::kv-positive
  Q -->|No| C{"Category has accounts?"}
  C -->|Yes| G["Use the category's"]:::kv-positive
  C -->|No| D["Use the company default"]
  class Q,C kv-decision
\`\`\`

- **Income, expense**: the line, then the product category, then the company default.
- **Receivable, payable**: the invoice, then the partner, then the company default.

## How to use it

1. Under **Company defaults**, pick the income, expense, receivable and payable accounts and save. An account the accounting standard fixes shows under **Fixed by the accounting standard**, read only. A company that chose another account before this rule keeps its choice.
2. For a product category with its own accounts, use **Set the accounts for a product category**: pick the **Product category**, its income and expense accounts, and save.
3. Click a row under **Configured categories** to edit it. Categories not listed use the company defaults.`,
    },
  },
  'audit-log': {
    vi: {
      title: 'Nhật ký kiểm toán',
      source: `## Màn này dùng để làm gì

Xem ai đã ghi sổ, đảo chứng từ hay sửa cấu hình kế toán nào, lúc nào và vì sao. Nhật ký chỉ ghi thêm, không sửa hay xoá được, nên dùng được khi đối chiếu hoặc khi kiểm toán hỏi lại.

\`\`\`mermaid
flowchart TB
  A["Ghi sổ chứng từ"] --> L["Nhật ký kiểm toán"]
  B["Đảo bút toán"]:::kv-warning --> L
  L --> Q{"Cần xem kỹ?"}
  Q -->|Có| M["Mở sự kiện: người, lý do, chi tiết"]
  M --> D["Mở chứng từ"]:::kv-positive
  class Q kv-decision
\`\`\`

## Những gì được ghi

- **Ghi sổ**: mọi chứng từ ghi vào sổ cái, gồm hoá đơn bán, hoá đơn mua, bút toán, thu chi, bù trừ, số dư đầu kỳ và khấu hao.
- **Đảo bút toán**: bút toán bị đảo, kèm lý do và bút toán đảo được tạo ra.
- **Đổi khóa kỳ**: loại chứng từ bị khoá và người còn được ghi sổ trong kỳ, trước và sau.
- **Sửa**: sửa một tài khoản, sổ nhật ký, thuế, điều khoản thanh toán hoặc **Tài khoản mặc định**. Mở sự kiện để xem bảng **Trường thay đổi**: mỗi trường đã đổi, giá trị **Trước** và **Sau** (tối đa 30 trường). Tạo mới hoặc lưu lại mà không đổi gì thì không ghi.

## Tìm một sự kiện

1. Gõ tên người thực hiện, số chứng từ hoặc lý do vào ô tìm kiếm.
2. Dùng **Bộ lọc** để chọn **Thao tác**, **Loại đối tượng**, **Ngày thực hiện** hoặc **Ngày hạch toán**; dùng **Nhóm theo** để gom theo người thực hiện hoặc thao tác.
3. Bấm một dòng để mở sự kiện. Cửa sổ chỉ để xem: thời điểm, người thực hiện, chứng từ (bấm để mở), ngày hạch toán, lý do, chứng từ liên quan và phần **Chi tiết**, hoặc bảng **Trường thay đổi** với sự kiện **Sửa**.

## Lưu ý

- **Ngày thực hiện** là ngày theo múi giờ của công ty; **Ngày hạch toán** là ngày ghi vào sổ, có thể khác.
- Người xem không có quyền xem danh sách người dùng sẽ thấy mã người dùng thay cho tên.
- Màn này cần quyền xem dữ liệu nhạy cảm của Kế toán.`,
    },
    en: {
      title: 'Audit log',
      source: `## What this screen is for

See who posted or reversed which document, or edited which accounting setting, when and why. The log is append-only: nothing in it can be edited or deleted, so it holds up when you reconcile or when an auditor asks.

\`\`\`mermaid
flowchart TB
  A["Post a document"] --> L["Audit log"]
  B["Reverse an entry"]:::kv-warning --> L
  L --> Q{"Need a closer look?"}
  Q -->|Yes| M["Open the event: who, why, details"]
  M --> D["Open the document"]:::kv-positive
  class Q kv-decision
\`\`\`

## What is recorded

- **Posted**: every document that reaches the ledger, including customer invoices, vendor bills, entries, payments, nettings, opening balances and depreciation.
- **Reversed**: an entry that was reversed, with the reason and the reversal entry created.
- **Period locks changed**: the document kinds locked and the people still allowed to post in the period, before and after.
- **Edited**: an edit to an account, a journal, a tax, a payment term or the **Default accounts**. Open the event for the **Changed fields** table: each field that changed, its **Before** and **After** value (at most 30 fields). Creating a record, or saving it again unchanged, records nothing.

## Find an event

1. Type who did it, a document number or a reason into the search box.
2. Use **Filters** to pick an **Action**, a **Record type**, a **Day** or an **Accounting date**; use **Group By** to gather events by who did them or by action.
3. Click a row to open the event. The window is read only: when, by whom, the document (click to open it), the accounting date, the reason, the related document and the **Details**, or the **Changed fields** table for an **Edited** event.

## Notes

- The **Day** is the date in the company's time zone; the **Accounting date** is the date booked in the ledger, which can differ.
- A reader not allowed to list users sees user ids instead of names.
- This screen needs Accounting's sensitive-data permission.`,
    },
  },
  taxes: taxesHelp,
}

/** The guide for an accounting route, by its first segment under /admin/accounting. */
export const accountingGuideFor = (pathname: string): AccountingGuides | null => {
  const match = /^\/admin\/accounting(?:\/([^/]+))?\/?/u.exec(pathname)
  if (!match) return null
  return guides[match[1] ?? ''] ?? null
}
