import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../screens/help-words.ts'
export const categoryHelp = {
  vi: {
    title: 'Nhóm sản phẩm',
    source: `## Sắp xếp danh mục
Tên đầy đủ cho biết vị trí trong cây, ví dụ **Hàng hóa / Thiết bị**. Tìm theo tên đầy đủ, có hoặc không dấu. Số sản phẩm gồm sản phẩm đang dùng trong nhóm và các nhóm con. Trang sản phẩm, danh sách sản phẩm, biến thể và quy tắc bảng giá cũng ghi nhóm theo tên đầy đủ.

## Tên và nhóm cha
Chủ doanh nghiệp và trưởng bán hàng tạo, đổi tên hoặc chuyển nhóm. Tên tối đa 40 ký tự, không chứa / và không trùng trong cùng cha, kể cả nhóm đã lưu trữ. Không chọn chính nhóm hoặc nhóm con làm cha. Mã liên kết được giữ khi đổi tên hoặc chuyển nhóm.

## Tài khoản ghi sổ
Chủ doanh nghiệp, trưởng bán hàng và kế toán sửa tài khoản; kế toán không đổi tên hoặc cây nhóm. Để trống để kế thừa nhóm cha gần nhất, rồi đến thiết lập công ty. Chi phí mặc định còn tùy loại sản phẩm; màn nhóm không gán một tài khoản cho mọi dịch vụ. Tài khoản riêng của sản phẩm có ưu tiên cao hơn nhóm.

## Lưu trữ và khôi phục
Chỉ lưu trữ khi không còn sản phẩm, nhóm con hoặc quy tắc bảng giá đang dùng trong nhánh. Liên kết lịch sử vẫn giữ. Muốn khôi phục nhóm con, khôi phục cha trước. Nếu người khác vừa sửa, tải lại và đối chiếu trước khi lưu.`,
  },
  en: {
    title: 'Product categories',
    source: `## Organize the catalogue
Full names show the tree, for example **Goods / Equipment**. Search full names with or without accents. Product counts include active products in the category and its descendants. Product pages, the product and variant lists and pricelist rules name categories by full name too.

## Name and parent
Business owners and sales managers create, rename and move categories. Names allow at most 40 characters, no /, and must be unique under the same parent, including archived siblings. A category cannot become its own ancestor. Renaming or moving keeps linked IDs.

## Posting accounts
Business owners, sales managers and accountants edit accounts; accountants cannot rename or move categories. Leave an account empty to inherit the nearest configured ancestor, then the company setup. Expense defaults also depend on product type. Product-specific accounts take precedence over categories.

## Archive and restore
Archive only when the subtree has no active products, children or rules in active pricelists. Historical references remain. Restore the parent before a child. If another person saved first, reload and compare before saving.`,
  },
}
export function CategoryHelp({ lang, id = 'product-category-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = categoryHelp[lang]
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
