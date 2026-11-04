import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Vị trí kho là gì
Vị trí là nơi hàng nằm hoặc nơi hàng đi tới. Mỗi dòng cho biết đường dẫn của vị trí, **Loại vị trí**, **Kho hàng** sở hữu nó, **Vị trí cha** và số sản phẩm đang có tồn ở đó.

## Mỗi kho một bộ vị trí riêng
Tạo kho thì hệ thống tạo sẵn các vị trí của chính kho đó: vị trí lưu kho (**Tồn kho**), **Nhà cung cấp**, **Khách hàng**, **Hàng hủy** và **Điều chỉnh tồn kho**. Phiếu nhập của kho đi từ Nhà cung cấp của kho, phiếu xuất tới Khách hàng của kho, kiểm kê ghi chênh lệch với Điều chỉnh tồn kho của kho, và hủy hàng đưa hàng tới Hàng hủy của kho.

Vì vậy, hai kho thì có hai dòng **Khách hàng**, hai dòng **Hàng hủy**,…; cột **Kho hàng** cho biết dòng đó thuộc kho nào. Nhờ vậy báo cáo theo kho đọc thẳng vị trí của kho, và quyền theo kho áp lên cả các vị trí này.

## Loại vị trí
- **Vị trí nội bộ**: hàng nằm ở đây được tính vào tồn kho.
- **Nhóm vị trí**: chỉ để gom các vị trí con, không chứa hàng.
- **Vị trí nhà cung cấp**, **Vị trí khách hàng**: nơi hàng đến từ và đi tới bên ngoài công ty.
- **Vị trí kiểm kê**: nơi ghi phần thừa, thiếu khi kiểm kê.
- **Vị trí sản xuất**, **Vị trí trung chuyển**, **Vị trí hàng hủy**: hàng đi vào sản xuất, đang trên đường giữa hai kho, hoặc đã hủy.

Chỉ hàng ở vị trí nội bộ mới tính là tồn.

## Tạo và sửa vị trí
Bấm **Tạo mới** để thêm vị trí, ví dụ một kệ trong kho: nhập **Tên vị trí**, chọn **Cách sử dụng**, **Vị trí cha** và **Kho hàng** khi vị trí thuộc cấu trúc của một kho. Bấm một dòng để mở và sửa vị trí. Chỉ người được cấu hình kho mới thấy nút **Tạo mới** và sửa được; người khác chỉ xem.`,
  en: `## What a location is
A location is where goods sit or where they go. Each row shows the location's path, its **Location type**, the **Warehouse** that owns it, its **Parent location** and how many products are in stock there.

## Each warehouse has its own locations
Creating a warehouse creates locations of its own: its stock location (**Stock**), **Vendor**, **Customer**, **Scrap** and **Inventory adjustment**. The warehouse's receipts come from its Vendor location, its deliveries go to its Customer location, its counts post their differences against its Inventory adjustment location, and its scrapped goods go to its Scrap location.

So two warehouses show two **Customer** rows, two **Scrap** rows and so on; the **Warehouse** column tells which warehouse a row belongs to. Reports per warehouse read the warehouse's own locations, and access by warehouse covers them too.

## Location types
- **Internal location**: goods here count as stock.
- **Location group**: only groups the locations under it and holds no goods.
- **Vendor location**, **Customer location**: where goods come from and go to outside the company.
- **Inventory loss location**: where counts post what they found over or short.
- **Production location**, **Transit location**, **Scrap location**: goods going into production, on their way between warehouses, or scrapped.

Only goods in an internal location count as stock.

## Create and edit locations
Select **Create** to add a location, for example a shelf in a warehouse: enter its **Location name**, choose its **Usage**, **Parent location** and, when it belongs to a warehouse's structure, its **Warehouse**. Select a row to open and edit the location. Only people who configure stock see **Create** and can edit; everyone else reads.`,
}

/** K10: the locations guide, for the list and the location's modal. */
/** A list and the record modal it opens each mount a guide, so the list passes its own `id`. */
export function LocationHelp({ lang, id = 'stock-location-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={id}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Vị trí kho' : 'Locations'}
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
