import { marked } from 'marked'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { purchaseOrderHelp } from './order-help-content.ts'

// The RFQ and purchase order guide (Help drawer), in Markdown. It describes the order's
// record modal (../modal/order-modal-view.tsx, its line grid ../modal/line-grid.tsx),
// ./order-detail.tsx and the actions the detail route in ../index.ts accepts; change it
// with them.

export { purchaseOrderHelp } from './order-help-content.ts'

/** The guide's drawer, rendered in the content slot beside the page. */
export const PurchaseOrderHelp = ({ lang }: { lang: 'vi' | 'en' }): TemplateResult => {
  const words = HELP[lang]
  const guide = purchaseOrderHelp[lang]
  return (
    <HelpDrawer
      id="purchase-order-help"
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
