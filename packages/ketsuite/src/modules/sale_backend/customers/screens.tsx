import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import type { RecordPageIslandProps } from '../../../ui/record-modal.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { CustomerHelp } from './help.tsx'
import { customerIslands } from './islands.ts'
import { customerPageIsland } from './record-island.ts'
import type { Props } from './shared.ts'

const withHelp = (_: Translator, frame: Frame) =>
  frame.applications
    ? { applications: { ...frame.applications, helpLabel: HELP[_.locale === 'en' ? 'en' : 'vi'].trigger } }
    : {}

export function customersScreen(
  _: Translator,
  frame: Frame,
  options: { props: Props; createHref: string | null },
) {
  const island = (name: keyof typeof customerIslands) =>
    trustedMarkup(renderIsland(name, (props) => customerIslands[name].view!(props as Props), options.props))
  return shell(
    _,
    _('sale_backend.customers.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        title={_('sale_backend.customers.title')}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('sale_backend.customers.create')}
              href={options.createHref}
              variant="primary"
            />
          ) : null
        }
        controls={island('sale.customer-list-controls')}
        body={island('sale.customer-list-results')}
        footer={island('sale.customer-list-footer')}
      />
      {<CustomerHelp lang={_.locale === 'en' ? 'en' : 'vi'} />}
    </>,
    { ...frame, chrome: null, topbar: false, ...withHelp(_, frame) },
  )
}

export function customerRecordScreen(_: Translator, frame: Frame, props: RecordPageIslandProps) {
  return shell(
    _,
    _('sale_backend.customers.title'),
    html`${trustedMarkup(renderIsland('sale.customer-page', (p) => customerPageIsland.view!(p as unknown as RecordPageIslandProps), props))}`,
    { ...frame, topbar: false, titled: false, ...withHelp(_, frame) },
  )
}
