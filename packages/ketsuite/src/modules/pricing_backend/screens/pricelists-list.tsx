import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { pricelistHelpDrawer } from './pricelist-page.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { pricelistIslands } from '../list/islands.ts'
import type { Props } from '../list/shared.ts'

export function pricelistsScreen(
  _: Translator,
  frame: Frame,
  options: { props: Props; createHref: string | null },
) {
  const island = (name: keyof typeof pricelistIslands) =>
    trustedMarkup(renderIsland(name, (props) => pricelistIslands[name].view!(props as Props), options.props))
  return shell(
    _,
    _('pricing_backend.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        title={_('pricing_backend.title')}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('pricing_backend.action.create')}
              href={options.createHref}
              variant="primary"
            />
          ) : null
        }
        controls={island('pricing.list-controls')}
        body={island('pricing.list-results')}
        footer={island('pricing.list-footer')}
      />
      {pricelistHelpDrawer(_.locale === 'en' ? 'en' : 'vi')}
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
