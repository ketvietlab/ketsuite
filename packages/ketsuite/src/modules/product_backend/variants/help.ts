import { filterHelp } from '../filters/help.tsx'
// The Variants screen's guide (Help drawer), in Markdown. It describes the list in
// ./island.tsx and the read in ./read.ts; change it with them.

export const variantsHelp = {
  vi: {
    title: 'Biến thể sản phẩm',
    source: `**Xuất CSV** giữ bộ lọc/sắp xếp hiện tại, xuất mọi trang kết quả và các cột của danh sách. Người không đọc giá vốn không có cột giá vốn; cột tồn kho theo quyền đọc kho. Tên tệp bắt đầu product-.

Mỗi dòng là một **biến thể**: đúng mặt hàng mà dòng đơn bán, phiếu kho, lô và hóa đơn ghi tên. Sản phẩm có nhiều cỡ, màu thì có nhiều biến thể; sản phẩm một loại thì có đúng một.

\`\`\`mermaid
flowchart TB
  T[Sản phẩm<br>Áo thun] --> S[Biến thể<br>Áo thun · Nhỏ]
  T --> L[Biến thể<br>Áo thun · Lớn]
\`\`\`

## Tìm và lọc

- Ô tìm kiếm tìm theo mã nội bộ, barcode, tên sản phẩm hoặc giá trị thuộc tính, không cần gõ dấu; danh sách lọc ngay khi bạn ngừng gõ.
- **Loại** chọn hàng hoá hoặc dịch vụ; **Nhóm sản phẩm** lấy sản phẩm trong nhóm đã chọn và mọi nhóm con của nó.
- **Thẻ** áp dụng cho mọi SKU của sản phẩm, kể cả thẻ đã lưu trữ. Tìm tên thẻ có hoặc không dấu.
- **Đang bán**, **Ngừng bán**, **Tất cả** chọn theo trạng thái. Biến thể ngừng bán khi chính nó hoặc sản phẩm của nó được lưu trữ.
- Bấm tiêu đề cột **Sản phẩm** hoặc **Mã nội bộ** để đổi thứ tự.

## Các cột

- **Sản phẩm**: tên sản phẩm, bên dưới là các giá trị làm biến thể khác những biến thể cùng sản phẩm (Nhỏ, Lớn); biến thể ngừng bán có thêm nhãn **Ngừng bán**.
- **Giá bán**: giá riêng của biến thể nếu có, nếu không là giá sản phẩm cộng phụ thu của các giá trị. Bảng giá tính từ con số này.
- **Giá vốn**: giá vốn hiện tại của công ty; chỉ hiện với vai trò được xem giá vốn.
- **Tồn thực tế** và **Khả dụng** cộng mọi kho đang dùng của công ty; khả dụng là tồn thực tế trừ hàng đã giữ. Dấu — nghĩa là sản phẩm không theo dõi tồn kho.

## Mở biến thể

Bấm một dòng để mở trang của sản phẩm chứa biến thể đó; mã, barcode, giá và tình trạng bán của từng biến thể sửa ở thẻ **Biến thể** trên trang ấy. Nút quay lại đưa bạn về đúng dòng vừa mở.

${filterHelp.vi.source}`,
  },
  en: {
    title: 'Product variants',
    source: `**Export CSV** retains current filters and sorting and exports every result page with this list’s columns. Cost is omitted without cost-read permission; stock columns follow stock-read permission. The filename starts with product-.

Each row is one **variant**: the very item a sales order line, a stock operation, a lot and an invoice name. A product in several sizes or colours has several variants; a product of one kind has exactly one.

\`\`\`mermaid
flowchart TB
  T[Product<br>T-shirt] --> S[Variant<br>T-shirt · Small]
  T --> L[Variant<br>T-shirt · Large]
\`\`\`

## Search and filter

- The search box looks in internal references, barcodes, product names and attribute values, accents optional; the list filters as soon as you stop typing.
- **Type** picks goods or services; **Product group** includes products in the selected category and all its descendants.
- **Tag** applies to all SKUs of the product, including archived tags. Search tag names with or without accents.
- **Selling**, **Not selling** and **All** choose by status. A variant stops selling when it or its product is archived.
- Select the **Product** or **Internal reference** column header to change the order.

## Columns

- **Product**: the product's name, with the values that tell the variant apart from its siblings (Small, Large) under it; a variant not selling is labelled **Not selling**.
- **Sales price**: the variant's own price when it has one, otherwise the product price plus its values' extras. Pricelists start from this figure.
- **Cost**: the company's current cost; shown only to roles that may see costs.
- **On hand** and **Available** add up every active warehouse of the company; available is on hand less what is reserved. A dash means the product keeps no stock.

## Opening a variant

Select a row to open the page of the product the variant belongs to; each variant's reference, barcode, price and selling status are edited on its **Variants** card. The way back returns you to the row you opened.

${filterHelp.en.source}`,
  },
}
