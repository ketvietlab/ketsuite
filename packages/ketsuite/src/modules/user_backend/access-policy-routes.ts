import { text } from '@ketvietlab/ketjs'
import type { Row, RouteEntry, ServeContext, Route, Translator } from '@ketvietlab/ketjs'
import { accessPolicyListSearch } from './search.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import { recordModalCreateHref } from '../../ui/record-modal.tsx'
import { rowListAnswer, rowListBar, rowListTarget } from '../backend/row-list-read.ts'
import { rowListIslands, rowListReadRoute } from '../backend/row-list-islands.ts'
import {
  accessPoliciesScreen,
  accessPolicyGridRow,
  accessPolicyListBarOptions,
  accessPolicyListProps,
} from './screens/access-policies-list.tsx'
import type { AccessPolicyMatchKind, AccessPolicyRow } from './screens/access-policies-list.tsx'

export const POLICIES_PATH = '/admin/access-policies'
export const POLICIES_READ_PATH = '/admin/access-policies/read'

/** The rules as the list reads them: who each matches, and every role it gives at its place, in words. */
export const accessPolicyRows = (
  _: Translator,
  policies: readonly Row[],
  roles: readonly Row[],
  companies: readonly Row[],
): AccessPolicyRow[] => {
  const roleNames = new Map(roles.map((row) => [String(row.id), String(row.name)]))
  const companyNames = new Map(companies.map((row) => [String(row.id), String(row.name)]))
  return policies.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    active: row.active === true,
    match: {
      kind: row.matchKind as AccessPolicyMatchKind,
      value: String(row.matchLabel ?? row.matchValue),
    },
    grants: (row.roleIds as string[]).map((id) => ({
      roleName: roleNames.get(id) ?? id,
      scope:
        row.scopeKind === 'tenant'
          ? _('user_backend.scope.tenant')
          : [
              row.companyLabel ?? companyNames.get(String(row.companyId)),
              row.scopeKind === 'branch' ? row.branchLabel : null,
            ]
              .filter(Boolean)
              .join(' · '),
    })),
    memberCount: Number(row.memberCount ?? 0),
  }))
}

/** A group of rules reads as the condition it matches by. */
export const accessPolicyGroupLabel =
  (_: Translator) =>
  (_key: string, value: unknown): string =>
    _(`user_backend.policy.match.${String(value)}`)

export const accessPolicyRoutes: Record<string, RouteEntry> = {
  // The frame, the bar and the loading table; the rows come from the read below.
  '/admin/access-policies':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      if (!(await ctx.allows('user.listAccessPolicies', url, req))) return text('Forbidden', { status: 403 })
      const canCreate = await ctx.allows('user.saveAccessPolicy', url, req)
      return adminPage(ctx, url, req, {
        title: 'user_backend.policy.title',
        active: POLICIES_PATH,
        body: async (_, frame) => {
          const target = rowListTarget(url, `${url.pathname}${url.search}`, POLICIES_PATH)!
          const bar = await rowListBar(
            ctx,
            url,
            req,
            accessPolicyListSearch,
            target,
            accessPolicyListBarOptions(_),
          )
          const createHref = canCreate ? recordModalCreateHref(target, { kind: 'user.accessPolicy' }) : null
          const islands = rowListIslands(
            accessPolicyListProps(_, {
              href: `${target.pathname}${target.search}`,
              read: inLocale(url, POLICIES_READ_PATH),
              bar,
              createHref,
            }),
          )
          return accessPoliciesScreen(_, frame, {
            islands,
            createHref,
            lang: _.locale === 'en' ? 'en' : 'vi',
          })
        },
      })
    },
  // One page of the rules, for whoever may list them.
  [POLICIES_READ_PATH]: rowListReadRoute(async (ctx, url, req, href) => {
    if (!(await ctx.allows('user.listAccessPolicies', url, req))) return null
    const target = rowListTarget(url, href, POLICIES_PATH)
    if (!target) return undefined
    const _ = ctx.translate(ctx.localeOf(url, req))
    const [policies, roles, companies] = await Promise.all([
      ctx.call('user.listAccessPolicies', {}, url, req) as Promise<Row[]>,
      ctx.call('user.listRoles', {}, url, req) as Promise<Row[]>,
      ctx.call('company.listCompanies', {}, url, req) as Promise<Row[]>,
    ])
    return rowListAnswer(ctx, url, req, {
      spec: accessPolicyListSearch,
      rows: accessPolicyRows(_, policies, roles, companies),
      target,
      view: accessPolicyGridRow(_),
      search: accessPolicyListBarOptions(_),
      groupLabel: accessPolicyGroupLabel(_),
    })
  }),
}
