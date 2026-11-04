export const pricelistHelp = {
  vi: {
    title: 'Bảng giá và đóng gói',
    source: `Mở **Cấu hình → Bảng giá** (bánh răng trên rail): bảng giá là cấu hình bán hàng nên không nằm trên thanh bên.

## Tìm bảng giá

Danh sách tải từng trang, mặc định 50 bảng giá. Dùng ô tìm kiếm, bộ lọc trạng thái, điều kiện tuỳ chỉnh hoặc nhóm theo trạng thái/tiền tệ; có thể lưu tìm kiếm để dùng lại. Chọn tiêu đề cột tên/thứ tự để sắp xếp, dùng Trước/Sau để đổi trang. Nút Quay lại của trình duyệt khôi phục bộ lọc; đóng bản ghi trở về danh sách đang xem. Khi tải lỗi hoặc ngoại tuyến, kết nối lại và chọn Thử lại.

## Lập quy tắc giá

Người có quyền cấu hình Pricing sửa thông tin và các dòng quy tắc trong cùng một lần **Lưu**. Dùng **Thêm quy tắc**, sửa ô hoặc xóa dòng trên lưới. Nếu một dòng sai, toàn bộ lần lưu được hoàn tác và giữ bản nháp. Khi có người sửa trước, tải lại bảng giá trước khi nhập lại. Người chỉ có quyền xem đọc được bảng giá nhưng không thấy lệnh ghi.

1. Chọn phạm vi: biến thể, mẫu sản phẩm, nhóm sản phẩm hoặc tất cả sản phẩm.
2. Với biến thể hoặc mẫu sản phẩm, chọn **Đóng gói** đã bật cho sản phẩm. Để trống nếu quy tắc dùng cho mọi đơn vị. Khi đổi sản phẩm hoặc phạm vi, chọn lại đóng gói.
3. Nhập **Số lượng tối thiểu** theo đơn vị dòng bán hàng: 3 thùng là 3, không phải số chai trong thùng.
4. Chọn giá cố định, chiết khấu phần trăm hoặc công thức rồi lưu. Lỗi hiện ở trường liên quan và giữ nội dung đang nhập.

## Giá nào được dùng?

Biến thể ưu tiên hơn mẫu sản phẩm, rồi nhóm sản phẩm và tất cả sản phẩm. Trong các quy tắc theo nhóm còn hiệu lực và đủ số lượng, nhóm gần sản phẩm nhất thắng trước khi xét số lượng tối thiểu. Trong cùng phạm vi, quy tắc đúng đóng gói ưu tiên hơn quy tắc không chỉ định đóng gói; sau đó xét số lượng tối thiểu.

**Giá cố định có đóng gói là giá một gói.** Giá cố định của mẫu sản phẩm cộng phụ thu biến thể nhân số đơn vị trong gói. Quy tắc không chọn đóng gói đổi giá cố định từ đơn vị gốc sang đơn vị dòng bán. Giá nhập trực tiếp trên dòng bán là giá đã thương lượng cho một gói.

Chiết khấu tính trên giá niêm yết hoặc giá ròng của bảng giá gốc; dòng bán hiện đơn giá gốc và % CK riêng. Công thức còn được tính trên giá vốn: trừ CK từ −1000 đến 100% (âm là tăng giá), làm tròn nửa xa 0 tới bội đã chọn, cộng phụ phí nguyên đồng, rồi chặn kết quả dưới 0. Công thức hiện CK 0 trên dòng bán. Bảng giá gốc phải đang dùng, cùng tiền tệ và không tạo vòng; không thể ngừng bảng giá đang được bảng giá còn dùng tham chiếu. Dữ liệu vòng cũ lấy giá niêm yết tại điểm khép vòng. Bậc số lượng gồm cả bậc của bảng giá gốc. Cùng mọi mức ưu tiên thì quy tắc thêm sau thắng; dòng cũ chưa có thứ tự tạo dùng ID giảm dần. Các giới hạn chênh lệch cũ vẫn được giữ cho dữ liệu lịch sử; lưới không tạo giới hạn mới. Phụ phí của quy tắc có đóng gói là cho một gói; quy tắc không chọn đóng gói nhập phụ phí theo đơn vị gốc, nên dòng bán theo gói nhân với số đơn vị trong gói (Hộp 6 chai, phụ phí 1.000 ₫ → 6.000 ₫). Bước làm tròn giữ như đã nhập.

\`\`\`mermaid
flowchart TD
  A[Đơn vị trên dòng bán] --> B{Có quy tắc đúng đóng gói?}
  B -->|Có, cùng phạm vi| C[Ưu tiên quy tắc đóng gói]
  B -->|Không| D[Quy tắc chung hoặc giá sản phẩm]
  C --> E[Giá một đơn vị dòng bán]
  D --> E
\`\`\`

Quy tắc có thời hạn chỉ áp dụng trong khoảng đã lưu. Nếu đóng gói không hiện, kiểm tra đóng gói trên sản phẩm, trạng thái đơn vị và công ty đang chọn. Lưu bảng giá không tự đổi giá các dòng bán đã lưu.`,
  },
  en: {
    title: 'Pricelists and packaging',
    source: `Open **Configuration → Pricelists** (the gear on the rail): pricelists are sales configuration, so they are not on the sidebar.

## Find a pricelist

The list loads one page at a time, with 50 pricelists by default. Use search, state filters, custom conditions or state/currency groups; save a search to reuse it. Select the name/sequence column heading to sort, and Previous/Next to change pages. Browser Back restores the query; closing a record returns to the collection you were viewing. If loading fails or you are offline, reconnect and retry.

## Set a pricing rule

Users with Pricing configuration permission edit settings and rule rows with one **Save**. Use **Add rule**, edit cells or remove rows in the grid. An invalid row rolls back the whole save and retains the draft. If another user saved first, reload before entering edits again. Viewers can read the pricelist without write commands.

1. Choose a scope: variant, product template, category or all products.
2. For a variant or template, select **Packaging** enabled for that product. Leave it empty for all units. Changing the product or scope clears the packaging choice.
3. Enter **Minimum quantity** in the sales-line unit: 3 cartons means 3, not the bottles inside them.
4. Choose fixed price, percentage discount or formula, then save. Refusals keep your input and show the affected field.

## Which price applies?

Variant rules outrank template rules, then category and global rules. Among category rules valid for the date and quantity, the nearest category wins before comparing minimum quantities. Within one scope, matching packaging outranks a rule without packaging; minimum quantity then decides.

**A packaging fixed price is the price of one package.** Template fixed rules add variant extras multiplied by the package factor. Fixed rules without packaging convert from the base unit. A negotiated price entered on a sales line is already per package.

Percentage rules use list price or the net price of a base pricelist; sales lines display the base unit price and discount separately. Formulas may also use cost: subtract a discount from −1000 to 100% (negative means markup), round half away from zero to the selected multiple, add a whole-currency surcharge, then clamp below zero. Formula lines display zero discount. A base pricelist must be active, use the same currency and introduce no cycle. An active dependent list prevents archiving its base. Legacy cycles use list price at the closing edge. Quantity breaks include base-list tiers. Later-created rules win otherwise equal ties; legacy rows use descending ID. Historical margin limits remain readable and effective; the grid does not create new limits. A packaging rule's surcharge is per package; a rule without packaging enters it per base unit, so a line sold in a package multiplies it by the units in it (a box of 6 with a 1,000 surcharge adds 6,000). The rounding step stays as entered.

\`\`\`mermaid
flowchart TD
  A[Sales-line unit] --> B{Matching packaging rule?}
  B -->|Yes, same scope| C[Prefer packaging rule]
  B -->|No| D[General rule or product price]
  C --> E[Price of one sales-line unit]
  D --> E
\`\`\`

Dated rules apply only within their saved validity period. If packaging is missing, check the product packaging, unit status and active company. Saving a pricelist does not reprice existing sales lines.`,
  },
} as const
