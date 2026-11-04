import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { vendorBillHelp } from './vendor-bill-help-content.ts'

/** The vendor bills guide (Help drawer), rendered in the content slot of the list and of a bill. */
export const VendorBillHelp = ({ lang }: { lang: 'vi' | 'en' }) => {
  const words = HELP[lang]
  const guide = vendorBillHelp[lang]
  return (
    <HelpDrawer
      id="account-vendor-bill-help"
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
