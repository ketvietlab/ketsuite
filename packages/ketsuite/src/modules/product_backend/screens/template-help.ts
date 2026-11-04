// The product page's screen guide (Help drawer), in Markdown. It describes the page in
// modal/product-modal-view.tsx and the reads composed by product-workspace-context.ts;
// change it with them.

export const templatePageHelp = {
  vi: {
    title: 'Trang sản phẩm',
    source: `**Cảnh báo khi bán** trong nhóm Kinh doanh chỉ hiện khi công ty bật cấu hình cảnh báo và bạn có quyền đọc cấu hình này. Người sửa danh mục nhập tối đa 300 ký tự rồi lưu cùng sản phẩm. Các biến thể và quà tặng dùng chung lời nhắc; cảnh báo không chặn giao dịch. Khi cấu hình tắt, lưu sản phẩm không xoá cảnh báo đã có.

**Lịch sử nhập** liên kết các receipt đã tạo hoặc xử lý sản phẩm này; bản ghi chỉ đọc giữ dữ liệu nguồn, số dòng và thay đổi thực tế. Giá vốn được che theo quyền đọc.

**Giao cho khách sau (ngày)** ở thẻ Kho & vận chuyển, mục Vận chuyển, nhận từ 0 đến 365; để trống tương đương 0. Người có quyền sửa danh mục được chỉnh; mọi biến thể dùng chung giá trị này. Báo giá và đơn bán dùng số ngày của hàng hóa để tính ngày dự kiến giao, không tính dịch vụ.

Trang sản phẩm gom những gì cần để bán một mặt hàng. Dải số liệu trên cùng cho biết **Tồn kho** (tồn thực tế trừ phần đã giữ), **Sắp nhập**, **Đã bán 30 ngày** và **Biên lợi nhuận**. Bấm vào số để mở dự báo tồn kho hoặc đơn bán lọc theo sản phẩm. Số liệu tồn chỉ có khi sản phẩm theo dõi tồn kho, số đã bán chỉ có khi vai trò của bạn xem được đơn bán. Biên hiện "—" khi chưa có giá vốn; bấm vào để tới ô Giá vốn.

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

**Cơ sở lập hoá đơn** trong thẻ Kế toán là giá trị đã lưu: theo số lượng đặt hoặc số lượng giao. Đây là thông tin chỉ đọc trên trang sản phẩm, hiển thị khi bạn có quyền xem Bán hàng; thay đổi tại Bán hàng → Chính sách lập hoá đơn. Combo lập hoá đơn theo từng món nên không có chính sách riêng. Tài khoản, số liệu kho, doanh thu và giá vốn hiển thị theo từng quyền tương ứng; thiếu quyền không được diễn giải thành số 0.

## Sửa thông tin

**Sản phẩm Combo:** chọn loại khi tạo rồi chọn 1–10 lựa chọn combo đang dùng và đơn vị bán. Loại bị khóa sau khi lưu. Giá bán là giá một combo; nhóm có thể để trống, thuế và tài khoản theo cấu hình sản phẩm. Combo không có thuộc tính, biến thể, tồn kho, giá vốn riêng hay đóng gói. Muốn khôi phục sản phẩm, hãy khôi phục các lựa chọn đã lưu trữ trước. Trên báo giá, mỗi lựa chọn tạo một dòng món; giao hàng và hóa đơn theo món. Chọn món trong đơn bán, không phải Điểm bán hay báo giá trực tuyến.

**Chọn biến thể khi bán** trong Thông tin chung mặc định **Trên dòng hàng**. Chọn **Lưới số lượng** để sản phẩm có ít nhất hai SKU hoạt động xuất hiện trong menu **Chọn biến thể** trên đơn bán. Combo luôn dùng dòng hàng. Thứ tự thuộc tính trong trình chỉnh sửa quyết định cột rồi hàng khi có hai thuộc tính; từ ba thuộc tính dùng danh sách biến thể.

Các thẻ Thông tin chung, Giá & lợi nhuận và Kho & vận chuyển là một biểu mẫu: **Lưu thay đổi** ở đầu trang lưu tất cả. Lỗi hiện dưới đúng trường cần sửa.

- Giá nhập theo VND: dấu chấm phân tách nghìn, dấu phẩy trước phần thập phân (0,25). Giá so sánh phải cao hơn giá bán. Mã HS gồm 4 đến 10 chữ số.
- **Tài khoản ghi sổ:** phần Kế toán chỉ hiện khi bạn được xem tài khoản. Để trống để dùng tài khoản của nhóm gần nhất có cấu hình, rồi tới mặc định công ty. Người có quyền tài khoản sản phẩm có thể chọn tài khoản riêng; tài khoản chỉ định trên chứng từ luôn ưu tiên. Hai tài khoản được lưu cùng các trường khác trong một giao dịch.
- Giá vốn, theo dõi tồn kho, barcode và mã HS thuộc quyền của vai trò khác: barcode và mã HS do người thiết lập kho sửa, như trên từng biến thể. Thiếu quyền thì trường bị khoá, kèm lý do. Vai trò không có quyền **Giá vốn** sẽ không thấy giá vốn, biên lợi nhuận, doanh thu và giá nhà cung cấp.
- **Cách theo dõi tồn:** không theo dõi tồn thì không ghi số dư kho; theo số lượng giữ tổng số lượng; theo lô tách số lượng theo từng lô. Đổi cách theo dõi không tự gán lô cho tồn cũ. Kiểm kê, đối chiếu số lượng và lô trước khi thay đổi thiết lập.
- Khi bất kỳ biến thể nào còn tồn hoặc hàng đang giữ ở vị trí nội bộ/trung chuyển, không thể đổi cách theo dõi tồn. Giá vốn của biến thể cũng bị khoá khi còn tồn. Xử lý hàng đang giữ và đưa tồn về 0 trước; dữ liệu đã lưu vẫn giữ nguyên nếu thao tác bị từ chối.
- Thuế bán không đặt ở trang này: Kế toán cấu hình thuế cho sản phẩm.
- **Loại và đơn vị tính** bị khoá sau khi tạo, để số lượng đã ghi giữ nguyên nghĩa. Hộp, thùng và các quy cách khác gắn ở mục **Đơn vị quy đổi & đóng gói**.
- Nếu người khác vừa lưu sản phẩm này, lần lưu của bạn bị từ chối. Tải lại trang rồi nhập lại thay đổi.
- **Thêm ảnh** ở thẻ Hình ảnh: chọn hoặc kéo ảnh vào, ảnh hiện ngay để bạn kiểm tra. Ảnh chỉ được lưu khi bấm **Tải ảnh lên**.

## Nhà cung cấp

Trên sản phẩm đang dùng, **Có thể mua** và không phải combo, bảng **Nhà cung cấp** có tối đa 20 dòng. Chọn đối tác (nhà cung cấp hiện trước), mọi biến thể hoặc một biến thể, mã NCC tối đa 40 ký tự, số lượng tối thiểu, giá mua và số ngày giao 0–365. Số lượng và giá theo đơn vị sản phẩm. Kéo dòng để đổi ưu tiên rồi bấm **Lưu nhà cung cấp**; lỗi hoặc xung đột giữ nguyên nội dung đang nhập. Nút lưu này tách khỏi **Lưu thay đổi** của sản phẩm.

Chủ doanh nghiệp, trưởng kinh doanh và quản lý kho được sửa bảng. Không có quyền giá vốn thì không thấy cột giá. Dòng đầu đạt số lượng tối thiểu được chọn; không dòng nào đạt thì dùng dòng hợp lệ đầu tiên. Nhân bản sản phẩm không chép nhà cung cấp.

## Tồn theo kho

Bảng **Tồn theo kho** cho biết ở từng kho: tồn thực tế, phần đã giữ, tồn kho (thực tế trừ đã giữ), sắp nhập, sắp xuất và mức tồn tối thiểu/tối đa. Sắp nhập và sắp xuất chỉ tính phiếu đã xác nhận.

**Đặt mức tồn** đặt mức cho từng biến thể ở một kho. Chỉ nhập tối thiểu thì tối đa bằng tối thiểu; chỉ nhập tối đa thì tối thiểu là 0. Xoá cả hai thì bỏ mức tồn của biến thể ở kho đó. Mức tồn nằm ở vị trí chứa hàng của kho và tính theo đơn vị của sản phẩm. Khi tồn kho xuống dưới tối thiểu, mục **Cần xử lý** báo kho thiếu nhiều nhất.

## Hạn dùng của lô
**Hạn dùng (tháng)** nhận 1–120 tháng. Ba khoảng ngày tốt nhất, ngừng xuất và cảnh báo được tính lùi từ hạn dùng. Đây là mặc định cho lô mới; đổi cấu hình không sửa lô đã tạo. Các trường này vẫn sửa được khi có tồn, với quyền cấu hình kho. Ngày ngừng xuất được dùng để ưu tiên giữ hàng theo FEFO.

## Đơn vị quy đổi & đóng gói

**Lưới đóng gói:** tối đa 20 dòng, chọn đơn vị cùng cây quy đổi và phạm vi **Mọi biến thể** hoặc một biến thể. Sản phẩm chỉ có một biến thể không cần chọn phạm vi. Barcode GS1 chỉ xác định một biến thể; ô barcode khóa khi chọn mọi biến thể của sản phẩm nhiều biến thể. Dòng mới không được lặp hay chồng phạm vi. Lưới lưu cùng nút **Lưu thay đổi** của sản phẩm; lỗi giữ bản nháp và toàn bộ lần lưu được hoàn tác. Quyền cấu hình kho quyết định ai sửa được lưới. Đổi thứ tự hoặc gỡ dòng vẫn là bản nháp cho đến khi lưu.

Đơn vị chung và barcode riêng từ cấu hình trước được giữ, kèm thông báo khi phạm vi chồng nhau. Không tự chuyển dữ liệu hoặc đổi barcode; xóa dòng bỏ liên kết và barcode của dòng đó. Chứng từ cũ giữ đơn vị đã ghi. **Quản lý đơn vị tính** mở màn cấu hình quy đổi.

**Các nút thao tác riêng:** nếu trang hiển thị nút thêm/gỡ đóng gói thay cho lưới, các thao tác dưới đây lưu riêng từng lần.

Mục này liệt kê các quy cách bạn gắn cho sản phẩm (hộp, thùng…), mỗi dòng kèm số lượng tính theo đơn vị của sản phẩm.

- **Thêm đơn vị đóng gói** chọn một đơn vị đang dùng, cùng nhóm với đơn vị tính của sản phẩm và chưa gắn. Sản phẩm không có biến thể thì nhập luôn mã vạch của quy cách đó.
- **Sửa mã vạch** đổi mã vạch của một quy cách; để trống là bỏ mã. Mã vạch không được trùng mã của sản phẩm hay của quy cách khác.
- Sản phẩm có biến thể: mã vạch theo từng quy cách nhập trong hộp thoại sửa biến thể.
- **Gỡ** bỏ quy cách khỏi sản phẩm, cùng mã vạch của quy cách đó trong công ty đang chọn.
- Chưa có quy cách cần dùng? **Quản lý đơn vị tính** mở màn Đơn vị tính để tạo. Gắn một đơn vị vào sản phẩm sẽ khoá quy đổi của đơn vị đó.

## Biến thể

**Cấu hình thuộc tính** mở các dòng thuộc tính. Chọn thuộc tính có sẵn hoặc đặt tên thuộc tính mới, chọn hoặc thêm giá trị, và nhập phụ thu cho từng giá trị (số âm để giảm giá). Mỗi tổ hợp giá trị là một biến thể, tối đa 50 biến thể.

- **Áp dụng** lưu mọi dòng trong một lần: chỉ cần một dòng lỗi là không có gì thay đổi.
- Thêm thuộc tính cho sản phẩm đã có biến thể: các biến thể đó nhận giá trị đầu tiên của thuộc tính mới và giữ mã, barcode, tồn.
- Lần đầu thêm thuộc tính: SKU đang có trở thành tổ hợp đầu tiên, giữ nguyên mã, barcode, tồn và lịch sử. Tổ hợp mới nhận mã tự động từ mã sản phẩm thêm A, B, C…, bỏ qua mã đã có trong công ty, kể cả mã đã ngừng dùng.
- Bỏ một giá trị: biến thể chưa từng dùng ở đâu bị xoá và trả lại mã; biến thể đã có trên chứng từ thì chuyển sang ngừng dùng, chọn lại giá trị đó thì biến thể quay lại với mã cũ.
- Biến thể còn tồn hoặc hàng đang giữ, hoặc còn trên báo giá, đơn, phiếu kho, hóa đơn chưa hoàn tất thì không bỏ được: thông báo nêu tên biến thể và không có gì thay đổi.
- Bỏ hết thuộc tính: một SKU đang có ở lại làm sản phẩm không biến thể.

Bấm vào một dòng biến thể để đổi mã, barcode, mã HS, cân nặng, thể tích, giá vốn, giá bán riêng, hoặc ngừng bán riêng biến thể đó. Mỗi người sửa nhóm của mình như trên trang: người quản lý danh mục sửa mã, giá bán riêng, cân nặng, thể tích và trạng thái; quản lý kho sửa barcode và mã HS; kế toán sửa giá vốn. Các ô còn lại chỉ để xem. Biến thể không có giá riêng bán theo giá sản phẩm cộng phụ thu của các giá trị; có giá riêng thì giá đó thay thế, và bảng giá tính từ giá này. Giá cố định của bảng giá đặt cho cả sản phẩm vẫn cộng phụ thu của từng biến thể; giá cố định đặt cho một biến thể là giá bán của biến thể đó. Mã HS gồm 4–10 chữ số (dấu chấm và khoảng trắng được bỏ) và cần quyền thiết lập tồn kho. Ngừng bán cũng theo điều kiện tồn và chứng từ như trên, và phải còn ít nhất một biến thể đang dùng; muốn ngừng bán hẳn thì lưu trữ sản phẩm. Barcode mới phải có 8, 12, 13 hoặc 14 chữ số và đúng số kiểm tra GS1. Barcode SKU và đóng gói dùng chung một danh mục mã trong công ty. Barcode cũ được giữ khi sửa thông tin khác. Hai biến thể không được trùng barcode, và barcode không được trùng với sản phẩm khác.

## Cột bên phải

**Cần xử lý** liệt kê các việc cần làm: hết hàng, dưới tồn tối thiểu, giá bán thấp hơn giá vốn, biến thể đang bán chưa có barcode. **Độ hoàn thiện** đếm ảnh, mô tả, mã, barcode, danh mục, giá vốn (với vai trò xem được giá) và cân nặng (với hàng hoá). Bấm một mục còn thiếu để tới trường đó.

## Thẻ của module khác

Module khác có thể thêm thẻ vào trang, ví dụ chu kỳ sử dụng sản phẩm hay bản đăng trên kênh bán, cùng thẻ Hoạt động. Mỗi thẻ đó có nút lưu riêng, không đi theo **Lưu thay đổi**.

## Nhân bản và lưu trữ

Mã khi tạo hoặc đổi gồm 2–20 chữ cái, số hoặc gạch ngang, bắt đầu bằng chữ hoặc số, và được lưu bằng chữ hoa (gõ "kd-02" thành "KD-02"); không trùng mẫu hay biến thể nào trong công ty, kể cả đã lưu trữ. Mã cũ được giữ khi sửa trường khác; khi đổi phải theo quy tắc mới. Không xóa mã đang có.

**Nhân bản** mở trang tạo đã điền sẵn thông tin, giá bán, cách theo dõi tồn kho, hạn dùng và tài khoản ghi sổ riêng của sản phẩm nguồn. Bạn sửa nội dung rồi bấm **Tạo sản phẩm**; mở trang hoặc rời đi chưa tạo bản ghi. Khi bạn được cấu hình thuộc tính, các dòng thuộc tính và phụ thu cũng được sao chép, và biến thể được tạo lại với mã mới ngay sau khi tạo sản phẩm. Khi bạn được thiết lập kho, mã HS của sản phẩm và của từng biến thể cũng được giữ theo đúng tổ hợp giá trị. Mã, barcode, ảnh, giá vốn, giá riêng của biến thể và thuế không được sao chép.

**Lưu trữ** cần lý do (tối đa 500 ký tự), ẩn mẫu và các biến thể khỏi danh sách chọn mới nhưng giữ tồn và chứng từ đã có. Sản phẩm còn trên báo giá nháp/đã gửi hoặc phiếu kho chưa hoàn tất phải được xử lý trước. **Khôi phục** đưa mẫu và các biến thể còn hợp lệ trở lại, không đưa tổ hợp đã bỏ trở lại. **Lịch sử trạng thái** ở cột bên phải giữ 20 lần gần nhất cùng thời điểm và lý do; các lần cũ vẫn được giữ trong dữ liệu. Lưu trữ từ danh sách áp dụng cho toàn bộ lựa chọn, hoặc không sản phẩm nào khi một sản phẩm bị từ chối.`,
  },
  en: {
    title: 'Product page',
    source: `**Sales warning** in the business group appears when the company enables Sales warnings and your role can read that setting. Catalogue editors enter up to 300 characters and save it with the product. Variants and gifts share the note; it never blocks a transaction. Saving a product while warnings are off preserves its existing note.

**Import history** links the receipts that created or processed this product. Read-only records retain the source, row count and actual changes; cost is hidden according to read permission.

**Customer lead time (days)** in the Inventory & shipping card, under Shipping, accepts 0–365; blank means 0. Catalogue editors may change it and every variant shares the value. Quotations and sales orders use goods lead times for expected delivery dates; services do not contribute.

The product page gathers what you need to sell one item. The figures on top show **Available** (on hand minus what is reserved), **Incoming**, **Sold in 30 days** and **Margin**. Select a figure to open the stock forecast or the sales orders for this product. Stock figures appear only when the product tracks stock; sales figures only when your role may read sales orders. The margin shows "—" until a cost is entered; select it to reach the Cost field.

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

**Invoicing Policy** in Accounting is the saved ordered-quantity or delivered-quantity policy. It is read-only on this page and requires Sales read access; change it in Sales → Invoicing Policies. Combos invoice their selected items and have no separate policy. Accounts, stock figures, revenue and costs follow their respective grants; missing access does not mean zero.

## Editing

**Combo products:** choose the type at creation, then select 1–10 active combo choices and a sales unit. The type is fixed after saving. The sales price is for one combo; category is optional, while tax and accounts follow product configuration. Combos have no attributes, variants, stock, separate cost or packaging. Restore archived choices before restoring their product. On quotations, each choice creates an item line; deliveries and invoices use the items. Select items on the sales order, not in POS or online quotations.

**Variant selection when selling** in General information defaults to **On order lines**. Choose **Quantity matrix** to show a product with at least two active SKUs in the sales order’s **Choose variants** menu. Combos always use order lines. Attribute editor order determines columns then rows for two attributes; three or more use a variant list.

The General information, Pricing & margin and Inventory & shipping cards are one form: **Save changes** at the top saves all of them. Errors appear under the field to correct.

- Prices are in VND. Use a comma between thousands and a dot before decimals (0.25). The compare-at price must be above the sale price. An HS code has 4 to 10 digits.
- **Posting accounts:** Accounting appears only when you may read accounts. Leave an override blank to use the nearest configured category, then company defaults. A user with product-account permission may choose an override; an explicit document account takes priority. Both accounts save in the same transaction as the other record fields.
- The cost, stock tracking, barcode and HS code belong to other roles: the barcode and HS code are set by whoever sets up stock, as on each variant. Without the right, the field is locked and says why. A role without the **Cost** permission sees no cost, margin, revenue or vendor price.
- **Inventory tracking:** no inventory tracking keeps no stock balance; quantity tracking keeps total quantities; lot tracking separates quantities by lot. Changing the setup does not assign lots to existing stock. Count and reconcile quantities and lots before changing the setup.
- Stock tracking is locked while any variant has stock or reservations in internal/transit locations. A variant's cost is also locked while it has stock. Resolve reservations and clear the positions first; a refused save leaves the whole record unchanged.
- The sales tax is not set on this page: accounting sets a product's tax.
- The **type and unit of measure** are locked after creation, so recorded quantities keep their meaning. Boxes, cartons and other packagings are linked under **Units & packagings**.
- If someone else has just saved this product, your save is refused. Reload the page and enter your change again.
- **Add image** on the Media card: choose or drop a picture and it shows at once so you can check it. It is saved only when you select **Upload image**.

## Suppliers

An active, purchasable product that is not a combo supports up to 20 supplier rows. Choose a partner (suppliers appear first), all variants or one variant, a vendor code of up to 40 characters, minimum quantity, purchase price and 0–365 lead days. Quantities and prices use the product unit. Drag rows to set priority, then choose **Save suppliers**. Refusals and conflicts retain your draft; this save is separate from the product's **Save changes**.

Company administrators, sales managers and warehouse managers can edit the grid. Without cost access the price column is hidden. The first eligible row meeting its minimum wins; otherwise the first eligible row is used. Duplicating a product does not copy suppliers.

## Stock by warehouse

The **Stock by warehouse** table shows, for each warehouse, on hand, reserved, available, incoming, outgoing and the minimum and maximum stock. Incoming and outgoing count confirmed transfers only.

**Set stock levels** sets the levels of each variant at one warehouse. A minimum alone makes the maximum equal to it; a maximum alone makes the minimum 0. Clearing both removes the variant's levels at that warehouse. Levels sit at the warehouse's stock location and use the product's unit. When availability drops below the minimum, **Needs attention** names the warehouse furthest below.

## Lot shelf life
**Shelf life (months)** accepts 1–120 months. Best-before, removal and alert offsets count backwards from expiry. These are defaults for new lots; changes preserve existing lot dates. Stock configuration permission can update these defaults even when stock exists. Reservations prioritize removal dates using FEFO.

## Units & packagings

**Packaging grid:** up to 20 rows, with a unit from the same conversion tree and **All variants** or one variant. Single-variant products hide that choice. A GS1 barcode identifies one variant; its cell is locked for an all-variants row of a multi-variant product. New rows cannot duplicate or overlap scopes. The grid saves with the product’s **Save changes** button; failures retain the draft and roll back the entire save. Stock-setup permission controls editing. Reordering or removing rows remains a draft until saved.

Existing shared units and variant barcodes are retained, with a notice when scopes overlap. Nothing is migrated or recoded implicitly; removing a row removes its link and barcode. Existing documents keep their recorded units. **Manage units of measure** opens conversion settings.

**Individual actions:** when the page offers add/remove packaging actions instead of the grid, the actions below save separately.

This lists the packagings linked to the product (boxes, cartons…), each with its quantity in the product's unit.

- **Add packaging** picks an active unit of the same family as the product's unit that is not linked yet. A product without variants takes the packaging's barcode at once.
- **Edit barcode** changes a packaging's barcode; leave it empty to remove it. No other product or packaging may have the same barcode.
- A product with variants: each variant's packaging barcodes are entered in the variant's edit dialog.
- **Remove** unlinks the packaging, with its barcodes in the selected company.
- Missing a packaging? **Manage units of measure** opens the Units of measure screen to create it. Linking a unit to a product fixes that unit's conversion.

## Variants

**Configure attributes** opens the product's attribute rows. Choose an existing attribute or name a new one, choose or add values, and enter an extra price for each value (negative to lower the price). Each combination of values is a variant, up to 50 variants.

- **Apply** saves every row at once: one row in error and nothing changes.
- Adding an attribute to a product that already has variants gives those variants the attribute's first value; they keep their reference, barcode and stock.
- The first time you add attributes, the existing SKU becomes the first combination and keeps its reference, barcode, stock and history. New combinations get a reference made from the product's reference plus A, B, C…, skipping references already used in the company, archived ones included.
- Removing a value: a variant never used anywhere is deleted and its reference freed; a variant that appears on documents is archived instead, and choosing the value again brings it back with its reference.
- A variant with stock or reservations, or on a quotation, order, stock operation or invoice that is not finished, cannot be removed: the message names the variant and nothing changes.
- Removing every attribute keeps one existing SKU as the product without variants.

Select a variant row to change that variant's reference, barcode, HS code, weight, volume, cost or own sale price, or to stop selling it. Each person edits their own group, as on the page: whoever manages the catalogue edits the reference, own price, weight, volume and status; the stock manager edits the barcode and HS code; the accountant edits the cost. The other fields are shown read only. A variant without its own price sells at the product price plus its values' extras; its own price replaces that, and pricelists start from it. A pricelist's fixed price for the whole product still adds each variant's extras; a fixed price for one variant is that variant's price. HS codes have 4–10 digits (dots and spaces are dropped) and need stock setup permission. Stopping sales follows the same stock and document conditions, and at least one variant must stay active; to stop selling the product entirely, archive it. New barcodes must have 8, 12, 13 or 14 digits and a valid GS1 check digit. SKUs and packagings share one barcode namespace per company; unchanged legacy barcodes remain intact. Two variants may not share a barcode, nor may a variant use another product's barcode.

## Right column

**Needs attention** lists what to do: out of stock, below minimum stock, a price below cost, selling variants without a barcode. **Completeness** counts the image, description, reference, barcode, category, cost (for roles that may see costs) and weight (for goods). Select a missing item to reach its field.

## Cards from other modules

Other modules may add cards to the page, such as a product's usage cycle or its sales channel listings, along with Activity. Each of those cards saves on its own, not with **Save changes**.

## Duplicate and archive

New or changed codes use 2–20 letters, digits or hyphens, start with a letter or digit and are saved in capitals ("kd-02" becomes "KD-02"); they must be unique across this company's templates and variants, including archived records. Existing legacy codes stay when other fields change; changing them applies the new rules. An assigned code cannot be cleared.

**Duplicate** opens a create page prefilled with the source's information, price, inventory setup, shelf life and own posting accounts. Edit them before selecting **Create product**. Opening or leaving this page writes nothing. When you may configure attributes, the attribute rows and extras are copied too, and the variants are created again with fresh references right after the product is created. When you may set up stock, the product's HS code and each variant's HS code for the same values are kept too. References, barcodes, images, costs, variant prices and taxes are not copied.

**Archive** requires a reason (up to 500 characters) and archives the template and all its variants together, keeping stock and existing documents intact. Resolve draft/sent quotations and unfinished stock operations first. **Restore** reactivates valid variants while keeping dropped combinations dormant. **Status history** in the rail shows the latest 20 changes and archive reasons; older events stay in storage. A list selection is archived together, or no products change when any selected product is refused.`,
  },
} as const
