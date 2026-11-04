import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Phiếu kho
Phiếu mở thành một trang riêng, dù bạn bấm vào từ danh sách **Dịch chuyển**, từ đơn bán, đơn mua hay nút **Tạo**. Đầu trang có **Về danh sách**, **In** (phiếu nhập, phiếu xuất, phiếu chuyển kho) và các lệnh theo trạng thái phiếu. Bên phải là khối **Trao đổi và hoạt động của dịch chuyển**: ghi chú, tin nhắn và hoạt động của phiếu. Màn hẹp đưa phần này xuống dưới.

Kiểm tra loại hoạt động, vị trí nguồn/đích, thời gian dự kiến và các dòng sản phẩm. Mỗi kho có loại hoạt động riêng, cùng tên với kho khác: ô chọn ghi tên kho dưới mỗi loại. Phiếu bổ sung hàng từ NCC hiển thị nhà cung cấp đã chọn. Phiếu không chứa giá mua; giá trị kho theo quy trình giá vốn.

## Hàng việc theo loại
**Phiếu nhập kho**, **Phiếu xuất kho** và **Phiếu chuyển kho** trên thanh bên mở danh sách này đã lọc theo loại phiếu; bộ lọc hiện thành chip, thêm trạng thái (ví dụ **Sẵn sàng**) để thu hẹp tiếp hoặc bỏ chip để xem mọi loại. Phiếu có năm trạng thái: **Nháp**, **Chờ hàng** (phiếu lấy hàng từ kho chưa giữ đủ), **Sẵn sàng** (đã giữ đủ hàng; phiếu nhập thì ngay khi xác nhận, vì chỉ còn chờ hàng về), **Hoàn tất** và **Đã hủy**.

## Thực hiện
Phiếu mới để trống **Tham chiếu** thì lấy số kế tiếp của kho theo loại: nhập **HCM/NK/0001**, xuất **HCM/XK/0001**, chuyển **HCM/CK/0001**. Phiếu do đơn bán, đơn mua, trả hàng, phần còn lại, bổ sung hàng hay điều chỉnh tồn tạo ra cũng đánh số như vậy. Gõ tham chiếu thì phiếu giữ tên đã gõ.

Người có quyền vận hành có thể thêm sản phẩm khi phiếu còn mở, xác nhận, giữ hàng và nhập số lượng thực hiện. Sản phẩm của phiếu nằm trong bảng **Sản phẩm**: **Thêm sản phẩm** thêm một hàng, chọn sản phẩm thì đơn vị gốc của nó tự điền và chỉ các đơn vị quy đổi được mới hiện, nhập nhu cầu rồi bấm **Lưu sản phẩm** để thêm mọi hàng mới một lần; một hàng sai thì không hàng nào được thêm. Dòng sản phẩm đã lưu không sửa ở đây. **Xác nhận**, **Giữ hàng** và **Hoàn tất** chờ tới khi các bảng đã lưu. Số lượng thực hiện gõ thẳng vào bảng **Đã lấy hàng** như bảng tính: mỗi dòng có sản phẩm, số lượng, lô và ô **Đã lấy hàng**. **Thêm dòng** để lấy thêm hoặc tách theo lô; chọn sản phẩm trước thì các ô của dòng mới mở. Ô chưa lưu tô vàng; bấm **Lưu dòng** để ghi mọi dòng một lần. Một dòng sai thì không dòng nào được ghi và lỗi hiện phía trên bảng. Nhập lô/sê-ri khi sản phẩm yêu cầu; mỗi dòng chỉ cho chọn lô của sản phẩm đó; lô bị chặn hoặc hết hạn không được xuất. **Hoàn tất** chờ tới khi các dòng đã lưu. Khi có dòng được tick **Đã lấy hàng**, phiếu chỉ tính các dòng đó; chưa tick dòng nào thì phiếu xuất đúng số đã giữ. Không có số nào để làm thì phiếu không hoàn tất và báo lỗi. Chỉ hoàn tất khi số lượng thực tế đã đúng.

## Giữ hàng
Giữ hàng là dành sẵn tồn ở vị trí nguồn cho phiếu xuất hoặc phiếu chuyển, để phiếu khác không lấy mất. Phiếu nhập không giữ hàng.

- **Cách giữ** do kho chọn ở màn **Kho hàng**. **Khi xác nhận**: giữ ngay lúc bấm **Xác nhận**. **Thủ công**: chỉ giữ khi bấm **Giữ hàng**. **Trước ngày dự kiến**: tự giữ khi còn đúng số ngày đã đặt tới ngày dự kiến. Kho chưa chọn là Thủ công. Mục **Giữ hàng** của phiếu cho biết cách giữ và, theo ngày, giữ từ ngày nào.
- **Ưu tiên**: đánh dấu khi sửa phiếu. Phiếu ưu tiên được giữ trước khi giữ nhiều phiếu một lượt; kho giữ theo ngày có thể giữ chúng sớm hơn.
- **Giữ hàng** giữ phần còn thiếu, lô hết hạn sớm trước; thiếu hàng thì phiếu chờ phần còn lại. Phiếu giao một lần khi đủ (theo đơn bán) chỉ **Sẵn sàng** khi mọi dòng đã giữ đủ; giao ngay phần có sẵn thì sẵn sàng khi đã giữ được một phần. **Bỏ giữ** trả phần đã giữ mà chưa nhặt về kho; dòng đã nhặt giữ nguyên.
- Hàng có **Theo dõi** là **Không theo dõi tồn** luôn giữ đủ và hoàn tất như hàng khác, nhưng không đổi tồn và không có giá trị kho.
- Ở danh sách **Dịch chuyển**, tích chọn nhiều phiếu rồi chọn **Giữ hàng**: phiếu ưu tiên trước, rồi ngày dự kiến sớm hơn, rồi số phiếu.
- **Hàng rảnh ra thì giữ tiếp.** Kho chọn **Khi xác nhận** hoặc **Trước ngày dự kiến** tự giữ cho phiếu đang thiếu ngay khi hoàn tất phiếu nhập hoặc phiếu chuyển tới kho, hay khi hủy một phiếu hoặc đơn bán đang giữ hàng. Thứ tự vẫn là ưu tiên, ngày dự kiến, số phiếu; kho **Trước ngày dự kiến** chỉ giữ cho phiếu còn không quá số ngày đã đặt là tới ngày dự kiến. Mỗi giờ hệ thống kiểm lại một lần, để hàng về theo cách khác (ví dụ kiểm kê) cũng tới phiếu đang thiếu. Kho **Thủ công** không tự giữ.
- Phiếu đã bấm **Bỏ giữ** không tự giữ lại nữa; mục **Giữ hàng** của phiếu ghi "đã bỏ giữ" tới khi có người bấm **Giữ hàng**.

\`\`\`mermaid
flowchart TB
  F["Nhập, chuyển tới hoặc hủy xong: hàng rảnh ra"] --> Q("Kho tự giữ và phiếu chưa Bỏ giữ?"):::kv-decision
  Q -->|"Có"| A["Giữ cho phiếu đang thiếu"]:::kv-positive
  Q -->|"Không"| W["Chờ bấm Giữ hàng"]:::kv-warning
\`\`\`

## Nhận hàng theo lô
Trong bảng **Đã lấy hàng** của phiếu nhập, sửa dòng có sẵn hoặc **Thêm dòng** cho mặt hàng. Nhập số lượng, ô **Số lô** và **Hạn dùng**, rồi bấm **Lưu dòng**. Lưu bước này chỉ giữ bản nháp nhận hàng; lô mới và tồn chỉ được ghi khi hoàn tất phiếu. Để trống số lô để cấp theo ngày nhận (yymmdd, thêm -2, -3 khi trùng); để trống hạn dùng để tính theo số tháng giữ của sản phẩm. Lô đã có giữ hạn cũ: nhập hạn khác bị từ chối. Lô mới phải có hạn sau ngày nhận; ngày cuối tháng được chặn đúng lịch. Nhập từ sản xuất đặt ngày sản xuất là ngày nhận.

Nếu để phiếu qua ngày mới, hệ thống kiểm tra lại hạn khi hoàn tất. Nếu một dòng không hợp lệ, toàn bộ lần hoàn tất chưa ghi lô hay tồn. Lô/sê-ri ở các hướng khác vẫn dùng thao tác chọn lô hiện hành.

## Giao vượt
Phiếu xuất tới khách cho nhập số thực hiện vượt nhu cầu và hiện cảnh báo. Không được dùng tồn đã giữ cho phiếu khác hoặc làm tồn âm. Phiếu nhập, chuyển nội bộ và trả hàng vẫn từ chối số vượt. Hàng theo số giao được lập hoá đơn cả phần vượt; số đặt trên đơn không tự tăng. Bảng **Dòng dịch chuyển** ghi số đã xử lý trên nhu cầu, ví dụ 3 / 2 khi giao vượt một. Phiếu hoàn tất thì đơn bán tính ngay phần đã giao, kể cả phần vượt.

## Đơn giá nhập và giá trị
Quản lý kho và chủ doanh nghiệp thấy cột **Đơn giá nhập** trên phiếu nhập từ nhà cung cấp hoặc xưởng. Phiếu từ đơn mua đã có giá theo đơn (sau chiết khấu); gõ vào ô trong bảng rồi bấm **Lưu dòng** trước khi hoàn tất. Ô trống lấy giá vốn bình quân lúc hoàn tất. Phần chưa nhận chuyển sang đơn bù kèm đơn giá đã nhập. Phiếu đã hoàn tất hiện **Giá trị** từng dòng, **Giá trị phiếu** và số bút toán Kho; người đọc được sổ cái mở bút toán từ đây. Thủ kho không thấy đơn giá hay giá trị. Kỳ kế toán đã khoá sổ thì phiếu không hoàn tất được.

## Điều chỉnh giá trị
Khi nhà cung cấp sửa giá sau khi hàng đã nhập, kế toán mở phiếu nhập đã hoàn tất và bấm **Điều chỉnh giá trị**:
- chọn mặt hàng;
- nhập số tiền, dương để tăng, âm để giảm;
- chọn tài khoản đối ứng trong cài đặt kế toán của Kho: **Hàng mua đang đi đường** khi nhà cung cấp sửa giá, **Giá vốn hàng bán** khi hàng đã bán đi, **Tài sản thừa** hoặc **Tài sản thiếu** cho chênh lệch chờ xử lý;
- ghi lý do.

Giá trị tồn và giá vốn bình quân của mặt hàng đổi ngay theo số tiền này. Khi Kho ghi sổ kế toán, sổ kho ghi một bút toán ngày hôm nay: tăng giá trị thì Nợ tài khoản Hàng hoá, Có tài khoản đã chọn; giảm thì ngược lại. Bảng **Điều chỉnh giá trị** trên phiếu liệt kê từng lần, kèm lý do và bút toán. Giá trị dòng và bản in của phiếu vẫn giữ giá lúc nhập.

Không điều chỉnh được khi công ty không còn mặt hàng đó, khi số giảm làm giá trị tồn âm, hoặc khi kỳ kế toán hôm nay đã khoá sổ. Chỉ kế toán (và chủ doanh nghiệp) thấy nút này.

## Trả hàng
Phiếu giao cho khách đã hoàn tất có lệnh **Trả hàng**. Lệnh tạo ngay phiếu nhập trả đã xác nhận, từ vị trí khách về vị trí đã xuất, cùng khách và các dòng của phiếu giao, rồi mở phiếu đó. Mỗi dòng nhận lại tối đa phần đã giao trừ phần các phiếu trả khác (chưa hủy) đã hoặc sẽ nhận; hết phần đó thì lệnh không còn hiện. Ghi nhận số thực nhận rồi hoàn tất như phiếu nhập. Hàng trả về theo đúng giá trị lúc xuất, không theo giá bình quân hiện tại, và ghi Nợ 156 / Có 632. Phiếu trả hoàn tất thì đơn bán trừ ngay số đã giao.

Khối **Thông tin** ghi đối tác là **Khách hàng** khi phiếu giao tới hoặc nhận về từ khách, và **Nhà cung cấp** khi phiếu nhận từ nhà cung cấp. Phiếu trả có dòng **Trả hàng của** mở phiếu giao; phiếu giao có dòng **Phiếu trả** cho từng phiếu trả. Cũng vậy, **Phần còn lại của** và **Phần còn lại** nối một phiếu với phiếu tạo ra khi hoàn tất thiếu.

Phiếu xuất của đơn bán (và phần còn lại của nó) theo đơn, phiếu trả theo phiếu xuất: **Sửa** chỉ đổi tham chiếu, ngày dự kiến và **Ưu tiên**, bảng **Sản phẩm** chỉ đọc. Số đã làm ghi ở **Đã lấy hàng**. Phiếu nhập không giữ hàng nên không có nút **Giữ hàng**.

\`\`\`mermaid
flowchart TB
  D["Phiếu giao đã hoàn tất"] --> R["Trả hàng: phiếu nhập trả đã xác nhận"]
  R --> C["Hoàn tất: hàng về kho theo giá trị lúc xuất"]:::kv-positive
\`\`\`

## Hủy hàng
Phiếu đã xác nhận hoặc đã hoàn tất có nút **Hủy hàng** cho người lập được phiếu hủy. Nút mở phiếu hủy mới lấy hàng ở vị trí phiếu đang giữ (nguồn khi chưa hoàn tất, đích khi đã hoàn tất) và chỉ cho chọn mặt hàng của phiếu. Phiếu hủy và phiếu điều chỉnh kiểm kê không có nút này.

Duyệt một phiên kiểm kê tạo sẵn phiếu đã hoàn tất mang số phiên: **…/XK** đưa phần thiếu ra vị trí **Điều chỉnh tồn kho**, **…/NK** đưa phần thừa vào kho. Hai phiếu này chỉ để xem; sửa sai thì kiểm kê lại.

## Hủy phiếu
Phiếu chưa hoàn tất có nút **Hủy** cho người được hủy phiếu: hộp thoại hỏi **Lý do hủy**, bỏ trống thì không hủy. Phần đã giữ trả về kho, phiếu chuyển sang **Đã hủy** và đầu trang hiện lý do. Phiếu hủy theo đơn bán hoặc luồng tự động không có lý do.

Phiếu nháp chưa có dòng nào thì **Xác nhận** tắt và trang nhắc thêm dòng trước.

## Ngày dự kiến
Ngày dự kiến là ngày kho định làm phiếu. Trên trang phiếu, ô này gọi theo việc của phiếu: **Ngày dự kiến nhập** ở phiếu nhập, **Ngày dự kiến xuất** ở phiếu xuất, **Ngày dự kiến chuyển** ở phiếu chuyển nội bộ. Danh sách phiếu và **Tổng quan kho** có nhiều loại phiếu chung một cột, nên ghi loại trước ngày: **Nhập · …**, **Xuất · …**, **Chuyển · …**. Phiếu xuất của đơn bán lấy **Ngày cam kết giao** của đơn; đơn không có ngày đó thì lấy ngày giao dự kiến, hoặc lúc xác nhận đơn. Kho giữ hàng trước ngày dự kiến thì số ngày tính lùi từ ngày này.

## Thứ tự trong danh sách
Danh sách phiếu mặc định xếp theo **Thứ tự công việc**: phiếu đã giữ đủ hàng trước, rồi phiếu đang chờ hàng, rồi phiếu nháp; trong mỗi nhóm, ngày dự kiến sớm hơn lên trước. Phiếu đã hoàn tất hoặc đã hủy xuống cuối, mới nhất trước.

## Chi phí mua kho
Phiếu nhập đã hoàn tất, có giá trị (không phải phiếu khách trả hàng) có nút **Thêm chi phí mua kho** cho quản lý kho, kế toán và chủ doanh nghiệp. Nút mở phiếu chi phí mới có sẵn phiếu nhập này để cộng phí vận chuyển, bốc xếp hay thuế vào giá vốn. Người xem được giá trị tồn kho thấy mục **Chi phí mua kho** ở thanh bên: mỗi phiếu chi phí trên phiếu nhập này (phiếu đã bỏ thì không), kèm số đã cộng vào phiếu nhập khi đã ghi sổ.

## In phiếu
**In phiếu** mở trang in của phiếu (in bằng lệnh In của trình duyệt, Ctrl/⌘ + P, hoặc lưu thành PDF): phiếu nhập theo mẫu 01-VT, phiếu xuất theo mẫu 02-VT, phiếu chuyển kho. Bản in có đối tác và địa chỉ (ưu tiên địa chỉ giao hàng), chứng từ gốc, kho, rồi từng sản phẩm với số lô, hạn dùng, số yêu cầu và số thực tế. Phiếu chưa hoàn tất in lô đã giữ và để trống số thực tế để ghi tay; phiếu nhập đang mở in số lô và hạn dùng đã nhập. Cuối phiếu có bốn ô ký. **Quay lại phiếu kho** đưa về phiếu.

Người được xem giá trị tồn kho thấy thêm **In kèm giá trị** khi phiếu đã hoàn tất: đơn giá, thành tiền từng lô theo giá trị đã ghi sổ, tổng cộng và số tiền viết bằng chữ. Người khác không thấy bản này.

## Quyền trên trang phiếu
Trang phiếu chỉ hiện các lệnh được cấp quyền. Thủ kho, quản lý kho và chủ doanh nghiệp lập, xác nhận, hoàn tất, hủy phiếu và trả hàng; duyệt kiểm kê, phiếu hủy hàng và đơn giá nhập là của quản lý kho và chủ doanh nghiệp. Khối trao đổi chỉ hiện khi được đọc lịch sử trao đổi; thiếu khối này không có nghĩa là phiếu không có lịch sử.

## Kết quả
Phiếu hoàn tất ghi dịch chuyển tồn. Nếu còn thiếu và tạo backorder, phiếu tiếp theo giữ NCC của phiếu gốc. Phiếu hoàn tất hoặc đã hủy không sửa trực tiếp. Quyền chỉ xem không có lệnh ghi. Khi bị từ chối, kiểm tra lỗi tại trường và tải lại nếu tồn hoặc trạng thái đã đổi.`,
  en: `## Stock transfer
A transfer opens on its own page, whether from the **Transfers** list, a sales or purchase order, or **Create**. The top of the page has **Back to list**, **Print** (receipt, delivery slip or internal transfer) and the commands its state allows. On the right, **Transfer conversation and activities** holds its notes, messages and activities. On a narrow screen it moves below.

Check the operation type, source/destination, scheduled date and product lines. Each warehouse has its own operation types, named like another's: the picker shows the warehouse under each. Supplier replenishment receipts identify the selected supplier. Receipts contain no purchase price; stock valuation follows the cost process.

## Queues by kind
**Receipts**, **Deliveries** and **Internal transfers** in the sidebar open this list filtered by operation kind; the filter shows as a chip, so add a state (for example **Ready**) to narrow it further or remove the chip to see every kind. A transfer has five statuses: **Draft**, **Waiting** (one taking goods from stock that does not hold them all yet), **Ready** (everything held; a receipt as soon as it is confirmed, since it only waits for the goods to arrive), **Done** and **Cancelled**.

## Execute
A new transfer with a blank **Reference** takes the warehouse's next number of its kind: receipts **HCM/NK/0001**, deliveries **HCM/XK/0001**, internal transfers **HCM/CK/0001**. Transfers made by sales and purchase orders, returns, backorders, replenishment or stock adjustments are numbered the same way. A typed reference stays.

Operators may add products while open, confirm, reserve stock and enter completed quantities. The transfer's products are in the **Products** table: **Add product** adds a row, choosing the product fills in its own unit and offers only the units it converts into, and after entering the demand **Save products** adds every new row at once; if one row is refused, none is added. Saved product lines are not edited here. **Confirm**, **Reserve** and **Validate** wait until the tables are saved. Completed quantities are typed straight into the **Picked** table as in a spreadsheet: each line has its product, quantity, lot and **Picked** cell. **Add line** picks more or splits by lot; choose the product first and the line's other cells open. Unsaved cells are yellow; **Save lines** writes every line at once. If one line is refused, none is written and the error shows above the table. Supply lots/serials when required; each line offers only its product's lots; blocked or expired lots cannot ship. **Validate** waits until the lines are saved. When some lines are ticked **Picked**, only those count; with none ticked the transfer goes as held. With nothing to do, the transfer is not completed and an error says so. Complete only after checking actual quantities.

## Reservation
Reserving sets stock aside at the source for a delivery or an internal transfer, so other transfers cannot take it. Receipts reserve nothing.

- **How** is the warehouse's choice on **Warehouses**. **On confirmation**: as you select **Confirm**. **Manually**: only when someone selects **Reserve**. **Before the scheduled date**: by itself, the set number of days before the scheduled date. A warehouse that never chose reserves manually. The transfer's **Reservation** says how and, by date, from which day.
- **Priority**: tick it when editing the transfer. Priority transfers take goods first when several are reserved together, and a warehouse reserving by date may reserve them earlier.
- **Reserve** takes what is still missing, soonest-expiring lots first; a shortage leaves the transfer waiting for the rest. A delivery shipping at once when complete (from its sales order) is **Ready** only when every line is held in full; one shipping what is there is ready once part is held. **Unreserve** gives back what is held but not yet picked; picked lines stay.
- Goods whose **Tracking** is **No inventory tracking** are always held in full and complete like any other, but change no stock and carry no stock value.
- On the **Transfers** list, tick several transfers and choose **Reserve**: priority first, then soonest scheduled, then by number.
- **Freed goods move on.** A warehouse reserving **On confirmation** or **Before the scheduled date** reserves for short transfers as soon as a receipt or a transfer into the warehouse is validated, or a transfer or sales order holding goods is cancelled. The order is still priority, scheduled date, number; a **Before the scheduled date** warehouse only serves transfers within its set days of their scheduled date. Every hour it checks again, so goods that arrive another way (a count, say) also reach short transfers. A **Manually** warehouse never reserves by itself.
- A transfer someone selected **Unreserve** on is not reserved by itself again; its **Reservation** says "unreserved" until someone selects **Reserve**.

\`\`\`mermaid
flowchart TB
  F["Received, transferred in or cancelled: goods freed"] --> Q("Reserves by itself and not unreserved?"):::kv-decision
  Q -->|"Yes"| A["Reserve for short transfers"]:::kv-positive
  Q -->|"No"| W["Wait for Reserve"]:::kv-warning
\`\`\`

## Receive lot-tracked goods
In the receipt's **Picked** table, edit a line or **Add line** for the product. Enter the quantity, **Lot number** and **Expiry date**, then select **Save lines**. Saving only prepares the receipt; new lots and stock are written together when completing it. Leave the number blank for a receipt-day number (yymmdd, then -2, -3); leave expiry blank to use product shelf-life months. An existing lot keeps its expiry, and a conflicting date is refused. A new lot needs expiry after the receipt day; month ends are clamped to the calendar. Production receipts set manufacture date to the receipt day.

Expiry is checked again at completion, including drafts saved on earlier days. One invalid line rolls back all lot and stock writes. Serial tracking and other transfer directions keep the existing lot-selection workflow.

## Overdelivery
Customer deliveries accept completed quantities above demand and show a warning. They cannot consume another transfer's reserved stock or make stock negative. Receipts, internal transfers and returns still reject excess quantities. Delivery-based invoicing includes the excess; the ordered quantity does not increase automatically. The **Stock moves** table reads the handled quantity over the demand, such as 3 / 2 when one extra ships. Once the transfer is done, its sales order counts what was delivered, excess included.

## Unit cost and value
Stock managers and the owner see a **Unit cost** column on supplier and production receipts. A receipt from a purchase order already carries the order's discounted price; type in its cell and select **Save lines** before completion. A blank cell takes the average cost at completion. Quantity left for a backorder keeps the unit cost entered. A completed transfer shows each line's **Value**, the **Transfer value** and its stock journal entry, which ledger readers can open from here. Storekeepers see neither unit costs nor values. A locked accounting period refuses completion.

## Adjust valuation
When the vendor corrects a price after the goods came in, an accountant opens the completed receipt and selects **Adjust valuation**:
- choose the product;
- enter the amount, positive to raise, negative to lower;
- choose the counterpart account from Stock's accounting settings: **Goods in transit** for a vendor price correction, **Cost of goods sold** when the goods have been sold on, **Surplus** or **Shortage** for a difference awaiting a decision;
- give the reason.

The product's stock value and average cost move by the amount at once. When stock posts to the books, the stock journal posts an entry dated today: raising debits the Goods account and credits the account chosen, lowering does the reverse. The **Valuation adjustments** table on the receipt lists each one with its reason and entry. The line values and the printed receipt keep what the goods came in at.

An adjustment is refused when the company holds none of the product, when lowering would take the stock value below nought, or when today's accounting period is locked. Only accountants (and the owner) see the button.

## Returns
A completed delivery to a customer offers **Return**. It creates a confirmed return receipt from the customer location back to where the goods left, with the same customer and lines, and opens it. Each line takes back at most what was delivered less what other returns (not cancelled) took or will take; once nothing is left the command no longer shows. Record what arrived and complete it like a receipt. Returned goods come back at the value they left with, not at today's average, debiting 156 and crediting 632. Once the return is done, the sales order reduces its delivered quantity.

The **Information** block names the partner **Customer** when the transfer goes to or comes back from a customer, and **Vendor** when it receives from a supplier. A return has **Return of**, opening its delivery; the delivery lists each **Return**. Likewise **Backorder of** and **Backorder** link a transfer with the one its partial completion created.

A sales order's delivery (and what is left of it) follows the order, and a return follows its delivery: **Edit** changes only the reference, the scheduled date and **Priority**, and the products table only reads. Record what was done in **Picked**. A receipt holds nothing, so it has no **Reserve**.

\`\`\`mermaid
flowchart TB
  D["Completed delivery"] --> R["Return: confirmed return receipt"]
  R --> C["Complete: goods back at the value they left with"]:::kv-positive
\`\`\`

## Scrap
A confirmed or completed transfer offers **Scrap** to whoever may draft scrap orders. It opens a new scrap order that takes goods from where the transfer holds them (its source until it is done, its destination after) and offers only its products. Scrap transfers and count adjustments do not offer it.

Approving a physical count makes done transfers named after the count: **…/XK** takes shortages to the **Inventory adjustment** location and **…/NK** brings excesses in. They are for reading only; to correct one, count again.

## Cancel a transfer
A transfer that is not done offers **Cancel** to whoever may cancel transfers: the dialog asks for a **Reason** and nothing is cancelled without one. What was reserved returns to stock, the transfer becomes **Cancelled** and its page shows the reason. Transfers cancelled with their sales order or by an automatic flow carry no reason.

A draft with no lines has **Confirm** turned off and the page asks for a line first.

## Scheduled date
The scheduled date is when the warehouse plans to carry out the transfer. On a transfer page the field says what is planned: **Scheduled receipt date** on a receipt, **Scheduled delivery date** on a delivery, **Scheduled transfer date** on an internal transfer. The transfer list and the **Stock overview** hold every kind in one column, so they put the kind before the date: **Receipt · …**, **Delivery · …**, **Transfer · …**. A sales order's delivery takes the order's **Committed delivery date**, or else its expected delivery date or the moment it was confirmed. A warehouse that reserves before the scheduled date counts its days back from this date.

## Order of the list
The transfer list sorts by **Work order** by default: transfers with their goods reserved first, then those waiting for goods, then drafts; within each, the earlier scheduled date first. Done and cancelled transfers come last, newest first.

## Landed costs
A completed receipt that carries a value (not a customer return) offers **Add landed cost** to a stock manager, an accountant and the owner. It opens a new landed cost already on this receipt, to add freight, handling or duty to what the goods cost. A reader of stock value sees **Landed costs** in the rail: each cost on this receipt, cancelled ones aside, with what it added to the receipt once posted.

## Print
**Print** opens the transfer's print page (print it with the browser's Print command, Ctrl/⌘ + P, or save it as PDF): a receipt as template 01-VT, a delivery as template 02-VT, or an internal transfer note. It shows the partner and address (the delivery address first), the source document, the warehouse, then each product with its lot numbers, expiry dates, demand and done quantities. An open transfer prints the lots reserved for it and leaves the done quantity blank to write in by hand; an open receipt prints the lot numbers and expiry dates entered. Four signature boxes close the page. **Back to the transfer** returns to it.

Who may read stock value also gets **Print with values** once the transfer is done: unit cost and amount per lot as booked, the total and the total in words. Others do not see that copy.

## Permissions on the transfer page
The page shows only authorized commands. Storekeepers, stock managers and the owner create, confirm, validate and cancel transfers and take returns; approving counts, scraps and receipt unit costs is for stock managers and the owner. The conversation appears only with permission to read its timeline; an absent panel does not mean the transfer has no history.

## Results
Completion records stock movements. A backorder retains the original supplier. Completed or cancelled transfers cannot be edited directly. Viewers have no write commands. On refusal, review field errors and reload if stock or state has changed.`,
}

/** A list and the transfer page each mount a guide, so the list passes its own `id`. */
export function TransferHelp({ lang, id = 'stock-transfer-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={id}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Phiếu kho' : 'Stock transfer'}
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
