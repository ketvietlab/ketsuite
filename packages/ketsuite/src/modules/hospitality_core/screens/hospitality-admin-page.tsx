import { adminPage } from '../../backend/screen.ts'
import { hospitalityScreenHelp } from './screen-help.tsx'

/** Screen-owned help follows the content slot through fragment navigation. */
export const hospitalityAdminPage: typeof adminPage = (ctx, url, req, options) =>
  adminPage(ctx, url, req, {
    ...options,
    body: async (_, frame) => {
      const title = options.translate === false ? options.title : _(options.title)
      const help = hospitalityScreenHelp(url, title, ctx.localeOf(url, req))
      return options.body(_, { ...frame, extras: { ...frame.extras, 'screen.help': help ?? undefined } })
    },
  })
