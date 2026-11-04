import { filterHelp } from '../filters/help.tsx'
// The product list's screen guide (Help drawer), in Markdown. It describes the list in
// ./island.tsx and the read in ./read.ts; change it with them.

export const productListHelp = {
  vi: {
    title: 'Sản phẩm',
    source: `**Nhập** mở bản ghi nhập để dán bảng có tiêu đề (500 dòng/256 KiB); một dòng lỗi thì hoàn tác cả lần. **Xuất CSV** xuất mọi kết quả theo bộ lọc hiện tại và các cột của danh sách, gồm biên lợi nhuận chỉ khi có quyền. Tệp có tiền tố product-. Muốn sửa rồi nhập lại, dùng Tải danh sách sản phẩm để sửa trong bản ghi nhập.

Màn hình này là nơi tìm, lọc và mở sản phẩm để sửa. Mỗi dòng có ảnh chính, tên và mã của sản phẩm. Bấm một dòng để mở trang sản phẩm; nút quay lại trên trang đó đưa bạn về đúng dòng vừa mở, với bộ lọc như cũ.

\`\`\`mermaid
flowchart TD
  A[Tìm theo tên,<br>mã, barcode] --> B[Lọc và nhóm]
  B --> C[Mở sản<br>phẩm]
  C --> D[Quay lại<br>đúng dòng]
  B --> E[Chọn<br>nhiều dòng]
  E --> F{Lưu trữ<br>hay xoá?}
  F --> G[Xác nhận]
  class D kv-positive
\`\`\`

## Tìm và lọc

- Ô tìm kiếm tìm theo tên, mô tả, mã và barcode của mọi biến thể. Danh sách lọc ngay khi bạn ngừng gõ.
- **Loại** chọn hàng hoá hoặc dịch vụ. **Công dụng** chọn **Có thể bán**, **Có thể mua**, **Không bán** hoặc **Theo lô**. **Trạng thái** có **Bao gồm đã lưu trữ**; khi có module Kho, **Hết hàng** giữ lại các sản phẩm theo dõi tồn mà không còn gì để bán. Các điều kiện trong **Trạng thái** cùng áp dụng một lúc.
- **Thẻ** lọc theo mã thẻ ổn định, kể cả thẻ đã lưu trữ. Tìm tên thẻ có hoặc không dấu; đổi tên không làm mất bộ lọc đã lưu.
- Điều kiện nhóm sản phẩm lấy cả nhóm con: chọn **bằng** hoặc **một trong** để lấy cả cây; **khác** loại cả cây. Bộ lọc lưu giữ ID nhóm, nên vẫn đúng khi nhóm đổi tên hoặc được dời.
- **Nhóm** theo nhóm sản phẩm, loại, đơn vị, trạng thái hay ngày tạo, tối đa bốn cấp. Bấm tên nhóm để mở hoặc thu gọn.
- **Đã lưu** giữ bộ lọc đang dùng để mở lại sau; bộ lọc đặt làm mặc định tự áp dụng khi bạn vào danh sách.
- Bấm tiêu đề cột để sắp xếp; bấm lần nữa để đảo chiều.

Mọi lựa chọn nằm trên địa chỉ trang: gửi đường dẫn cho người khác là họ thấy đúng danh sách đó, và nút Back của trình duyệt quay lại lựa chọn trước.

## Các cột

- **Tồn kho**: tồn thực tế trừ phần đã giữ, cộng mọi kho đang hoạt động. Chỉ có khi cài module Kho; sản phẩm không theo dõi tồn hiện "—".
- **Giá bán**: giá của sản phẩm trước bảng giá. Khi các biến thể có giá khác nhau (phụ thu hoặc giá riêng), cột ghi **Từ** và giá thấp nhất trong các biến thể đang bán. Sắp xếp theo cột này dùng đúng giá hiển thị đó.
- **Biên LN**: biên lợi nhuận trên giá bán của từng biến thể đang bán, theo giá vốn của chúng. Chỉ vai trò có quyền **Giá vốn** mới thấy cột này; "—" là chưa có giá vốn.
- **Biến thể**: số biến thể đang bán; "—" khi sản phẩm không có thuộc tính.
- **Trạng thái**: **Đang bán**, **Không bán** (bỏ chọn *Có thể bán* trên trang sản phẩm) hoặc **Lưu trữ**.

**Dạng thẻ** hiện cùng danh sách thành thẻ có ảnh lớn, tiện khi duyệt theo hình.

## Thao tác hàng loạt

Ở dạng bảng, chọn tối đa 200 sản phẩm trên trang này rồi bấm **Sửa hàng loạt** để chọn một trường và giá trị mới. Quyền và kiểm tra giống trang sản phẩm; một lỗi hủy cả nhóm, giá trị đã đúng không ghi lại. Phiếu SUA xuất hiện trong lịch sử các sản phẩm đổi.

Chọn **Lưu trữ** hoặc **Xoá** để đổi vòng đời. Hệ thống hỏi lại trước khi làm.

- **Lưu trữ** ẩn sản phẩm khỏi bán và mua nhưng giữ tồn và lịch sử. Mở sản phẩm và bấm **Khôi phục** để dùng lại.
- **Xoá** không hoàn tác được. Sản phẩm đã dùng trong đơn hay phiếu kho không xoá được; khi đó không sản phẩm nào bị xoá và danh sách báo lỗi. Hãy lưu trữ thay vì xoá.

## Khi danh sách không tải được

Danh sách cũ vẫn hiện, kèm thông báo và nút **Thử lại**. Khi mất mạng, danh sách tự tải lại lúc có mạng trở lại. Nếu vai trò của bạn không được xem sản phẩm, danh sách báo không có quyền; hãy nhờ quản trị viên cấp quyền.

${filterHelp.vi.source}`,
  },
  en: {
    title: 'Products',
    source: `**Import** opens a pasted import record (500 rows/256 KiB); one invalid row rolls back the batch. **Export CSV** exports all filtered results with this list’s columns, including margin only with permission. Filenames start with product-. To edit and reimport, use Download products to edit in a new import record.

This screen is where you find, filter and open products to edit them. Each row shows the product's main image, name and code. Select a row to open the product's page; the way back on that page returns you to the same row, with the same filters.

\`\`\`mermaid
flowchart TD
  A[Search by name,<br>code, barcode] --> B[Filter and group]
  B --> C[Open a<br>product]
  C --> D[Back to the<br>same row]
  B --> E[Select<br>several rows]
  E --> F{Archive<br>or delete?}
  F --> G[Confirm]
  class D kv-positive
\`\`\`

## Search and filter

- The search field matches the name, the description, and the code and barcode of every variant. The list narrows as soon as you stop typing.
- **Type** picks goods or services. **Use** offers **Can be sold**, **Can be purchased**, **Not sold** and **Tracked by lot**. **Status** includes **Include archived**; with the Inventory module installed, **Out of stock** keeps the stock-tracked products that have nothing left to sell. The conditions under **Status** apply together.
- **Tags** filters stable tag IDs, including archived tags. Search tag names with or without accents; renaming preserves saved filters.
- Category conditions include descendants: **equals** or **any of** includes the subtree; **not equals** excludes it. Saved filters retain category IDs and follow renames or moves.
- **Group by** category, type, unit, status or creation date, up to four levels. Select a group's name to expand or collapse it.
- **Saved** keeps the filters in use so you can open them again; a saved filter set as the default applies when you open the list.
- Select a column header to sort by it; select it again to reverse the order.

Every choice is in the page's address: share the link and others see the same list, and the browser's Back button returns to your previous choice.

## Columns

- **Available**: stock on hand less what is reserved, across every active warehouse. Only with the Inventory module; a product that does not track stock shows "—".
- **Sales price**: the product's price before pricelists. When its variants sell at different prices (extras or their own price), the column reads **From** and the lowest price among the variants on sale. Sorting by this column uses that same price.
- **Margin**: profit margin on each selling variant's own sales price, from their cost. Only roles with the **Cost** permission see this column; "—" means no cost is known yet.
- **Variants**: the variants on sale; "—" for a product without attributes.
- **Status**: **Selling**, **Not for sale** (*Can be sold* cleared on the product page) or **Archived**.

**Cards** shows the same list as cards with large images, for browsing by picture.

## Bulk actions

In the table, select up to 200 products on this page and choose **Bulk edit**, then a field and new value. The same product-page permissions and validation apply. One refusal rolls back the whole selection; matching values remain untouched. Changed products show SUA history.

Choose **Archive** or **Delete** to change lifecycle. You are asked to confirm first.

- **Archive** hides products from selling and buying but keeps their stock and history. Open a product and choose **Restore** to use it again.
- **Delete** cannot be undone. Products already used on an order or a stock transfer cannot be deleted; then no product is deleted and the list says so. Archive them instead.

## When the list does not load

The last list stays on screen with a notice and **Try again**. When the connection drops, the list loads again once it is back. If your role may not view products, the list says so; ask an administrator for access.

${filterHelp.en.source}`,
  },
} as const
