import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

const guides = {
  vi: `## Thuộc tính và giá trị
Tạo thuộc tính với tên không trùng trong công ty, chọn kiểu hiển thị và cách tạo biến thể. **Nhiều ô chọn** chỉ dùng với **Không tạo biến thể**. Danh sách cho biết số giá trị và số sản phẩm đang sử dụng.

Thêm, đổi tên hoặc sắp xếp giá trị trong lưới. Kiểu màu dùng mã #RRGGBB. **Phụ thu mặc định** được dùng khi chọn giá trị mới cho sản phẩm; thay đổi mặc định không sửa phụ thu đã lưu trên sản phẩm khác. Phụ thu trên từng sản phẩm vẫn có thể sửa riêng.

## Thuộc tính đã dùng
Khi sản phẩm đã dùng thuộc tính, cách tạo biến thể bị khoá và không thể lưu trữ thuộc tính hoặc xoá giá trị đang dùng. Đổi tên giá trị vẫn cập nhật cách hiển thị tên biến thể. Một sản phẩm có tối đa 50 biến thể đang dùng.

## Lưu trữ và quyền
Thuộc tính chưa dùng có thể lưu trữ sau khi xác nhận; dòng vẫn hiện nhãn Đã lưu trữ để bạn mở và khôi phục. Thuộc tính lưu trữ không được chọn cho cấu hình sản phẩm mới.

Người có quyền cấu hình sản phẩm được sửa. Người chỉ có quyền đọc xem thông tin và hướng dẫn; nếu lưu bị từ chối vì dữ liệu vừa thay đổi, tải lại bản ghi trước khi sửa tiếp.`,
  en: `## Attributes and values
Create an attribute with a name unique within the company, then choose its display type and variant policy. **Multiple selection** requires **Never create variants**. The list shows value counts and the number of products using each attribute.

Add, rename or reorder values in the grid. Colours use #RRGGBB. **Default price extra** applies when a value is newly selected for a product; changing the default does not rewrite extras already saved on other products. Each product can override its own extras.

## Attributes already in use
Once a product uses an attribute, its variant policy is locked. The attribute cannot be archived and used values cannot be removed. Renaming a value still updates the displayed variant name. A product can have at most 50 active variants.

## Archiving and access
Confirm to archive an unused attribute. Its row remains labelled Archived so you can open and restore it. Archived attributes are not offered for new product configuration.

Product configuration permission allows edits. Read-only users can inspect the record and guide. Reload before editing again if a save is refused because the data changed.`,
}

export function AttributeHelp({ lang, id = 'product-attribute-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id={id}
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Thuộc tính sản phẩm' : 'Product attributes'}
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
