import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Tổng quan kho dùng để làm gì
Màn này cho biết việc kho đang chờ: số liệu chính, từng kho, việc cần làm và kho đến hạn kiểm kê.

## Chọn kho và số liệu
- Công ty có nhiều kho thì **Kho hàng** ở đầu trang chọn một kho hoặc **Tất cả kho**; địa chỉ trang giữ kho đã chọn.
- Các ô: **Phiếu nhập chờ nhận** (đã xác nhận, chưa nhận), **Phiếu xuất sẵn sàng**, **Phiếu xuất chờ hàng** (kèm số trễ hẹn), **Mặt hàng cần bổ sung**, **Lô sắp hết hạn** (kèm số lô đã hết hạn còn tồn), **Kiểm kê chờ duyệt** và **Giá trị tồn**. Mỗi ô bằng đúng số dòng của danh sách nó mở, đã lọc theo kho; ô bằng 0 không mở gì.
- Ô chỉ hiện khi bạn được đọc danh sách của nó; **Giá trị tồn** chỉ cho người được xem giá trị kho.

## Theo kho
Mỗi kho một dòng: mặt hàng còn tồn, phiếu nhập và phiếu xuất đang mở, số phiếu trễ hẹn, mặt hàng cần bổ sung và giá trị (người xem giá trị). Bấm một dòng để mở **Tồn kho** của kho đó.

## Việc cần làm
- Bảng **Việc cần làm** liệt kê phiếu đã xác nhận trễ hẹn hoặc đến hạn trong 7 ngày, trễ nhất trước; phiếu trễ ghi **trễ hẹn**. Phiếu nháp không ở đây. Bấm một phiếu để mở nó; **Dịch chuyển** mở toàn bộ danh sách.
- **Tạo mới** tạo phiếu kho, khi bạn được phép.

## Các màn Kho nằm ở đâu
Thanh bên giữ việc hằng ngày: **Tồn kho**, **Lô hàng**, rồi ba hàng việc **Phiếu nhập kho**, **Phiếu xuất kho**, **Phiếu chuyển kho** (cùng danh sách phiếu, lọc sẵn theo loại; **Tất cả phiếu kho** bỏ lọc), sau đó bổ sung hàng, kiểm kê, hủy hàng, dự báo và các báo cáo. Kho hàng, vị trí, loại hoạt động, tuyến cung ứng và kế toán kho là cấu hình: mở bằng bánh răng cuối thanh ứng dụng, khối **Kho**.

## Kiểm kê theo chu kỳ
Phần này hiện với người xem được kiểm kê, khi có kho đặt **Tần suất kiểm kê**.

- Mỗi kho có chu kỳ cho biết ngày duyệt phiên kiểm kê toàn kho gần nhất và hạn kế tiếp.
- **Đến hạn** khi đã tới hạn mà chưa có phiên kiểm kê toàn kho nào đang mở; ô **Kho đến hạn kiểm kê** đếm các kho đó.
- Kho đang kiểm kê toàn kho có cột **Tình trạng** nêu số phiên đang mở; bấm dòng để mở phiên. Bấm kho khác để mở kho và sửa tần suất.
- Đặt tần suất ở màn **Kho hàng**. Bắt đầu kiểm kê ở màn **Kiểm kê**.`,
  en: `## What the inventory overview is for
This screen shows what the warehouses have waiting: the key figures, each warehouse, what to do and warehouses due for a count.

## Choosing a warehouse and the figures
- With several warehouses, **Warehouse** at the top picks one or **All warehouses**; the page address keeps the choice.
- The tiles: **Receipts to receive** (confirmed, not yet received), **Deliveries ready**, **Deliveries waiting** (with how many are late), **Products to replenish**, **Lots expiring soon** (with expired lots still on hand), **Counts to approve** and **Stock value**. Each equals the rows of the list it opens, narrowed to the warehouse; a tile at 0 opens nothing.
- A tile shows only when you may read its list; **Stock value** only for those who may see stock value.

## By warehouse
One row per warehouse: products in stock, open receipts and deliveries, late transfers, products to replenish and value (for those who see value). Select a row to open that warehouse's **On hand**.

## To do
- **To do** lists confirmed transfers that are late or due within 7 days, the most overdue first; late ones say **late**. Drafts are not here. Select one to open it; **Transfers** opens the whole list.
- **Create** makes a transfer, when you may.

## Where the Inventory screens live
The sidebar keeps daily work: **Stock**, **Lots**, then three queues, **Receipts**, **Deliveries** and **Internal transfers** (the same transfer list, filtered by kind; **All transfers** drops the filter), then replenishment, counts, scrap, forecast and the reports. Warehouses, locations, operation types, routes and stock accounting are configuration: open them from the gear at the bottom of the app rail, block **Inventory**.

## Counting on a cycle
This part shows to viewers of physical counts when a warehouse has a **Count frequency**.

- Each warehouse on a cycle shows the day its last full count was approved and the day the next one falls due.
- It is **Due** once that day has come and no full count of it is open; the **Warehouses due for a count** tile counts them.
- For a warehouse with a full count under way, **Status** names the open count; select the row to open it. Select any other warehouse to open it and change its frequency.
- Set the frequency on **Warehouses**. Start a count on **Physical counts**.`,
}

/** The inventory overview guide. */
export function OverviewHelp({ lang }: { lang: 'vi' | 'en' }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id="stock-overview-help"
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Tổng quan kho' : 'Inventory overview'}
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
