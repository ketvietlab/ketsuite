import { marked } from 'marked'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { saleOrderHelp } from './order-help-content.ts'

// The quotation and sales order page's guide (Help drawer), in Markdown. It describes
// the record page in ../modal/order-modal-view.tsx and what its context offers; change it
// with them.

export { saleOrderHelp } from './order-help-content.ts'

/** The guide's drawer, rendered in the content slot beside the page so it follows navigation. */
export const SaleOrderHelp = ({
  lang,
  id = 'sale-order-help',
}: {
  lang: 'vi' | 'en'
  id?: string
}): TemplateResult => {
  const words = HELP[lang]
  const guide = saleOrderHelp[lang]
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
