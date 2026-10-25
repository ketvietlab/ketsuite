import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { collectionSearchFrame } from '../backend/collection-search.ts'
import { seeOther } from '../backend/forms.ts'
import { PAGE_SIZE, pageOf, pager as collectionPager } from '../backend/paging.ts'
import { adminPage, inLocale, localeQuery } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import { leaderboardScreen } from './screens/index.ts'
import { adminSalesRoutes } from './sales/routes.mjs'

// The sales screens (pipeline, records, the record page, activities, configuration and teams) are the islands
// of `sales-routes.ts`. What stays here: the CRM's entry address, the old address of a new team, and the
// leaderboard.

type Translator = ReturnType<ServeContext['translate']>

const errorsOf = (result: unknown, _: Translator) =>
  (((result as AnyRow | null)?.errors as AnyRow[] | undefined) ?? []).map((error) => {
    const code = String(error.code ?? '')
    return code && _.resolves(code)
      ? _(code, error.params as Record<string, unknown>)
      : String(error.message ?? code)
  })

/**
 * The admin authenticates with a session cookie, so a POST arriving from another origin carries the signed-in
 * user's credentials without their intent; the leaderboard's refresh refuses one.
 */
const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

export const routes: Record<string, RouteEntry> = {
  '/admin/crm': () => async (url, req) =>
    req.method === 'GET' ? seeOther(inLocale(url, '/admin/crm/pipeline')) : text('GET', { status: 405 }),

  // A new team is made from the configuration's teams, in its dialog.
  '/admin/crm/configuration/teams/new': (): Route => async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const lang = url.searchParams.get('lang')
    return seeOther(
      adminSalesRoutes.href(
        new URLSearchParams({
          screen: 'crm-settings',
          dialog: 'config',
          group: 'teams',
          ...(lang ? { lang } : {}),
        }),
      ),
    )
  },

  '/admin/crm/leaderboard':
    (ctx): Route =>
    async (url, req) => {
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      let errors: string[] = []
      if (req.method === 'POST') {
        const result = (await ctx.call(
          'crm.gamification.refresh',
          { idempotencyKey: randomUUID() },
          url,
          req,
        )) as AnyRow
        if (result.ok) return seeOther(inLocale(url, '/admin/crm/leaderboard'))
        errors = errorsOf(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      let currentPage = pageOf(url)
      const readPage = (page: number) =>
        ctx.call(
          'crm.gamification.list',
          {
            limit: PAGE_SIZE,
            cursor: (page - 1) * PAGE_SIZE,
            search: url.searchParams.get('q') ?? '',
          },
          url,
          req,
        ) as Promise<AnyRow>
      let listed = await readPage(currentPage)
      const lastPage = Math.max(1, Math.ceil(Number(listed.total ?? 0) / PAGE_SIZE))
      if (currentPage > lastPage) {
        currentPage = lastPage
        listed = await readPage(currentPage)
      }
      return adminPage(ctx, url, req, {
        title: 'crm_backend.leaderboard.title',
        body: (_, frame) =>
          leaderboardScreen(
            _,
            collectionSearchFrame(
              url,
              {
                ...frame,
                chrome: {
                  ...frame.chrome,
                  pager: collectionPager(
                    url,
                    currentPage,
                    ((listed.profiles as AnyRow[]) ?? []).length,
                    Number(listed.total ?? 0),
                  ),
                },
              },
              _('crm_backend.leaderboard.title'),
            ),
            {
              profiles: (listed.profiles as AnyRow[]) ?? [],
              total: Number(listed.total ?? 0),
              offset: (currentPage - 1) * PAGE_SIZE,
              errors,
              locale: localeQuery(url),
            },
          ),
      })
    },
}
