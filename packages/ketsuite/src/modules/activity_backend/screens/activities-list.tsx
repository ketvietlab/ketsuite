import type { Row, Translator } from '@ketvietlab/ketjs'
import type { Frame } from '../../../ui/index.ts'
import { CommunicationScreen } from '../../../ui/communication-screen.tsx'
import type { CommunicationScreenOptions } from '../../../ui/communication-screen.tsx'
export type ActivityListRow = Row & { targetHref: string | null }
export type ActivitiesListScreenOptions = CommunicationScreenOptions & {
  rows?: readonly Row[]
  action?: string
  toggleHref?: string
  includeDone?: boolean
  today?: string
}
export const activitiesScreen = (_: Translator, frame: Frame, options: ActivitiesListScreenOptions) => (
  <CommunicationScreen
    translate={_}
    frame={frame}
    kind="activity"
    title={_('activity_backend.title')}
    options={options}
  />
)
