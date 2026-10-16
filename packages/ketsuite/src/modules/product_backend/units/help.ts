// The Units of measure screen's guide (Help drawer), in Markdown. It describes the list in
// ./island.tsx, the record in ../modal/uom-modal-view.tsx and the save in ./routes.ts;
// change it with them.

export const unitsHelp = {
  vi: {
    title: 'Đơn vị tính',
    source: `Đơn vị tính không chia theo nhóm. Mỗi đơn vị hoặc là **đơn vị gốc**, hoặc chứa một số lượng của **đơn vị tham chiếu** (kg = 1.000 g; Hộp 6 chai = 6 Chai). Đơn vị tham chiếu có thể lại quy đổi tiếp (Thùng 24 chai = 4 Hộp 6 chai), nên quy cách đóng gói cũng chỉ là một đơn vị.

\`\`\`mermaid
flowchart TB
  T[Thùng<br>24 chai] -- 4 --> H[Hộp<br>6 chai] -- 6 --> C[Chai]
  KG[kg] -- 1.000 --> G[g]
\`\`\`

## Tìm và lọc

- Ô tìm kiếm tìm theo tên đơn vị và tên đơn vị gốc của nó; danh sách lọc ngay khi bạn ngừng gõ.
- **Loại đơn vị** chọn đơn vị gốc, hoặc các đơn vị quy đổi & đóng gói.
- **Đang dùng**, **Lưu trữ**, **Tất cả** chọn theo trạng thái; con số bên cạnh là số đơn vị khớp ô tìm kiếm.
- Các đơn vị cùng đơn vị gốc nằm chung một nhóm, xếp từ nhỏ tới lớn. Bấm tên nhóm để thu gọn hoặc mở lại.

## Các cột

- **Quy đổi**: một đơn vị này bằng bao nhiêu đơn vị tham chiếu của nó.
- **Theo đơn vị gốc**: quy về đơn vị đứng đầu nhóm, kể cả khi phải đi qua nhiều bước.
- **Sản phẩm dùng**: số sản phẩm đang bán lấy đơn vị này làm đơn vị tính.
- **Đóng gói**: số sản phẩm gắn đơn vị này làm quy cách đóng gói trên trang sản phẩm.
- Nhãn **Đã khoá quy đổi**: đơn vị đã gắn làm đóng gói của sản phẩm, hoặc đã có tồn kho, chứng từ.

## Tạo và sửa

**Tạo đơn vị** mở biểu mẫu; bấm một dòng để sửa đơn vị đó.

- Tên không được trùng đơn vị khác (không phân biệt hoa thường).
- Để trống **Đơn vị tham chiếu** nếu đây là đơn vị gốc. Danh sách không có chính đơn vị này và các đơn vị đang quy đổi từ nó, để quy đổi không vòng ngược.
- **Số lượng** lớn hơn 0, tối đa 3 chữ số thập phân; gõ "0,5" hay "1.000" như thường lệ.
- Bỏ chọn **Đang dùng** để lưu trữ: sản phẩm mới không chọn được đơn vị này nữa.

## Khi đơn vị đã được dùng

- Đơn vị đã gắn làm đóng gói, hoặc đã có tồn kho, chứng từ (trực tiếp hay qua đơn vị quy đổi từ nó), giữ nguyên tham chiếu và số lượng, kể cả sau khi gỡ khỏi sản phẩm; cần quy đổi khác thì tạo đơn vị mới.
- Không lưu trữ được đơn vị còn là đơn vị tính của sản phẩm đang bán, hoặc còn đơn vị đang dùng quy đổi từ nó.

Trên trang sản phẩm, mục **Đóng gói** gắn các đơn vị cùng nhóm với đơn vị của sản phẩm, kèm mã vạch riêng cho từng quy cách.`,
  },
  en: {
    title: 'Units of measure',
    source: `Units of measure have no categories. A unit is either a **reference unit** or holds a quantity of its **reference unit** (kg = 1,000 g; Box of 6 = 6 Bottles). A reference may itself count another (Carton of 24 = 4 Boxes of 6), so a packaging is just another unit.

\`\`\`mermaid
flowchart TB
  T[Carton<br>of 24] -- 4 --> H[Box<br>of 6] -- 6 --> C[Bottle]
  KG[kg] -- 1,000 --> G[g]
\`\`\`

## Searching and filtering

- The search box matches a unit's name and its reference unit's; the list filters as soon as you stop typing.
- **Unit kind** picks reference units, or the conversions and packagings.
- **Active**, **Archived** and **All** pick by status; the figure beside each counts the units matching the search.
- Units sharing a reference unit form one group, smallest first. Select a group's name to fold or unfold it.

## Columns

- **Conversion**: how many of its reference unit one of this unit holds.
- **In reference unit**: the same in the unit heading the group, however many steps away.
- **Products**: active products whose unit this is.
- **Packagings**: products packed in this unit on their product page.
- The **Conversion fixed** badge: the unit packs a product, or has stock or documents.

## Creating and editing

**Create unit** opens the form; select a row to edit that unit.

- No other unit may have the name (case-insensitive).
- Leave **Reference unit** empty for a reference unit. The choices leave out this unit and the units counting it, so a conversion never loops back.
- **Quantity** is above 0, with up to 3 decimals.
- Clear **Active** to archive the unit: new products can no longer choose it.

## Units in use

- A unit that packs a product, or has stock or documents (directly or through a unit counting it), keeps its reference and quantity, even once removed from the product; create a new unit for another conversion.
- A unit cannot be archived while an active product uses it as its unit, or an active unit counts it.

On a product page, **Packagings** links units of the product unit's family, each with its own barcode.`,
  },
}
