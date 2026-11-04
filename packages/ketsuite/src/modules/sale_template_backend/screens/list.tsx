import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { TemplateHelp } from './help.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { templateIslands } from '../list/islands.ts'
import type { Props } from '../list/shared.ts'

export function templatesScreen(
  _: Translator,
  frame: Frame,
  options: { props: Props; createHref: string | null },
) {
  const island = (name: keyof typeof templateIslands) =>
    trustedMarkup(renderIsland(name, (props) => templateIslands[name].view!(props as Props), options.props))
  return shell(
    _,
    _('sale_template.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        title={_('sale_template.title')}
        headerActions={
          options.createHref ? (
            <LinkButton label={_('sale_template.create')} href={options.createHref} variant="primary" />
          ) : null
        }
        controls={island('sale-template.list-controls')}
        body={island('sale-template.list-results')}
        footer={island('sale-template.list-footer')}
      />
      {<TemplateHelp lang={_.locale === 'en' ? 'en' : 'vi'} />}
    </>,
    {
      ...frame,
      chrome: null,
      topbar: false,
      ...(frame.applications
        ? {
            applications: { ...frame.applications, helpLabel: HELP[_.locale === 'en' ? 'en' : 'vi'].trigger },
          }
        : {}),
    },
  )
}
