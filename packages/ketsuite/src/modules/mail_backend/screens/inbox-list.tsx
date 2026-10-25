import type { Row, Translator } from '@ketvietlab/ketjs'
import type { Frame } from '../../../ui/index.ts'
import { CommunicationScreen } from '../../../ui/communication-screen.tsx'
import type { CommunicationScreenOptions } from '../../../ui/communication-screen.tsx'
export type InboxScreenOptions = CommunicationScreenOptions & {
  rows?: readonly Row[]
  action?: string
  toggleHref?: string
  includeDone?: boolean
  today?: string
}
export const inboxScreen = (_: Translator, frame: Frame, options: InboxScreenOptions) => (
  <CommunicationScreen
    translate={_}
    frame={frame}
    kind="inbox"
    title={_('mail_backend.inbox.title')}
    options={options}
  />
)
