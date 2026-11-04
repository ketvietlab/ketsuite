import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../screens/help-words.ts'
export const comboHelp = {
  vi: {
    title: 'Lựa chọn combo',
    source: `## Nhóm món để chọn
Mỗi lựa chọn combo là một nhóm sản phẩm mà khách chọn một món. Danh sách cho biết số món và số sản phẩm đang dùng lựa chọn đó. Tìm theo tên có hoặc không dấu, lọc trạng thái hoặc sắp xếp bằng tiêu đề cột.

## Tạo và sửa
Chủ doanh nghiệp và trưởng bán hàng quản lý lựa chọn; người đọc danh mục có thể xem. Nhập tên tối đa 40 ký tự, không trùng kể cả lựa chọn đã lưu trữ. Thêm từ 1 đến 20 sản phẩm đang bán, không phải combo và không lặp. Phụ thu là số đồng nguyên không âm, tối đa 10 chữ số. Kéo dòng hoặc dùng Alt+mũi tên để đổi thứ tự; món đầu tiên là mặc định. Lưu thay đổi để áp dụng toàn bộ nhóm món.

## Lưu trữ, lịch sử và lỗi
Chỉ lưu trữ khi không còn sản phẩm đang dùng tham chiếu lựa chọn này. Khôi phục để chỉnh sửa hoặc dùng lại. Món đã giữ vẫn được lưu nếu sau đó ngừng bán hoặc lưu trữ; món đó không được thêm mới sau khi bỏ khỏi lựa chọn. Lỗi giữ nguyên nội dung vừa nhập. Nếu người khác vừa sửa, tải lại và đối chiếu trước khi lưu.`,
  },
  en: {
    title: 'Combo choices',
    source: `## A group of items to choose from
A combo choice is a group of products from which a customer picks one item. The list shows item counts and active products using each choice. Search names with or without accents, filter status or sort using column headings.

## Create and edit
Owners and sales managers maintain choices; catalogue readers may view them. Enter a unique name of at most 40 characters, including archived choices. Add 1 to 20 distinct active sellable products, never another combo. Extra prices are non-negative whole amounts of at most 10 digits. Drag rows or use Alt+arrow keys to reorder; the first item is the default. Save changes to apply the complete list.

## Archive, history and errors
Archive only when no active product uses the choice. Restore to edit or use it again. Existing items may remain after they stop selling or are archived; after removal, they cannot be added again while inactive. Refusals keep the entered draft. If someone saved first, reload and compare before saving.`,
  },
}
export function ComboHelp({ lang, id = 'product-combo-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = comboHelp[lang]
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
