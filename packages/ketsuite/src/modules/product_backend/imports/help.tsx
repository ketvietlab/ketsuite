import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../screens/help-words.ts'
export const importHelp = {
  vi: {
    title: 'Nhập sản phẩm',
    source:
      '## Nhập từ bảng tính\nChủ doanh nghiệp và trưởng bán hàng mở Nhập, dán bảng có dòng tiêu đề rồi chọn Nhập. Không chọn tệp hay chạy nhập nền. Mỗi lần tối đa 500 dòng và 256 KiB. Nếu một dòng lỗi, toàn bộ lần nhập được hoàn tác; dữ liệu vừa dán vẫn còn để sửa.\n\n## Cột và biến thể\nMã sản phẩm là bắt buộc. Tiêu đề tiếng Việt hoặc Anh, có hoặc không dấu, thứ tự tùy ý; cột lạ được bỏ qua, cột lặp bị từ chối. Các dòng cùng mã là một sản phẩm; tên, nhóm, thuế và giá bán lấy giá trị không trống đầu tiên. Loại và đơn vị chỉ dùng khi tạo mới. Đơn vị, thuế và giá trị thuộc tính phải có sẵn. Nhóm dùng đường dẫn đầy đủ nếu tên trùng. Thuộc tính có dạng Màu:Đỏ;Cỡ:S. Dùng dấu \\ trước dấu ; hoặc : nằm trong tên. Mã biến thể, barcode, giá riêng và giá vốn áp dụng đúng tổ hợp. Không nhập tồn kho hoặc combo.\n\n## Xuất để sửa\nTải danh sách sản phẩm để sửa gồm mọi SKU đang hoạt động, trừ combo. Cột giá vốn chỉ có khi được cấp quyền. Giữ nguyên CSV rồi nhập lại không đổi sản phẩm; giá 159.000 và 159,000 đều được hiểu là 159000. Ô trống không xóa giá trị cũ. Thuộc tính chỉ mô tả được giữ lại. Sản phẩm chưa có mã hoặc thiếu giá trị thuộc tính không nhập lại được, nên khi còn sản phẩm như vậy tệp không được tạo; thông báo nêu tên chúng để sửa trước. Nếu danh sách lớn, chia thành các lần nhập trong giới hạn.\n\n## Lịch sử và quyền\nSau khi nhập, bản ghi NHAP/… chỉ đọc ghi người nhập, số dòng, số sản phẩm và biến thể thay đổi cùng liên kết sản phẩm. Người đọc danh mục được xem lịch sử; giá vốn trong dữ liệu gốc bị che nếu không có quyền đọc. Nhập không đổi vẫn tạo bản ghi nhập nhưng không tăng revision sản phẩm. Giá vốn đang có tồn kho bị khóa. Nếu có xung đột, tải lại rồi thử lại.',
  },
  en: {
    title: 'Product imports',
    source:
      '## Paste from a spreadsheet\nOwners and sales managers choose Import, paste a table with headers, then submit. There is no file upload or background job. Each import allows up to 500 rows and 256 KiB. One invalid row rolls back the entire import; pasted data remains available to correct.\n\n## Columns and variants\nProduct code is required. Vietnamese or English headers may omit accents and appear in any order; unknown columns are ignored and duplicates are refused. Rows sharing a code describe one product. The first nonblank name, group, VAT and sales price win. Type and unit apply only when creating a product. Units, taxes and attribute values must already exist. Use a full category path when leaf names repeat. Attributes use Colour:Red;Size:S. Escape a semicolon or colon inside a name with a backslash. Variant code, barcode, own price and cost apply to the exact combination. Inventory and combos cannot be imported.\n\n## Download to edit\nDownload products to edit includes all active SKUs except combos. Cost appears only with cost-read permission. Reimporting the unchanged CSV does not change products. Both 159.000 and 159,000 mean 159000; blank cells preserve existing values. Descriptive attributes are retained. A product without a code or with missing attribute values cannot be reimported, so while one remains no file is made; the message names those products to correct first. Split large downloads into imports within the limits.\n\n## History and permissions\nThe saved NHAP/… record is read-only and records the actor, row count, created or changed products and variants, and product links. Catalogue readers may view history; the source cost column is hidden without cost-read permission. A no-op import still saves an import record but does not move product revisions. Physical stock locks cost edits. Reload and retry after a conflict.',
  },
}
export function ImportHelp({ lang, id = 'product-import-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = importHelp[lang]
  return (
    <HelpDrawer
      id={id}
      label={words.label}
      title={guide.title}
      closeLabel={words.close}
      body={
        <MarkdownContent
          source={guide.source}
          lexer={marked.lexer}
          headingOffset={1}
          labels={{
            diagram: words.diagram,
            table: words.table,
            source: words.source,
            loading: words.loading,
            error: words.error,
          }}
        />
      }
    />
  )
}
