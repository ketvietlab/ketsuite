import { marked } from 'marked'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { salesAnalysisHelp } from './sales-analysis-help-content.ts'

// The sales analysis guide (Help drawer), in Markdown. It describes ./sales-analysis.tsx,
// sale.productSales in ../../sale/product-sales.ts and the /admin/sales/analysis route in
// ../index.ts; change it with them.

export { salesAnalysisHelp } from './sales-analysis-help-content.ts'

/** The guide's drawer, beside the analysis in the content slot. */
export const SalesAnalysisHelp = ({ lang }: { lang: 'vi' | 'en' }): TemplateResult => {
  const words = HELP[lang]
  const guide = salesAnalysisHelp[lang]
  return (
    <HelpDrawer
      id="sale-analysis-help"
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
