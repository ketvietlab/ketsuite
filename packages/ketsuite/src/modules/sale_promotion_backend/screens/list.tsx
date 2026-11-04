import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { PromotionHelp } from './help.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { promotionIslands } from '../list/islands.ts'
import type { Props } from '../list/shared.ts'

export function promotionsScreen(
  _: Translator,
  frame: Frame,
  options: { props: Props; createHref: string | null; title?: string; backHref?: string },
) {
  const island = (name: keyof typeof promotionIslands) =>
    trustedMarkup(renderIsland(name, (props) => promotionIslands[name].view!(props as Props), options.props))
  return shell(
    _,
    _('sale_promotion_backend.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        title={options.title ?? _('sale_promotion_backend.title')}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('sale_promotion_backend.create')}
              href={options.createHref}
              variant="primary"
            />
          ) : options.backHref ? (
            <LinkButton href={options.backHref} label={_('sale_promotion_backend.backProgram')} />
          ) : null
        }
        controls={island('sale-promotion.list-controls')}
        body={island('sale-promotion.list-results')}
        footer={island('sale-promotion.list-footer')}
      />
      {<PromotionHelp lang={_.locale === 'en' ? 'en' : 'vi'} />}
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
