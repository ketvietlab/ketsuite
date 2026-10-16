// The product page's screen guide (Help drawer), in Markdown. It describes the page in
// modal/product-modal-view.tsx and the reads composed by product-workspace-context.ts;
// change it with them.

export const templatePageHelp = {
  vi: {
    title: 'Trang sản phẩm',
    source: `Trang sản phẩm gom những gì cần để bán một mặt hàng. Dải số liệu trên cùng cho biết **Tồn kho** (tồn thực tế trừ phần đã giữ), **Sắp nhập**, **Đã bán 30 ngày** và **Biên lợi nhuận**. Bấm vào số để mở dự báo tồn kho hoặc đơn bán lọc theo sản phẩm. Số liệu tồn chỉ có khi sản phẩm theo dõi tồn kho, số đã bán chỉ có khi vai trò của bạn xem được đơn bán. Biên hiện "—" khi chưa có giá vốn; bấm vào để tới ô Giá vốn.

\`\`\`mermaid
flowchart TD
  A[Tạo sản phẩm] --> B{Nhiều phiên bản?}
  B -- Có --> C[Cấu hình thuộc tính]
  C --> D[Sửa từng biến thể]
  B -- Không --> E[Mã, barcode, giá vốn]
  D --> F[Đặt mức tồn theo kho]
  E --> F
  F --> G[Xử lý mục Cần xử lý]
  class G kv-positive
\`\`\`

## Sửa thông tin

Các thẻ Thông tin chung, Giá & lợi nhuận và Kho & vận chuyển là một biểu mẫu: **Lưu thay đổi** ở đầu trang lưu tất cả. Lỗi hiện dưới đúng trường cần sửa.

- Giá nhập theo VND: dấu chấm phân tách nghìn, dấu phẩy trước phần thập phân (0,25). Giá so sánh phải cao hơn giá bán. Mã HS gồm 6 đến 10 chữ số.
- Giá vốn và theo dõi tồn kho thuộc quyền của vai trò khác. Thiếu quyền thì trường bị khoá, kèm lý do. Vai trò không có quyền **Giá vốn** sẽ không thấy giá vốn, biên lợi nhuận, doanh thu và giá nhà cung cấp.
- Thuế bán không đặt ở trang này: Kế toán cấu hình thuế cho sản phẩm.
- **Đơn vị tính** bị khoá khi sản phẩm đã có tồn hoặc phiếu kho, để số lượng đã ghi giữ nguyên nghĩa. Hộp, thùng và các quy cách khác gắn ở mục **Đơn vị quy đổi & đóng gói**.
- Nếu người khác vừa lưu sản phẩm này, lần lưu của bạn bị từ chối. Tải lại trang rồi nhập lại thay đổi.
- **Thêm ảnh** ở thẻ Hình ảnh: chọn hoặc kéo ảnh vào, ảnh hiện ngay để bạn kiểm tra. Ảnh chỉ được lưu khi bấm **Tải ảnh lên**.

## Tồn theo kho

Bảng **Tồn theo kho** cho biết ở từng kho: tồn thực tế, phần đã giữ, tồn kho (thực tế trừ đã giữ), sắp nhập, sắp xuất và mức tồn tối thiểu/tối đa. Sắp nhập và sắp xuất chỉ tính phiếu đã xác nhận.

**Đặt mức tồn** đặt mức cho từng biến thể ở một kho. Chỉ nhập tối thiểu thì tối đa bằng tối thiểu; chỉ nhập tối đa thì tối thiểu là 0. Xoá cả hai thì bỏ mức tồn của biến thể ở kho đó. Mức tồn nằm ở vị trí chứa hàng của kho và tính theo đơn vị của sản phẩm. Khi tồn kho xuống dưới tối thiểu, mục **Cần xử lý** báo kho thiếu nhiều nhất.

## Đơn vị quy đổi & đóng gói

Mục này liệt kê các quy cách bạn gắn cho sản phẩm (hộp, thùng…), mỗi dòng kèm số lượng tính theo đơn vị của sản phẩm.

- **Thêm đơn vị đóng gói** chọn một đơn vị đang dùng, cùng nhóm với đơn vị tính của sản phẩm và chưa gắn. Sản phẩm không có biến thể thì nhập luôn mã vạch của quy cách đó.
- **Sửa mã vạch** đổi mã vạch của một quy cách; để trống là bỏ mã. Mã vạch không được trùng mã của sản phẩm hay của quy cách khác.
- Sản phẩm có biến thể: mã vạch theo từng quy cách nhập trong hộp thoại sửa biến thể.
- **Gỡ** bỏ quy cách khỏi sản phẩm, cùng mã vạch của quy cách đó trong công ty đang chọn.
- Chưa có quy cách cần dùng? **Quản lý đơn vị tính** mở màn Đơn vị tính để tạo. Gắn một đơn vị vào sản phẩm sẽ khoá quy đổi của đơn vị đó.

## Biến thể

**Cấu hình thuộc tính** mở các dòng thuộc tính. Chọn thuộc tính có sẵn hoặc đặt tên thuộc tính mới, chọn hoặc thêm giá trị, và nhập phụ thu cho từng giá trị (số âm để giảm giá). Mỗi tổ hợp giá trị là một biến thể, tối đa 256 biến thể.

- **Áp dụng** lưu mọi dòng trong một lần: chỉ cần một dòng lỗi là không có gì thay đổi.
- Thêm thuộc tính cho sản phẩm đã có biến thể: các biến thể đó nhận giá trị đầu tiên của thuộc tính mới và giữ mã, barcode, tồn.
- Lần đầu thêm thuộc tính: phiên bản không thuộc tính tạm ngừng bán và quay lại nếu bạn bỏ hết thuộc tính. Tồn đang có của nó vẫn nằm ở phiên bản đó.

Bấm vào một dòng biến thể để đổi mã, barcode, cân nặng, thể tích, giá vốn, hoặc ngừng bán riêng biến thể đó. Hai biến thể không được trùng barcode, và barcode không được trùng với sản phẩm khác.

## Cột bên phải

**Cần xử lý** liệt kê các việc cần làm: hết hàng, dưới tồn tối thiểu, giá bán thấp hơn giá vốn, biến thể đang bán chưa có barcode. **Độ hoàn thiện** đếm ảnh, mô tả, mã, barcode, danh mục, giá vốn (với vai trò xem được giá) và cân nặng (với hàng hoá). Bấm một mục còn thiếu để tới trường đó.

## Thẻ của module khác

Module khác có thể thêm thẻ vào trang, ví dụ chu kỳ sử dụng sản phẩm hay bản đăng trên kênh bán, cùng thẻ Hoạt động. Mỗi thẻ đó có nút lưu riêng, không đi theo **Lưu thay đổi**.

## Nhân bản và lưu trữ

**Nhân bản** tạo sản phẩm mới cùng thông tin, giá bán và cách theo dõi tồn kho. Bản sao không mang theo mã, barcode, ảnh, biến thể, giá vốn và thuế. **Lưu trữ** ẩn sản phẩm khỏi danh sách đang dùng nhưng giữ tồn và lịch sử; **Khôi phục** đưa sản phẩm trở lại.`,
  },
  en: {
    title: 'Product page',
    source: `The product page gathers what you need to sell one item. The figures on top show **Available** (on hand minus what is reserved), **Incoming**, **Sold in 30 days** and **Margin**. Select a figure to open the stock forecast or the sales orders for this product. Stock figures appear only when the product tracks stock; sales figures only when your role may read sales orders. The margin shows "—" until a cost is entered; select it to reach the Cost field.

\`\`\`mermaid
flowchart TD
  A[Create the product] --> B{Several versions?}
  B -- Yes --> C[Configure attributes]
  C --> D[Edit each variant]
  B -- No --> E[Reference, barcode, cost]
  D --> F[Set stock levels]
  E --> F
  F --> G[Clear Needs attention]
  class G kv-positive
\`\`\`

## Editing

The General information, Pricing & margin and Inventory & shipping cards are one form: **Save changes** at the top saves all of them. Errors appear under the field to correct.

- Prices are in VND. Use a comma between thousands and a dot before decimals (0.25). The compare-at price must be above the sale price. An HS code has 6 to 10 digits.
- The cost and stock tracking belong to other roles. Without the right, the field is locked and says why. A role without the **Cost** permission sees no cost, margin, revenue or vendor price.
- The sales tax is not set on this page: accounting sets a product's tax.
- The **unit of measure** is locked once the product has stock or stock moves, so recorded quantities keep their meaning. Boxes, cartons and other packagings are linked under **Units & packagings**.
- If someone else has just saved this product, your save is refused. Reload the page and enter your change again.
- **Add image** on the Media card: choose or drop a picture and it shows at once so you can check it. It is saved only when you select **Upload image**.

## Stock by warehouse

The **Stock by warehouse** table shows, for each warehouse, on hand, reserved, available, incoming, outgoing and the minimum and maximum stock. Incoming and outgoing count confirmed transfers only.

**Set stock levels** sets the levels of each variant at one warehouse. A minimum alone makes the maximum equal to it; a maximum alone makes the minimum 0. Clearing both removes the variant's levels at that warehouse. Levels sit at the warehouse's stock location and use the product's unit. When availability drops below the minimum, **Needs attention** names the warehouse furthest below.

## Units & packagings

This lists the packagings linked to the product (boxes, cartons…), each with its quantity in the product's unit.

- **Add packaging** picks an active unit of the same family as the product's unit that is not linked yet. A product without variants takes the packaging's barcode at once.
- **Edit barcode** changes a packaging's barcode; leave it empty to remove it. No other product or packaging may have the same barcode.
- A product with variants: each variant's packaging barcodes are entered in the variant's edit dialog.
- **Remove** unlinks the packaging, with its barcodes in the selected company.
- Missing a packaging? **Manage units of measure** opens the Units of measure screen to create it. Linking a unit to a product fixes that unit's conversion.

## Variants

**Configure attributes** opens the product's attribute rows. Choose an existing attribute or name a new one, choose or add values, and enter an extra price for each value (negative to lower the price). Each combination of values is a variant, up to 256 variants.

- **Apply** saves every row at once: one row in error and nothing changes.
- Adding an attribute to a product that already has variants gives those variants the attribute's first value; they keep their reference, barcode and stock.
- The first time you add attributes, the version without attributes stops selling, and comes back if you remove every attribute. The stock it holds stays with it.

Select a variant row to change that variant's reference, barcode, weight, volume or cost, or to stop selling it. Two variants may not share a barcode, nor may a variant use another product's barcode.

## Right column

**Needs attention** lists what to do: out of stock, below minimum stock, a price below cost, selling variants without a barcode. **Completeness** counts the image, description, reference, barcode, category, cost (for roles that may see costs) and weight (for goods). Select a missing item to reach its field.

## Cards from other modules

Other modules may add cards to the page, such as a product's usage cycle or its sales channel listings, along with Activity. Each of those cards saves on its own, not with **Save changes**.

## Duplicate and archive

**Duplicate** creates a new product with the same information, sale price and stock tracking. The copy has no reference, barcode, images, variants, cost or tax. **Archive** hides the product from the active list while keeping its stock and history; **Restore** brings it back.`,
  },
} as const
