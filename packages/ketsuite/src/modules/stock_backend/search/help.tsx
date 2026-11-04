import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Tìm một bản ghi Kho
Dùng ô tìm kiếm trên thanh đầu trang ở mọi màn Kho. Gõ số phiếu (\`WH/XK/0003\`, \`CPMT/2026/0001\`), chứng từ gốc (số đơn bán, phiếu giao được trả), tên lô, mã hoặc tên sản phẩm, tên khách hay nhà cung cấp, hoặc tên kho. Không phân biệt dấu và chữ hoa.

Trang tìm ở mọi trạng thái, mọi kỳ và mọi kho, nên không có bộ lọc kỳ, trạng thái hay kho. Muốn thu hẹp, mở danh sách tương ứng trong menu Kho.

## Kết quả
Mỗi dòng có **Số / Tên**, **Loại**, **Đối tượng**, **Chứng từ gốc** và **Trạng thái**. Bấm dòng để mở bản ghi.

| Loại | Đối tượng | Thứ tự |
|---|---|---|
| Nhập kho, Xuất kho, Chuyển kho, Phiếu trả, Điều chỉnh kiểm kê, Hủy hàng | Khách hay nhà cung cấp; phiếu không có đối tác thì là sản phẩm | Mới nhất trước |
| Lô hàng | Sản phẩm; chứng từ gốc là mã tham chiếu của lô | Theo tên |
| Phiên kiểm kê | Kho; mở trên danh sách kiểm kê | Mới nhất trước |
| Quy tắc bổ sung | Kho; tên là sản phẩm của quy tắc | Theo tên |
| Chi phí mua kho | Nhà cung cấp; chứng từ gốc là các phiếu nhập của phiếu | Mới nhất trước |

## Quyền
Mỗi loại chỉ hiện khi vai trò của bạn mở được danh sách và bản ghi đó, nên thủ kho và quản lý kho có thể thấy các loại khác nhau. Vai trò không được xem Kho thì không có trang này; ô tìm trên thanh đầu trang tìm toàn hệ thống như ở các màn khác.`,
  en: `## Find a stock record
Use the search box in the topbar of any Stock screen. Type a transfer or cost number (\`WH/XK/0003\`, \`CPMT/2026/0001\`), a source document (a sales order, the delivery a return brings back), a lot, a product code or name, a customer or vendor, or a warehouse. Accents and case do not matter.

The page searches every status, period and warehouse, so it has no period, status or warehouse filter. To narrow down, open the matching list in the Stock menu.

## Results
Each row shows **Number / Name**, **Type**, **For**, **Source document** and **Status**. Select a row to open the record.

| Type | For | Order |
|---|---|---|
| Receipt, Delivery, Internal transfer, Return, Count adjustment, Scrap | The customer or vendor; without one, the products | Newest first |
| Lot | The product; the source document is the lot's reference | By name |
| Stock count | The warehouse; opens over the counts list | Newest first |
| Replenishment rule | The warehouse; named by its product | By name |
| Landed cost | The vendor; the source documents are its receipts | Newest first |

## Permissions
A type appears only when your role can open its list and its records, so a warehouse operator and a stock manager may see different types. A role that cannot view Stock has no such page, and its topbar search covers the whole system as elsewhere.`,
}

export function StockSearchHelp({ lang, id = 'stock-search-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={id}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Tìm trong Kho' : 'Search in Stock'}
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
