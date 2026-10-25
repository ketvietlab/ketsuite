import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import type { MarkdownToken } from '@ketvietlab/design-system'
import { ListPage, shell } from './index.ts'
import type { Frame } from './index.ts'

export type CommunicationHelpOptions = { markdownLexer?: (source: string) => readonly MarkdownToken[] }
export type CommunicationScreenOptions = CommunicationHelpOptions & {
  controls?: JSXChild
  results?: JSXChild
  footer?: JSXChild
}
export function communicationScreen(
  _: Translator,
  frame: Frame,
  kind: 'inbox' | 'outbox' | 'activity',
  title: string,
  options: CommunicationScreenOptions,
) {
  const label = _('mail_backend.help.label')
  const lexer = options.markdownLexer ?? ((source: string) => [{ type: 'paragraph', text: source }])
  const help = (
    <HelpDrawer
      id={`${kind}-screen-help`}
      label={label}
      title={title}
      closeLabel={_('mail_backend.help.close')}
      body={
        <MarkdownContent
          source={_(`mail_backend.help.${kind}`)}
          lexer={lexer}
          headingOffset={1}
          labels={{
            table: _('mail_backend.help.table'),
            diagram: _('mail_backend.help.diagram'),
            source: _('mail_backend.help.source'),
            loading: _('mail_backend.help.loading'),
            error: _('mail_backend.help.error'),
          }}
        />
      }
    />
  )
  const screenFrame = {
    ...frame,
    applications: frame.applications ? { ...frame.applications, helpLabel: label } : undefined,
  }
  return shell(
    _,
    title,
    <>
      <ListPage
        variant="operational"
        frame={screenFrame}
        title={title}
        actions={frame.extras?.['topbar.end']}
        controls={
          <>
            {options.controls}
            {options.footer}
          </>
        }
        body={options.results}
      />
      {help}
    </>,
    { ...screenFrame, chrome: null, topbar: false },
  )
}

export const CommunicationScreen = (props: {
  translate: Translator
  frame: Frame
  kind: 'inbox' | 'outbox' | 'activity'
  title: string
  options: CommunicationScreenOptions
}) => communicationScreen(props.translate, props.frame, props.kind, props.title, props.options)
