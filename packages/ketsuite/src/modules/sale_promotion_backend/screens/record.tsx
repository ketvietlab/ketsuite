import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { shell, type Frame } from '../../../ui/index.ts'
import type { RecordPageIslandProps } from '../../../ui/record-modal.tsx'
import { promotionPageIsland } from '../record/island.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
export function promotionRecordScreen(_: Translator, frame: Frame, props: RecordPageIslandProps) {
  return shell(
    _,
    _('sale_promotion_backend.title'),
    html`${trustedMarkup(renderIsland('sale-promotion.record', (p) => promotionPageIsland.view!(p as unknown as RecordPageIslandProps), props))}`,
    {
      ...frame,
      topbar: false,
      titled: false,
      ...(frame.applications
        ? {
            applications: { ...frame.applications, helpLabel: HELP[_.locale === 'en' ? 'en' : 'vi'].trigger },
          }
        : {}),
    },
  )
}
