import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { adminPage, inLocale } from '../backend/screen.ts'
import { rowListAnswer, rowListBar, rowListTarget } from '../backend/row-list-read.ts'
import { rowListIslands, rowListReadRoute } from '../backend/row-list-islands.ts'
import { roleGridRow, roleListBarOptions, roleListProps, rolesScreen } from './screens/roles-list.tsx'
import type { RoleRow } from './screens/types.ts'
import { roleListSearch } from './search.ts'

export const ROLES_PATH = '/admin/roles'
export const ROLES_READ_PATH = '/admin/roles/read'

/** The roles the list shows: the standard ones, which are the only ones a person can be given. */
export const listedRoles = (roles: readonly RoleRow[]): RoleRow[] =>
  roles.filter((row) => row.mode === 'managed')

export const managedRoleRoutes: Record<string, RouteEntry> = {
  // The frame, the bar and the loading table; the rows come from the read below (screens/roles-list.tsx).
  '/admin/roles':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      return adminPage(ctx, url, req, {
        title: 'user_backend.roles.title',
        active: ROLES_PATH,
        body: async (_, frame) => {
          const target = rowListTarget(url, `${url.pathname}${url.search}`, ROLES_PATH)!
          const bar = await rowListBar(ctx, url, req, roleListSearch, target, roleListBarOptions(_))
          const islands = rowListIslands(
            roleListProps(_, {
              href: `${target.pathname}${target.search}`,
              read: inLocale(url, ROLES_READ_PATH),
              bar,
            }),
          )
          return rolesScreen(_, frame, { islands, createHref: null, lang: _.locale === 'en' ? 'en' : 'vi' })
        },
      })
    },
  // One page of the roles list, for whoever may list roles.
  [ROLES_READ_PATH]: rowListReadRoute(async (ctx, url, req, href) => {
    if (!(await ctx.allows('user.listRoles', url, req))) return null
    const target = rowListTarget(url, href, ROLES_PATH)
    if (!target) return undefined
    const _ = ctx.translate(ctx.localeOf(url, req))
    const roles = (await ctx.call('user.listRoles', {}, url, req)) as RoleRow[]
    return rowListAnswer(ctx, url, req, {
      spec: roleListSearch,
      rows: listedRoles(roles),
      target,
      view: roleGridRow,
      search: roleListBarOptions(_),
    })
  }),
}
