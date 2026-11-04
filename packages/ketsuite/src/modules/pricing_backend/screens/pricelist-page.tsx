import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { pricelistHelp } from '../record/help.ts'

export function pricelistHelpDrawer(lang: 'vi' | 'en') {
  const words = HELP[lang]
  const guide = pricelistHelp[lang]
  return (
    <HelpDrawer
      id="pricing-pricelist-help"
      label={words.label}
      title={guide.title}
      closeLabel={words.close}
      body={<MarkdownContent source={guide.source} lexer={marked.lexer} headingOffset={1} labels={words} />}
    />
  )
}

export function pricelistPageScreen(_: Translator, frame: Frame, island: JSXChild) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  return shell(
    _,
    _('pricing_backend.title'),
    <>
      {island}
      {pricelistHelpDrawer(lang)}
    </>,
    {
      ...frame,
      topbar: false,
      titled: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: HELP[lang].trigger } }
        : {}),
    },
  )
}
