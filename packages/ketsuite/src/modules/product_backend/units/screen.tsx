import { marked } from 'marked'
import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { HELP } from '../screens/help-words.ts'
import { unitsHelp } from './help.ts'

/**
 * The Units of measure screen. `ListPage` owns the title and the create action; the
 * `product.uom-list` island in its body owns the query, the rows and the pager, and the
 * server renders it loading only (./island.tsx). The guide sits beside it in the content
 * slot, opened from the rail's Help.
 */
export const unitsScreen = (
  _: Translator,
  frame: Frame,
  island: JSXChild,
  lang: 'vi' | 'en',
): TemplateResult => {
  const words = HELP[lang]
  const guide = unitsHelp[lang]
  return shell(
    _,
    _('product_backend.uom.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('product_backend.uom.title')}
        body={island}
      />
      <HelpDrawer
        id="product-uom-help"
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
      chrome: null,
      topbar: false,
      ...(frame.applications ? { applications: { ...frame.applications, helpLabel: words.trigger } } : {}),
    },
  )
}
