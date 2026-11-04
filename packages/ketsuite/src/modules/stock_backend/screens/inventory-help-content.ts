// The guide (Help drawer) in Markdown, kept apart from ./inventory-help.tsx, which draws it.
export const inventoryHelp = {
  vi: {
    title: 'Tồn kho',
    source: `Màn hình này liệt kê số dư tồn kho tại các vị trí nội bộ và đang chuyển: mỗi dòng là một sản phẩm ở một vị trí, tách theo lô hoặc sê-ri khi có.

\`\`\`mermaid
flowchart TD
  A[Tìm sản phẩm,<br>vị trí, lô] --> B[Đọc tồn,<br>đã giữ, có thể dùng]
  B --> C{Số trên kệ<br>khác số này?}
  C -->|Có| D[Điều chỉnh<br>tồn kho]
  C -->|Không| E[Mở trang<br>sản phẩm]
  class D kv-warning
\`\`\`

## Đọc số dư

- **Tồn thực tế** là số đang có tại vị trí. **Đã giữ** là phần đã dành cho phiếu xuất chưa hoàn tất. **Có thể dùng** là phần còn lại; số âm nghĩa là đã giữ nhiều hơn số đang có.
- Dòng theo lô có **Hạn dùng**. Lô đã hết hạn, tới ngày ngừng xuất hoặc đang cách ly vẫn tính vào **Tồn thực tế** nhưng **Có thể dùng** là 0: không phiếu nào được giữ lô đó.
- Bộ lọc tình trạng: **Còn khả dụng**, **Đã giữ**, **Đã giữ hết** (còn hàng nhưng đã giữ cả), **Hết hàng** và **Lô hết hạn hoặc cách ly**.
- Ô tìm kiếm tìm theo sản phẩm, mã nội bộ, vị trí và lô. Bộ lọc có sản phẩm, vị trí và số có thể dùng; có thể nhóm theo vị trí.
- Bấm tên sản phẩm để mở trang sản phẩm, nếu bạn có quyền xem sản phẩm. Người không có quyền này chỉ thấy tên.
- **Ngày nhập** là lúc hàng (hoặc lô) đầu tiên vào vị trí đó, qua phiếu nhập, phiếu chuyển hay kiểm kê. Hàng nằm lâu thì ngày nhập cũ.
- Cột **Mở** của mỗi dòng: **Lịch sử** mở Lịch sử dịch chuyển của lô (hoặc mặt hàng, nếu không theo lô), khi bạn được xem lịch sử; **Bổ sung** mở quy tắc bổ sung của mặt hàng ở vị trí đó, chưa có quy tắc thì mở danh sách Bổ sung hàng tìm theo mặt hàng, khi bạn được xem quy tắc.

## Điều chỉnh sau khi đếm

**Điều chỉnh tồn kho** mở phiên kiểm kê đếm kín chỉ gồm một sản phẩm ở vị trí kho chính. Chọn sản phẩm và vị trí, rồi nhập số đếm, lý do trong phiên. Phiên đi qua **Gửi duyệt → Duyệt** bởi người khác; thao tác mở phiên không đổi tồn. Phiên đang mở có phạm vi trùng sẽ bị từ chối và nêu tên phiên đó. Mở phiên đang có để tiếp tục đếm.`,
  },
  en: {
    title: 'Inventory',
    source: `This screen lists stock balances in internal and transit locations: each row is one product in one location, split by lot or serial when there is one.

\`\`\`mermaid
flowchart TD
  A[Search product,<br>location, lot] --> B[Read on hand,<br>reserved, available]
  B --> C{Shelf differs<br>from this?}
  C -->|Yes| D[Inventory<br>adjustment]
  C -->|No| E[Open the<br>product page]
  class D kv-warning
\`\`\`

## Reading balances

- **On hand** is what the location holds. **Reserved** is set aside for deliveries not yet done. **Available** is what is left; a negative figure means more is reserved than is on hand.
- A row of a lot shows its **Expiry**. A lot past its expiry or removal date, or quarantined, still counts **On hand** but its **Available** is 0: no transfer may hold it.
- The availability filter offers **Available**, **Reserved**, **All reserved** (stock left but all of it held), **Out of stock** and **Expired or quarantined lots**.
- Search matches the product, internal reference, location and lot. Filters cover the product, the location and the available quantity, and rows can be grouped by location.
- Select a product's name to open its page, when you may read products. Without that right you see the name only.
- **In date** is when the goods (or the lot) first came into that location, by a receipt, a transfer or a count. Goods that sit long have an old in date.
- Each row's **Open** column: **History** opens the move history of the lot (or of the product when it has no lots), when you may read the history; **Replenishment** opens the product's replenishment rule at that location, or the replenishment list searched for the product when there is none, when you may read rules.

## Adjusting after a count

**Inventory adjustment** opens a blind count for one product in the warehouse's main stock location. Choose the product and location, then record quantities and reasons in the session. **Submit → Approve** requires another person; opening the session changes no stock. An overlapping open count is refused and named; open that session to continue counting.`,
  },
} as const
