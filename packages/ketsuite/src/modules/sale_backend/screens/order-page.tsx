import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { SaleOrderHelp } from './order-help.tsx'

/**
 * A quotation or order's own page. The `sale.order-page` island is the whole page: it
 * renders the RecordPage, its title and actions, so the shell adds no top bar or title of
 * its own (see modal/order-modal-view.tsx). The page's guide sits beside it in the content
 * slot, opened from the rail's Help or the page's own Help button.
 */
export const orderPageScreen = (
  _: Translator,
  title: string,
  island: JSXChild,
  frame: Frame,
  lang: 'vi' | 'en',
): TemplateResult =>
  shell(
    _,
    title,
    <>
      {island}
      <SaleOrderHelp lang={lang} />
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
