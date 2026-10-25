import { marked } from 'marked'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { MenuNode, Translator } from '@ketvietlab/ketjs'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { collectionActions, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { productListHelp } from '../list/help.ts'
import { HELP } from './help-words.ts'

/**
 * The catalogue, in the frame the backend already owns.
 *
 * `ListPage` owns the collection hierarchy (title, create, contributed actions); three
 * islands over one store own everything that changes with the query: the search bar,
 * views and bulk bar in its controls slot, the rows or cards and groups in its body,
 * and the pager in its footer. The server renders them in their loading state only, so
 * a catalogue of ten thousand products costs the page nothing (list/island.tsx).
 *
 * The page's guide sits beside it in the content slot, opened from the rail's Help.
 * Compact spacing belongs to ListPage; keep the page a direct child of the backend
 * content pane so that pane does not add a second inset.
 */
export const productsScreen = (
  _: Translator,
  frame: Frame,
  islands: { controls?: JSXChild; body?: JSXChild; footer?: JSXChild } | null,
  extensionActions?: JSXChild,
  overlay?: JSXChild,
  lang: 'vi' | 'en' = 'vi',
): TemplateResult => {
  const words = HELP[lang]
  const guide = productListHelp[lang]
  return shell(
    _,
    _('product_backend.screen.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('product_backend.screen.title')}
        actions={collectionActions(_, frame, extensionActions)}
        controls={islands?.controls}
        body={islands?.body}
        footer={islands?.footer}
      />
      {overlay}
      <HelpDrawer
        id="product-list-help"
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

export type { MenuNode }
