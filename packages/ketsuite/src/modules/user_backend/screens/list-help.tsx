// The Help drawer of the people, roles and access-rules lists. The guides it shows are in
// ./list-help-content.ts.
import { marked } from 'marked'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { LIST_HELP_WORDS } from './list-help-content.ts'

export { accessPolicyListHelp, LIST_HELP_WORDS, roleListHelp, userListHelp } from './list-help-content.ts'

/** A list's guide, in the content slot beside the list, opened from the rail's Help. */
export const listHelpDrawer = (
  id: string,
  guide: { title: string; source: string },
  lang: 'vi' | 'en',
): JSXChild => {
  const words = LIST_HELP_WORDS[lang]
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
