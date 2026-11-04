import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { vendorPricelistHelp } from './vendor-pricelist-help-content.ts'

/** The vendor price list's guide (Help drawer), rendered in the content slot beside the list. */
export const VendorPricelistHelp = ({ lang }: { lang: 'vi' | 'en' }) => {
  const words = HELP[lang]
  const guide = vendorPricelistHelp[lang]
  return (
    <HelpDrawer
      id="purchase-vendor-pricelist-help"
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
