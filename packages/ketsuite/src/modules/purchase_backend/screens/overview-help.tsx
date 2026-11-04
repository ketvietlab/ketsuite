import { marked } from 'marked'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { purchaseOverviewHelp } from './overview-help-content.ts'

// The purchase overview guide (Help drawer), in Markdown. It describes ./overview.tsx; change it
// with that screen.

export { purchaseOverviewHelp } from './overview-help-content.ts'

/** The guide's drawer, rendered in the content slot beside the page. */
export const PurchaseOverviewHelp = ({ lang }: { lang: 'vi' | 'en' }): TemplateResult => {
  const words = HELP[lang]
  const guide = purchaseOverviewHelp[lang]
  return (
    <HelpDrawer
      id="purchase-overview-help"
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
