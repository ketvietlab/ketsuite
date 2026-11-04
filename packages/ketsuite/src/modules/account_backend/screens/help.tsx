import { marked } from 'marked'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { accountingGuideFor } from './help-content.ts'

/** The guide of an accounting route, drawn in the content slot; null when the route has none. */
export const accountingScreenHelp = (url: URL, locale: string): TemplateResult | null => {
  const guides = accountingGuideFor(url.pathname)
  if (!guides) return null
  const lang = locale === 'en' ? 'en' : 'vi'
  const words = HELP[lang]
  const guide = guides[lang]
  return (
    <HelpDrawer
      id="account-screen-help"
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
