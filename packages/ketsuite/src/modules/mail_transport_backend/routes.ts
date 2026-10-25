import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage } from '../backend/screen.ts'
import { collectionScreenData } from '../mail_backend/collection-screen.ts'
import type { CommunicationHelpOptions } from '../../ui/communication-screen.tsx'
import { outboxScreen } from './screens/index.ts'

export const routesWithHelp = (options: CommunicationHelpOptions = {}) => ({
  '/admin/outbox':
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
        if (form.action === 'retry') await ctx.call('mail_transport.retry', { id: form.id ?? '' }, url, req)
        else if (form.action === 'cancel')
          await ctx.call('mail_transport.cancel', { id: form.id ?? '' }, url, req)
        else return text('unknown outbox action', { status: 400 })
        return seeOther(`${url.pathname}${url.search}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const data = await collectionScreenData(ctx, url, req, 'outbox')
      return adminPage(ctx, url, req, {
        title: 'mail_transport_backend.title',
        active: '/admin/outbox',
        body: (_, frame) => outboxScreen(_, frame, { ...data, ...options }),
      })
    },
})
export const routes = routesWithHelp()
