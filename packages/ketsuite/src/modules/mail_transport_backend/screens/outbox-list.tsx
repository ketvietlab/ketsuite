import type { Row, Translator } from '@ketvietlab/ketjs'
import type { Frame } from '../../../ui/index.ts'
import { CommunicationScreen } from '../../../ui/communication-screen.tsx'
import type { CommunicationScreenOptions } from '../../../ui/communication-screen.tsx'
export type OutboxScreenOptions = CommunicationScreenOptions & {
  rows?: readonly Row[]
  action?: string
  toggleHref?: string
  includeDone?: boolean
  today?: string
}
export const outboxScreen = (_: Translator, frame: Frame, options: OutboxScreenOptions) => (
  <CommunicationScreen
    translate={_}
    frame={frame}
    kind="outbox"
    title={_('mail_transport_backend.title')}
    options={options}
  />
)
