import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage } from '../backend/screen.ts'
import { collectionScreenData } from '../mail_backend/collection-screen.ts'
import type { CommunicationHelpOptions } from '../../ui/communication-screen.tsx'
import { inboxScreen } from './screens/index.ts'

export const routesWithHelp = (options: CommunicationHelpOptions = {}) => ({
  '/admin/inbox':
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
        if (form.action === 'readAll')
          await ctx.call('mail.markAllInboxRead', { readAt: new Date().toISOString() }, url, req)
        else if (!form.action || form.action === 'read')
          await ctx.call(
            'mail.markInboxRead',
            { id: form.id ?? '', readAt: new Date().toISOString() },
            url,
            req,
          )
        else return text('unknown inbox action', { status: 400 })
        return seeOther(`${url.pathname}${url.search}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const data = await collectionScreenData(ctx, url, req, 'inbox')
      return adminPage(ctx, url, req, {
        title: 'mail_backend.inbox.title',
        active: '/admin/inbox',
        body: (_, frame) => inboxScreen(_, frame, { ...data, ...options }),
      })
    },
})
export const routes = routesWithHelp()
