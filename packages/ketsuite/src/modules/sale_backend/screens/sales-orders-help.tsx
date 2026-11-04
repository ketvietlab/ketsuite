import { marked } from 'marked'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { salesOrdersHelp } from './sales-orders-help-content.ts'

// The sales order list's guide (Help drawer), in Markdown. It describes
// ./sales-orders-list.tsx, the order search in ../../sale/order-page.ts and the
// /admin/sales/orders route in ../index.ts; change it with them.

export { salesOrdersHelp } from './sales-orders-help-content.ts'

/** The guide's drawer, beside the list in the content slot. */
export const SalesOrdersHelp = ({ lang }: { lang: 'vi' | 'en' }): TemplateResult => {
  const words = HELP[lang]
  const guide = salesOrdersHelp[lang]
  return (
    <HelpDrawer
      id="sale-orders-help"
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
