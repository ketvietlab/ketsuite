import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Kho hàng là gì
Mỗi kho có tên, **tên viết tắt** (đứng đầu số phiếu của kho, ví dụ **WH/KK/0001**) và cách nhận, giao hàng. Tạo kho thì hệ thống tạo sẵn bộ vị trí riêng của kho: vị trí kho chính, **Nhà cung cấp**, **Khách hàng**, **Hàng hủy** và **Điều chỉnh tồn kho**, cùng các loại hoạt động nhận, giao. Các vị trí này không dùng chung với kho khác; màn **Vị trí kho** phân biệt chúng bằng cột **Kho hàng**.

## Thêm và sửa kho
Bấm **Tạo mới** để thêm kho. Bấm một kho trong danh sách để mở và sửa tên, tên viết tắt, **Các bước nhận hàng** (một, hai hoặc ba bước) và **Các bước giao hàng**. Chỉ quản lý kho và chủ doanh nghiệp sửa được; người khác chỉ xem.

## Giữ hàng
**Giữ hàng cho phiếu xuất và phiếu chuyển** chọn lúc kho dành sẵn tồn cho phiếu. Phiếu nhập không giữ hàng.

- **Khi xác nhận**: giữ ngay lúc người dùng xác nhận phiếu.
- **Thủ công** (mặc định): chỉ giữ khi ai đó bấm **Giữ hàng** trên phiếu hoặc trên danh sách Dịch chuyển.
- **Trước ngày dự kiến**: hệ thống kiểm mỗi giờ và tự giữ cho phiếu đã xác nhận khi còn **Giữ trước ngày dự kiến (ngày)** ngày tới ngày dự kiến; 0 là giữ đúng ngày. **Phiếu ưu tiên giữ trước (ngày)** cho phiếu ưu tiên số ngày riêng; để trống thì dùng chung số ngày.

Số ngày từ 0 đến 365. Đổi cách giữ không bỏ phần đã giữ của phiếu đang mở.

## Kiểm kê theo chu kỳ
**Tần suất kiểm kê (ngày)** là số ngày giữa hai lần kiểm kê toàn kho, từ 1 đến 365. Để trống hoặc 0 là kho không kiểm kê theo chu kỳ.

- Hạn kiểm kê kế tiếp tính từ ngày duyệt phiên kiểm kê **toàn kho** gần nhất. Kho chưa kiểm kê toàn kho lần nào thì đến hạn ngay.
- Phiên kiểm kê một phần (chỉ vài mặt hàng) không dời hạn.
- Đang có phiên kiểm kê toàn kho thì kho không bị báo đến hạn.
- Màn **Tổng quan kho** liệt kê các kho có chu kỳ và báo kho đến hạn.

## Nhân viên kho
**Nhân viên kho** là những người làm việc ở kho. Chọn người trong công ty rồi bấm **Lưu**. Gán người vào kho chỉ để chọn sẵn kho cho họ; họ vẫn làm được ở kho khác như trước.

Khi lập **báo giá mới**, **phiên kiểm kê mới** hoặc **phiếu hủy mới**, ô **Kho hàng** được chọn sẵn như sau:

\`\`\`mermaid
flowchart TD
  N["Lập chứng từ mới"] --> A{"Được gán đúng một kho?"}:::kv-decision
  A -->|"Có"| K["Chọn sẵn kho đó"]:::kv-positive
  A -->|"Không"| B{"Được gán từ hai kho?"}:::kv-decision
  B -->|"Có"| T["Để trống, tự chọn"]:::kv-warning
  B -->|"Chưa gán kho nào"| C{"Công ty chỉ có một kho?"}:::kv-decision
  C -->|"Có"| K2["Chọn sẵn kho đó"]:::kv-positive
  C -->|"Không"| T2["Để trống, tự chọn"]:::kv-warning
\`\`\`

Ô để trống thì phải chọn kho mới lưu được, để không ai lập nhầm kho. Phiếu hủy mở từ một phiếu kho lấy kho của phiếu đó.`,
  en: `## What a warehouse is
Each warehouse has a name, a **short name** (it starts the warehouse's document numbers, for example **WH/KK/0001**) and how it receives and delivers goods. Creating a warehouse creates locations of its own: the main stock location, **Vendor**, **Customer**, **Scrap** and **Inventory adjustment**, and its receipt and delivery operation types. No other warehouse shares them; the **Locations** screen tells them apart by the **Warehouse** column.

## Add and edit warehouses
Select **Create** to add a warehouse. Select a warehouse in the list to edit its name, short name, **Receipt steps** (one, two or three) and **Delivery steps**. Only stock managers and the owner can edit; everyone else reads.

## Reservation
**Reserve goods for deliveries and internal transfers** chooses when the warehouse sets stock aside for a transfer. Receipts reserve nothing.

- **On confirmation**: as someone confirms the transfer.
- **Manually** (the default): only when someone selects **Reserve** on the transfer or on the Transfers list.
- **Before the scheduled date**: checked every hour, a confirmed transfer reserves by itself once its scheduled date is **Reserve days before the scheduled date** away; 0 reserves on the day. **Days before for priority transfers** gives priority transfers their own days; leave it empty to share the same days.

Days run from 0 to 365. Changing the method leaves what open transfers already hold.

## Counting on a cycle
**Count frequency (days)** is the number of days between two counts of everything the warehouse holds, from 1 to 365. Leave it empty or 0 to keep the warehouse off the cycle.

- The next count falls due that many days after the last **full** count was approved. A warehouse never counted in full is due at once.
- A partial count (of a few products) does not move the date.
- While a full count is under way, the warehouse is not reported as due.
- **Inventory overview** lists the warehouses on a cycle and reports those due.

## Warehouse staff
**Warehouse staff** are the people who work at the warehouse. Choose people of the company, then select **Save**. Assigning someone only chooses the warehouse for them; they can still work in other warehouses as before.

On a **new quotation**, **new count** or **new scrap**, the **Warehouse** field starts as follows:

\`\`\`mermaid
flowchart TD
  N["New document"] --> A{"Assigned to exactly one warehouse?"}:::kv-decision
  A -->|"Yes"| K["That warehouse is chosen"]:::kv-positive
  A -->|"No"| B{"Assigned to two or more?"}:::kv-decision
  B -->|"Yes"| T["Left empty to choose"]:::kv-warning
  B -->|"Assigned to none"| C{"Does the company have one warehouse?"}:::kv-decision
  C -->|"Yes"| K2["That warehouse is chosen"]:::kv-positive
  C -->|"No"| T2["Left empty to choose"]:::kv-warning
\`\`\`

An empty field must be filled before saving, so nobody books into the wrong warehouse by mistake. A scrap opened from a transfer takes that transfer's warehouse.`,
}

/** K62: the warehouses guide, for the list and the warehouse's modal. */
/** A list and the record modal it opens each mount a guide, so the list passes its own `id`. */
export function WarehouseHelp({ lang, id = 'stock-warehouse-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={id}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Kho hàng' : 'Warehouses'}
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
