import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { shell, type Frame } from '../../../ui/index.ts'
import type { RecordPageIslandProps } from '../../../ui/record-modal.tsx'
import { templatePageIsland } from '../record/island.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
export function templateRecordScreen(_: Translator, frame: Frame, props: RecordPageIslandProps) {
  return shell(
    _,
    _('sale_template.title'),
    html`${trustedMarkup(renderIsland('sale-template.record', (p) => templatePageIsland.view!(p as unknown as RecordPageIslandProps), props))}`,
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
