import { signal } from '@ketvietlab/ketjs-view'
import { calendarPeriod } from './operations-model.mjs'
import { todayDate } from './timeline.mjs'

export const operationRoutes = new Set(['forms', 'calendar', 'inbox', 'saved-views', 'personal-settings'])

// Read parameters exist before the lazy screen controller. Keep the same signals
// when its renderer arrives so the initial request and visible controls agree.
export function createOperationsState(data) {
  const date = signal(''),
    scale = signal('month'),
    calendarLimits = signal({}),
    inboxTab = signal('unread')
  return {
    date,
    scale,
    calendarLimits,
    inboxTab,
    calendarWindow() {
      if (!date()) date.set(todayDate(data()?.timezone))
      const period = calendarPeriod(date(), scale())
      return { dueFrom: period.days[0], dueTo: period.days.at(-1), includeUndated: true }
    },
    reset() {
      date.set('')
      calendarLimits.set({})
      inboxTab.set('unread')
    },
  }
}
