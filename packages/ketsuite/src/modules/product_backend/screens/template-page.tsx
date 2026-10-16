import { marked } from 'marked'
import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { HELP } from './help-words.ts'
import { templatePageHelp } from './template-help.ts'

export { HELP }

/**
 * A product template's own page. The `product.template-page` island is the whole
 * page: it renders the RecordPage, its title and actions, so the shell adds no
 * top bar or title of its own (see modal/product-modal-view.tsx). The page's guide
 * sits beside it in the content slot, opened from the rail's Help.
 */
export const templatePageScreen = (
  _: Translator,
  title: string,
  island: JSXChild,
  frame: Frame,
  lang: 'vi' | 'en',
): TemplateResult => {
  const words = HELP[lang]
  const guide = templatePageHelp[lang]
  return shell(
    _,
    title,
    <>
      {island}
      <HelpDrawer
        id="product-template-help"
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
    </>,
    {
      ...frame,
      topbar: false,
      titled: false,
      ...(frame.applications ? { applications: { ...frame.applications, helpLabel: words.trigger } } : {}),
    },
  )
}
