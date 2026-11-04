import { marked } from 'marked'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { inventoryHelp } from './inventory-help-content.ts'

// The inventory list's guide (Help drawer), in Markdown. It describes ./inventory.tsx,
// the inventory search in ../search.ts and the route in ../routes.ts; change it with them.

export { inventoryHelp } from './inventory-help-content.ts'

/** The guide's drawer, beside the list in the content slot. */
export const InventoryHelp = ({ lang }: { lang: 'vi' | 'en' }): TemplateResult => {
  const words = HELP[lang]
  const guide = inventoryHelp[lang]
  return (
    <HelpDrawer
      id="stock-inventory-help"
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
