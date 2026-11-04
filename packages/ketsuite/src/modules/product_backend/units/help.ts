// The Units of measure screen's guide (Help drawer), in Markdown. It describes the list in
// ./island.tsx, the record in ../modal/uom-modal-view.tsx and the save in ./routes.ts;
// change it with them.

export const unitsHelp = {
  vi: {
    title: 'Đơn vị tính',
    source: `Đơn vị tính không chia theo nhóm. Mỗi đơn vị hoặc là **đơn vị gốc**, hoặc chứa một số lượng của **đơn vị tham chiếu** (kg = 1.000 g; Hộp 6 chai = 6 Chai). Chỉ một tầng: đơn vị tham chiếu luôn là đơn vị gốc (Thùng 24 chai = 24 Chai, không quy qua Hộp), nên quy cách đóng gói cũng chỉ là một đơn vị.

\`\`\`mermaid
flowchart TB
  T[Thùng<br>24 chai] -- 24 --> C[Chai]
  H[Hộp<br>6 chai] -- 6 --> C
  KG[kg] -- 1.000 --> G[g]
\`\`\`

## Tìm và lọc

- Ô tìm kiếm tìm theo tên đơn vị và tên đơn vị gốc của nó; danh sách lọc ngay khi bạn ngừng gõ.
- **Loại đơn vị** chọn đơn vị gốc, hoặc các đơn vị quy đổi & đóng gói.
- **Đang dùng**, **Lưu trữ**, **Tất cả** chọn theo trạng thái; con số bên cạnh là số đơn vị khớp ô tìm kiếm.
- Các đơn vị cùng đơn vị gốc nằm chung một nhóm, xếp từ nhỏ tới lớn. Bấm tên nhóm để thu gọn hoặc mở lại.

## Các cột

- **Quy đổi**: một đơn vị này bằng bao nhiêu đơn vị tham chiếu của nó.
- **Theo đơn vị gốc**: quy về đơn vị đứng đầu nhóm (đơn vị cũ còn quy qua nhiều bước vẫn được tính đúng).
- **Sản phẩm dùng**: số sản phẩm đang bán lấy đơn vị này làm đơn vị tính.
- **Đóng gói**: số sản phẩm gắn đơn vị này làm quy cách đóng gói trên trang sản phẩm.
- Nhãn **Đã khoá quy đổi**: đơn vị đã nằm trên sản phẩm, đóng gói, tồn kho hoặc chứng từ.

## Tạo và sửa

**Tạo đơn vị** mở biểu mẫu; bấm một dòng để sửa đơn vị đó.

- Tên tối đa 20 ký tự, không trùng đơn vị khác (không phân biệt hoa thường).
- Để trống **Đơn vị tham chiếu** nếu đây là đơn vị gốc. Danh sách chỉ có đơn vị gốc đang dùng. Đơn vị đã có đơn vị khác quy về nó thì là đơn vị gốc và không chọn được tham chiếu.
- **Số lượng** lớn hơn 0, tối đa 3 chữ số thập phân; gõ "0,5" hay "1.000" như thường lệ.
- Bỏ chọn **Đang dùng** để lưu trữ: sản phẩm mới không chọn được đơn vị này nữa.

## Khi đơn vị đã được dùng

- Đơn vị đã nằm trên sản phẩm, đóng gói, tồn kho hoặc chứng từ (trực tiếp hay qua đơn vị quy đổi từ nó) giữ nguyên tên, tham chiếu và số lượng, kể cả sau khi gỡ khỏi sản phẩm; cần tên hay quy đổi khác thì tạo đơn vị mới.
- Không lưu trữ được đơn vị còn là đơn vị tính của sản phẩm đang bán, còn là đóng gói của sản phẩm, hoặc còn đơn vị đang dùng quy đổi từ nó. Đơn vị đã lưu trữ rời khỏi mọi lựa chọn; dòng chứng từ cũ giữ nguyên.

Trên trang sản phẩm, mục **Đóng gói** gắn các đơn vị cùng nhóm với đơn vị của sản phẩm, kèm mã vạch riêng cho từng quy cách.`,
  },
  en: {
    title: 'Units of measure',
    source: `Units of measure have no categories. A unit is either a **reference unit** or holds a quantity of its **reference unit** (kg = 1,000 g; Box of 6 = 6 Bottles). One level only: a reference unit is always a root (Carton of 24 = 24 Bottles, not through Boxes), so a packaging is just another unit.

\`\`\`mermaid
flowchart TB
  T[Carton<br>of 24] -- 24 --> C[Bottle]
  H[Box<br>of 6] -- 6 --> C
  KG[kg] -- 1,000 --> G[g]
\`\`\`

## Searching and filtering

- The search box matches a unit's name and its reference unit's; the list filters as soon as you stop typing.
- **Unit kind** picks reference units, or the conversions and packagings.
- **Active**, **Archived** and **All** pick by status; the figure beside each counts the units matching the search.
- Units sharing a reference unit form one group, smallest first. Select a group's name to fold or unfold it.

## Columns

- **Conversion**: how many of its reference unit one of this unit holds.
- **In reference unit**: the same in the unit heading the group (older units still counting through several steps are converted correctly).
- **Products**: active products whose unit this is.
- **Packagings**: products packed in this unit on their product page.
- The **Conversion fixed** badge: the unit is on a product, a packaging, stock or documents.

## Creating and editing

**Create unit** opens the form; select a row to edit that unit.

- The name has at most 20 characters and no other unit may have it (case-insensitive).
- Leave **Reference unit** empty for a reference unit. The choices are active reference units only. A unit other units count in is a reference unit and takes no reference.
- **Quantity** is above 0, with up to 3 decimals.
- Clear **Active** to archive the unit: new products can no longer choose it.

## Units in use

- A unit on a product, a packaging, stock or documents (directly or through a unit counting it) keeps its name, reference and quantity, even once removed from the product; create a new unit for another name or conversion.
- A unit cannot be archived while an active product uses it as its unit, a product is packed in it, or an active unit counts it. An archived unit leaves every choice; old document lines keep it.

On a product page, **Packagings** links units of the product unit's family, each with its own barcode.`,
  },
}
