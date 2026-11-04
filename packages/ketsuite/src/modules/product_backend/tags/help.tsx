import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../screens/help-words.ts'
export const tagHelp = {
  vi: {
    title: 'Thẻ sản phẩm',
    source: `## Phân loại sản phẩm
Thẻ giúp tìm sản phẩm và mọi SKU của sản phẩm đó. Tìm tên thẻ có hoặc không dấu; số sản phẩm chỉ đếm sản phẩm đang dùng. Lọc theo trạng thái hoặc đổi thứ tự bằng tiêu đề cột.

## Tạo và gắn thẻ
Chủ doanh nghiệp và trưởng bán hàng quản lý thẻ. Tên tối đa 30 ký tự, không trùng kể cả thẻ đã lưu trữ. Trong thẻ Thông tin chung của sản phẩm, ô **Thẻ sản phẩm** chọn tối đa 10 thẻ; lưu thay đổi để áp dụng. Kế toán không được sửa thẻ sản phẩm.

## Lưu trữ và khôi phục
Lưu trữ được cả thẻ đang dùng. Sản phẩm đang gắn vẫn giữ liên kết, bộ lọc và tìm kiếm lịch sử vẫn hoạt động; thẻ không còn trong lựa chọn gắn mới. Khôi phục để dùng lại. Đổi tên không đổi liên kết. Nếu người khác vừa sửa, tải lại và đối chiếu trước khi lưu.`,
  },
  en: {
    title: 'Product tags',
    source: `## Classify products
Tags help find a product and all its SKUs. Search tag names with or without accents; product counts include active products only. Filter by status or sort using column headings.

## Create and assign
Business owners and sales managers manage tags. Names allow at most 30 characters and must be unique, including archived tags. In the product’s General card, **Product tags** takes up to 10 tags; save changes to apply them. Accountants cannot edit product tags.

## Archive and restore
You may archive a tag that is in use. Products keep existing assignments, including historical filtering and search; the tag is unavailable for new assignments. Restore to use it again. Renaming keeps linked IDs. If another person saved first, reload and compare before saving.`,
  },
}
export function TagHelp({ lang, id = 'product-tag-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = tagHelp[lang]
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
