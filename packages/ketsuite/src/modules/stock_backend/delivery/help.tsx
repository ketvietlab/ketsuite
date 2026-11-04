import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

export type DeliveryScreen =
  | 'overview'
  | 'dispatch'
  | 'shipments'
  | 'shipment'
  | 'statements'
  | 'statement'
  | 'carriers'

const journey = {
  vi: `\`\`\`mermaid
flowchart TD
  A["Nháp"] -->|Đặt vận chuyển| B["Chờ bàn giao"]
  B -->|Bàn giao, phiếu xuất hoàn tất| C["Đang giao"]
  C -->|Giao thành công| D["Đã giao"]:::kv-positive
  C -->|Giao không thành công| E["Giao không thành công"]:::kv-warning
  E -->|Giao lại| C
  E -->|Hoàn hàng| F["Đã hoàn hàng"]:::kv-danger
\`\`\``,
  en: `\`\`\`mermaid
flowchart TD
  A["Draft"] -->|Book| B["Booked"]
  B -->|Hand over, delivery completed| C["In transit"]
  C -->|Delivered| D["Delivered"]:::kv-positive
  C -->|Delivery failed| E["Delivery failed"]:::kv-warning
  E -->|Deliver again| C
  E -->|Return to warehouse| F["Returned"]:::kv-danger
\`\`\``,
}
const settlement = {
  vi: `\`\`\`mermaid
flowchart TD
  A["Nháp<br>vận đơn đã giao hoặc hoàn<br>tới ngày đối soát"] -->|Ghi sổ| B["Chờ tất toán<br>Nợ 641 / Có 331"]
  B -->|Tất toán| C["Đã tất toán<br>331 và 1388 về 0"]:::kv-positive
  A -->|Hủy| D["Đã hủy<br>vận đơn vào bảng khác"]:::kv-danger
\`\`\``,
  en: `\`\`\`mermaid
flowchart TD
  A["Draft<br>shipments delivered or<br>returned up to its date"] -->|Post| B["To settle<br>debit 641, credit 331"]
  B -->|Settle| C["Settled<br>331 and 1388 cleared"]:::kv-positive
  A -->|Cancel| D["Cancelled<br>shipments free for another"]:::kv-danger
\`\`\``,
}

const guides: Record<DeliveryScreen, Record<'vi' | 'en', string>> = {
  overview: {
    vi: `## Tổng quan giao hàng
Mỗi dòng là một đơn vị vận chuyển công ty tự làm việc cùng: số vận đơn **chờ bàn giao**, **đang giao**, **không giao được**, **chờ đối soát**, tiền thu hộ trên các vận đơn đang đi đường và tiền hãng đang giữ (đã giao, chưa tất toán).

Mỗi ô số ở đầu trang mở đúng các vận đơn nó đếm: Chờ bàn giao, Đang giao, Không giao được, hoặc COD đang giao (đang giao và không giao được).

## Làm tiếp ở đâu
- **Vận hành giao hàng**: phiếu xuất tới khách chưa bàn giao cho hãng.
- **Danh sách vận đơn**: mọi vận đơn, vận đơn giao không thành công lên đầu.
- **Đối soát vận chuyển**: bảng đối soát với hãng, chỉ kế toán, quản lý kho và kiểm toán nội bộ thấy.

Hãng do nền tảng quản lý (đặt qua tài khoản của nhà cung cấp dịch vụ) chưa có trong đợt này.`,
    en: `## Delivery overview
Each row is a carrier the company deals with itself: shipments **to hand over**, **in transit**, **failed**, **to settle**, the cash on delivery on parcels under way and the cash the carrier holds (delivered, not yet settled).

Each figure at the top opens the shipments it counts: to hand over, in transit, failed, or COD under way (in transit and failed).

## Where to carry on
- **Delivery operations**: deliveries to customers not yet handed to a carrier.
- **Shipments**: every shipment, failed ones first.
- **Carrier statements**: statements with carriers, seen by accountants, stock managers and internal audit.

Carriers managed by the platform (booked through the service provider's own account) are not part of this release.`,
  },
  dispatch: {
    vi: `## Vận hành giao hàng
Danh sách các phiếu giao tới khách đã xác nhận mà chưa bàn giao cho hãng. Mỗi dòng ở một trong bốn tình trạng, theo thứ tự cần làm:

| Tình trạng | Nghĩa là |
|---|---|
| **Chờ bàn giao** | Vận đơn đã đặt, kho giữ đủ hàng: bàn giao được. |
| **Chờ đặt vận chuyển** | Có vận đơn nháp: mở để đặt. |
| **Chưa có vận đơn** | Phiếu xuất chưa có vận đơn. |
| **Chờ đủ hàng** | Vận đơn đã đặt nhưng kho chưa giữ đủ cả phiếu. |

Dòng có vận đơn mở vận đơn; dòng chưa có mở phiếu xuất.

## Tạo nhiều vận đơn
Tick các phiếu rồi bấm **Tạo vận đơn** (tối đa 100 dòng mỗi lần). Mỗi phiếu được một vận đơn nháp với hãng mặc định, 1 kg, và thu hộ phần còn lại của đơn nếu đơn trả ngay khi nhận hàng. Phiếu đã có vận đơn hoặc không còn chờ giao được báo lại kèm lý do.`,
    en: `## Delivery operations
The confirmed deliveries to customers not yet handed to a carrier. Each row is in one of four statuses, in the order they need work:

| Status | Means |
|---|---|
| **To hand over** | Booked, all goods held: it can be handed over. |
| **To book** | A draft shipment: open it to book it. |
| **No shipment** | The delivery has no shipment yet. |
| **Waiting for goods** | Booked, but the warehouse does not hold the whole delivery yet. |

A row with a shipment opens the shipment; one without opens the delivery.

## Create many shipments
Tick deliveries and select **Create shipments** (up to 100 rows at a time). Each gets a draft with the default carrier, 1 kg and, for an order paid on delivery, what is left of the order as cash on delivery. Deliveries that have a shipment or no longer wait are listed with why.`,
  },
  shipments: {
    vi: `## Danh sách vận đơn
Mọi vận đơn của công ty: **Giao không thành công** lên đầu, rồi chờ bàn giao, nháp, đang giao, đã giao, đã hoàn, đã hủy. Lọc theo kho, hãng và tình trạng; tìm theo số vận đơn, mã vận đơn, khách hoặc phiếu xuất.

## Bàn giao nhiều vận đơn
Tick các vận đơn rồi bấm **Bàn giao các vận đơn đã chọn**. Vận đơn đã đặt và giữ đủ hàng được bàn giao: phiếu xuất hoàn tất trọn phiếu và đơn bán cập nhật số đã giao. Vận đơn chưa đặt hoặc chưa đủ hàng được báo lại kèm lý do.

${journey.vi}`,
    en: `## Shipments
Every shipment of the company: **Delivery failed** first, then booked, draft, in transit, delivered, returned and cancelled. Filter by warehouse, carrier and status; search by number, tracking code, customer or delivery.

## Hand many over
Tick shipments and select **Hand over selected**. Booked shipments whose goods are all held are handed over: the delivery completes whole and the sales order counts it delivered. Those not booked or not fully held are listed with why.

${journey.en}`,
  },
  shipment: {
    vi: `## Vận đơn
Một vận đơn chở một phiếu xuất tới khách. Vận đơn nháp chọn **đơn vị vận chuyển**, **khối lượng** (lớn hơn 0, tối đa 50 kg) và **thu hộ (COD)**, không quá phần còn lại của đơn bán sau các vận đơn khác. Phí hiện theo biểu phí của hãng.

## Các bước
1. **Đặt vận chuyển** khi phiếu xuất còn chờ giao: nhập mã vận đơn hãng cấp, hoặc bỏ trống để lấy số kế tiếp của hãng. Phí chốt từ đây; vận đơn chỉ còn đọc.
2. **Bàn giao** khi kho giữ đủ hàng: phiếu xuất hoàn tất trọn phiếu (không tách phiếu), hàng rời kho và giá vốn được ghi.
3. **Giao thành công**: tiền thu hộ lớn hơn 0 thì sổ ghi Nợ tiền hãng giữ hộ (1388, theo hãng) / Có phải thu khách (131) hôm nay.
4. **Giao không thành công** hỏi lý do; sau đó **Giao lại** hoặc **Hoàn hàng** (mở phiếu nhập trả của phiếu xuất, bỏ phí thu hộ).

**Hủy vận đơn** được khi chưa bàn giao: không tính phí, phiếu xuất quay lại hàng chờ giao. Kỳ kế toán đã khoá thì không ghi nhận giao thành công được.

${journey.vi}`,
    en: `## Shipment
A shipment carries one delivery to a customer. A draft chooses the **carrier**, the **weight** (above 0, at most 50 kg) and the **cash on delivery**, no more than what is left of the sales order after its other shipments. Fees follow the carrier's tariff.

## Steps
1. **Book** while the delivery waits: type the tracking code the carrier gave, or leave it empty for the carrier's next number. Fees are fixed from here; the shipment is read-only.
2. **Hand over** once all goods are held: the delivery completes whole (no backorder), the goods leave and their cost is posted.
3. **Delivered**: cash on delivery above 0 debits the cash held by the carrier (1388, by carrier) and credits the customer receivable (131) today.
4. **Delivery failed** asks why; then **Deliver again** or **Return to warehouse** (opens the return of the delivery and drops the COD fee).

**Cancel shipment** works until it is handed over: nothing is charged and the delivery is back in the queue. A locked accounting period refuses recording a delivery.

${journey.en}`,
  },
  statements: {
    vi: `## Đối soát vận chuyển
Các bảng đối soát với hãng: nháp, chờ tất toán, đã tất toán, đã hủy; mới nhất trước trong mỗi tình trạng. Mỗi dòng cho số vận đơn, tiền thu hộ, tổng phí và **COD trừ phí**.

Kế toán và chủ doanh nghiệp lập, ghi sổ và tất toán; quản lý kho và kiểm toán nội bộ chỉ xem. Thủ kho và bán hàng không thấy màn này.

${settlement.vi}`,
    en: `## Carrier statements
Statements with carriers: draft, to settle, settled and cancelled; the latest first within each. Each row gives its shipments, cash on delivery, fees and **COD less fees**.

Accountants and the owner draw them up, post and settle them; stock managers and internal audit read them. Storekeepers and sales do not see this screen.

${settlement.en}`,
  },
  statement: {
    vi: `## Bảng đối soát
Chọn **đơn vị vận chuyển** và **ngày đối soát** (không sau hôm nay): bảng lấy mọi vận đơn của hãng đã giao hoặc đã hoàn tới ngày đó và chưa nằm trên bảng nào khác. Vận đơn hoàn hàng không thu hộ, chỉ tính phí vận chuyển. Lưu lại bảng nháp thì thêm vận đơn mới phát sinh; trang báo số vận đơn đang chờ.

## Ghi sổ và tất toán
- **Ghi sổ**: phí lớn hơn 0 thì ghi Nợ chi phí vận chuyển (641) / Có phải trả hãng (331) ngày đối soát.
- **Tất toán** vào một ngày từ ngày đối soát tới hôm nay, qua sổ ngân hàng hoặc tiền mặt: phí trừ vào tiền thu hộ (Nợ 331 / Có 1388); hãng chuyển phần còn lại vào ngân hàng, hoặc công ty trả hãng khi phí lớn hơn tiền thu hộ.
- **Hủy** bảng nháp hỏi lý do; vận đơn trên bảng được đưa vào bảng khác.

Kỳ đã khoá thì không ghi sổ hay tất toán được; không có gì được ghi.

${settlement.vi}`,
    en: `## Carrier statement
Choose the **carrier** and the **statement date** (not after today): the statement takes every shipment of the carrier delivered or returned up to that day and on no other. A returned shipment collects nothing; only its carrying is charged. Saving a draft again adds what came since; the page counts what is waiting.

## Post and settle
- **Post**: fees above 0 debit carrying cost (641) and credit the carrier payable (331) on the statement date.
- **Settle** on a day from the statement date to today, through a bank or cash journal: the fees come off the cash collected (debit 331, credit 1388); the carrier pays the rest into the bank, or the company pays the carrier when the fees are more.
- **Cancel** asks why and only drops a draft; its shipments go on another statement.

A locked period refuses posting and settling; nothing is written.

${settlement.en}`,
  },
  carriers: {
    vi: `## Đơn vị vận chuyển
Các hãng công ty tự làm việc cùng, mỗi hãng có **mã** (2 đến 10 chữ cái hoặc chữ số, cố định sau khi tạo), **tên** và **biểu phí**: phí kg đầu, phí mỗi kg bắt đầu thêm và phí thu hộ (%, tối đa 10%).

- Luôn có một **hãng mặc định**, được chọn sẵn cho vận đơn mới; hãng đầu tiên là mặc định. Không ngừng dùng hãng mặc định.
- Mỗi hãng là một đối tác trên sổ: tiền thu hộ hãng giữ và phí hãng tính đều theo tên hãng.
- **Ngừng dùng** thì hãng không nhận vận đơn mới và rời ô chọn; vận đơn đang giao và bảng đối soát của hãng vẫn làm tiếp. **Dùng lại** khi cần.
- Biểu phí mới áp cho vận đơn đặt sau; vận đơn đã đặt giữ phí lúc đặt.

Quản lý kho và chủ doanh nghiệp sửa được; vai trò khác chỉ xem.`,
    en: `## Carriers
The carriers the company deals with itself, each with a **code** (2 to 10 letters or digits, fixed once added), a **name** and a **tariff**: the first kilogram, each kilogram begun after it and the COD fee (%, at most 10%).

- There is always one **default carrier**, chosen for every new shipment; the first carrier is the default. The default cannot be archived.
- Each carrier is a partner on the books: the cash it holds and the fees it charges are under its name.
- **Archive** takes it out of the choices and off new shipments; its shipments under way and its statements carry on. **Use again** when needed.
- A new tariff applies to shipments booked after; booked ones keep their fees.

Stock managers and the owner edit; other roles read.`,
  },
}

const TITLES: Record<DeliveryScreen, Record<'vi' | 'en', string>> = {
  overview: { vi: 'Tổng quan giao hàng', en: 'Delivery overview' },
  dispatch: { vi: 'Vận hành giao hàng', en: 'Delivery operations' },
  shipments: { vi: 'Danh sách vận đơn', en: 'Shipments' },
  shipment: { vi: 'Vận đơn', en: 'Shipment' },
  statements: { vi: 'Đối soát vận chuyển', en: 'Carrier statements' },
  statement: { vi: 'Bảng đối soát', en: 'Carrier statement' },
  carriers: { vi: 'Đơn vị vận chuyển', en: 'Carriers' },
}

/** K45–K48: each shipping screen's guide, in the content slot of its page. */
export function DeliveryHelp({
  lang,
  screen,
  id,
}: {
  lang: 'vi' | 'en'
  screen: DeliveryScreen
  id?: string
}) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={id ?? `stock-delivery-${screen}-help`}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={TITLES[screen][lang]}
      closeLabel={vi ? 'Đóng' : 'Close'}
      body={
        <MarkdownContent
          source={guides[screen][lang]}
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

/** The carriers guide, for the list and the carrier's record, each with its own `id`. */
export const CarrierHelp = ({ lang, id = 'stock-carrier-help' }: { lang: 'vi' | 'en'; id?: string }) => (
  <DeliveryHelp lang={lang} screen="carriers" id={id} />
)
