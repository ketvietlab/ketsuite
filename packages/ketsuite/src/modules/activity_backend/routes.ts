import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage } from '../backend/screen.ts'
import { collectionScreenData } from '../mail_backend/collection-screen.ts'
import type { CommunicationHelpOptions } from '../../ui/communication-screen.tsx'
import { activitiesScreen } from './screens/index.ts'

export const routesWithHelp = (options: CommunicationHelpOptions = {}) => ({
  '/admin/activities':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const origin = req.headers.origin
        if (origin) {
          try {
            if (new URL(String(origin)).host !== String(req.headers.host ?? ''))
              return text('Forbidden', { status: 403 })
          } catch {
            return text('Forbidden', { status: 403 })
          }
        }
        const form = await readForm(req)
        if (form.action === 'complete')
          await ctx.call('activity.complete', { id: form.id ?? '', feedback: form.feedback ?? '' }, url, req)
        else if (form.action === 'reschedule')
          await ctx.call('activity.reschedule', { id: form.id ?? '', dueDate: form.dueDate ?? '' }, url, req)
        else if (form.action === 'cancel') await ctx.call('activity.cancel', { id: form.id ?? '' }, url, req)
        else return text('unknown activity action', { status: 400 })
        return seeOther(`${url.pathname}${url.search}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const data = await collectionScreenData(ctx, url, req, 'activity')
      return adminPage(ctx, url, req, {
        title: 'activity_backend.title',
        active: '/admin/activities',
        body: (_, frame) => activitiesScreen(_, frame, { ...data, ...options }),
      })
    },
})
export const routes = routesWithHelp()
