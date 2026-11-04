import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
export const saleTagHelp = {
  vi: {
    title: 'Thẻ bán hàng',
    source: `Mở **Cấu hình → Thẻ bán hàng** (bánh răng trên rail) để xem các thẻ dùng để phân loại báo giá và đơn bán của công ty. Thẻ chỉ có tên. Tìm tên thẻ có hoặc không dấu, lọc theo trạng thái hoặc sắp xếp theo tên và số báo giá, đơn đang mang thẻ.

## Tạo và sửa thẻ

Trưởng bán hàng và chủ doanh nghiệp bấm **Tạo thẻ**, nhập tên (tối đa 30 ký tự, không trùng với thẻ khác của công ty kể cả thẻ đã lưu trữ, không phân biệt hoa thường) rồi bấm **Tạo thẻ**. Bấm một dòng để mở thẻ: sửa tên, lưu trữ hoặc khôi phục. Người bán và kế toán chỉ xem.

## Gắn thẻ vào báo giá và đơn

Trên trang báo giá hoặc đơn bán, bấm **Sửa thẻ** trong thẻ **Thông tin đơn hàng**, chọn tối đa 10 thẻ rồi bấm **Lưu thẻ**. Sửa được cả khi đơn đã xác nhận, vì thẻ không phải điều khoản bán hàng. Ở danh sách báo giá và đơn bán, gõ tên thẻ vào ô tìm kiếm để thấy các đơn mang thẻ đó (danh sách đơn bán tìm được cả khi gõ không dấu).

## Lưu trữ và khôi phục

Lưu trữ thẻ đang dùng vẫn được: báo giá, đơn đang mang thẻ vẫn giữ và vẫn tìm thấy theo thẻ, nhưng thẻ không còn trong lựa chọn gắn thêm. Khôi phục để dùng lại. Nếu người khác vừa sửa thẻ, tải lại rồi thử lại.`,
  },
  en: {
    title: 'Sales tags',
    source: `Open **Configuration → Sales tags** (the gear on the rail) to see the tags that classify the company's quotations and sales orders. A tag is only a name. Search tag names with or without accents, filter by status, or sort by name or by the number of quotations and orders that carry the tag.

## Create and edit

Sales managers and business owners choose **Create tag**, enter a name (at most 30 characters, unique among the company's tags including archived ones, regardless of case) and choose **Create tag**. Choose a row to open the tag: rename, archive or restore it. Salespeople and accountants only view tags.

## Tag quotations and orders

On a quotation or sales order page, choose **Edit tags** in the **Order information** card, pick up to 10 tags and choose **Save tags**. This works on confirmed orders too, since tags are not sales terms. In the quotation and sales order lists, type a tag's name in the search box to find the orders that carry it (the sales order list also matches it without accents).

## Archive and restore

You may archive a tag in use: quotations and orders keep it and are still found by it, but it is no longer offered. Restore it to use it again. If someone else just changed the tag, reload and try again.`,
  },
}
export function SaleTagHelp({ lang, id = 'sale-tag-help' }: { lang: 'vi' | 'en'; id?: string }) {
  const words = HELP[lang],
    guide = saleTagHelp[lang]
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
