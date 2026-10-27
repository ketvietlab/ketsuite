import { managedRoleRoutes } from './managed-role-routes.ts'
import { accessPolicyRoutes } from './access-policy-routes.ts'
import { rowListAnswer, rowListBar, rowListMenu, rowListTarget } from '../backend/row-list-read.ts'
import { rowListIslands, rowListReadRoute } from '../backend/row-list-islands.ts'
import { userListSearch } from './search.ts'
import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, SessionContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { readForm, seeOther } from '../backend/forms.ts'
import {
  profileScreen,
  userGridRow,
  userGroupLabel,
  userListBarOptions,
  userListProps,
  userPageScreen,
  usersScreen,
} from './screens/index.ts'
import type { RoleRow, SessionRow, UserRow } from './screens/index.ts'
import {
  RECORD_NEW_ID,
  readRecordModalTarget,
  recordModalClosedHref,
  recordModalCreateHref,
} from '../../ui/record-modal.tsx'
import type { RecordPageIslandProps } from '../../ui/record-modal.tsx'
import { pageTrailItems } from '../../ui/navigation.tsx'
import { USER_RECORD_MODAL_LABELS } from '../user/modal-labels.ts'
import type { Frame, TableSelection } from '../../ui/index.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const validCreateId = (value?: string): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const accountCreationRoute = ['/admin/users/new', 'account'].join('/')

const safeUserReturnTo = (url: URL, submitted?: string | null): string => {
  const fallback = inLocale(url, '/admin/users')
  if (!submitted?.startsWith('/')) return fallback
  const target = new URL(submitted, 'http://ket.local')
  if (target.origin !== 'http://ket.local' || target.pathname !== '/admin/users') return fallback
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  else target.searchParams.delete('lang')
  // The list's row anchor (`#row=<id>`, design system `rowAnchorHref`) brings the reader back to that row.
  return `${target.pathname}${target.search}${target.hash.startsWith('#row=') ? target.hash : ''}`
}

const withUserReturnTo = (url: URL, path: string, returnTo: string): string => {
  const target = new URL(inLocale(url, path), 'http://ket.local')
  target.searchParams.set('returnTo', returnTo)
  return `${target.pathname}${target.search}`
}

/** The people list, and where its islands read one page of it. */
export const USERS_PATH = '/admin/users'
export const USERS_READ_PATH = '/admin/users/read'

const userDetailPath = (url: URL, id: string, returnTo: string): string =>
  withUserReturnTo(url, `/admin/users/${encodeURIComponent(id)}`, returnTo)

/** Where a deployment that owns its people's sign-in serves their page; see `userPageRoute`. */
const deploymentUserPageRoute = ['/admin/users/{id}', 'profile'].join('/')

/** What a person's page is read from: the record modal's envelope, as `user.userModalContext` answers it. */
export type UserPageEnvelope = {
  data?: { record?: { name?: string; login?: string } } & Record<string, unknown>
  messages?: Record<string, string>
} & Record<string, unknown>

/**
 * A person's page as a route: the envelope this viewer may read, the way back to the people list as it
 * was left, and the record page island placed by `joint`, inside the administration shell.
 *
 * KetSuite serves it at `/admin/users/{id}`. A deployment whose people sign in through a service of its
 * own reads a different envelope (the service's account state) and posts different commands, so it
 * serves the page at `/admin/users/{id}/profile` with this route, its own island placed by a joint it
 * fills, and `/admin/users/{id}` sends there. `beside` goes next to the page in the content slot: the
 * screen's guide.
 */
export const userPageRoute =
  (options: {
    joint: string
    context?: (
      ctx: ServeContext,
      url: URL,
      req: Req,
      id: string,
      locale: 'vi' | 'en',
    ) => Promise<UserPageEnvelope | null>
    beside?: (_: Translator, title: string, frame: Frame) => JSXChild
  }) =>
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const id = params.id!
    // The page arrives with the same permission-checked read the browser would make.
    const envelope = options.context
      ? await options.context(ctx, url, req, id, lang)
      : ((await ctx.call('user.userModalContext', { id, locale: lang }, url, req)) as UserPageEnvelope | null)
    const record = envelope?.data?.record
    if (!record) return text('not found', { status: 404 })
    const title = record.name || record.login || id
    const returnTo = safeUserReturnTo(url, url.searchParams.get('returnTo'))
    return adminPage(ctx, url, req, {
      title,
      translate: false,
      active: '/admin/users',
      body: async (_, frame) => {
        // The collection step returns to the list as it was left.
        const items = pageTrailItems(title, frame)
        // Settings live on the app rail, outside the main navigation tree.
        // Keep the collection step even when that tree has no active user menu.
        if (!items.some((item) => 'href' in item && item.href === '/admin/users'))
          items.unshift({ id: 'users', label: _('user_backend.users.title'), href: '/admin/users' })
        const trail = items.map((item) => ({
          label: item.label,
          href: 'href' in item && item.href ? (item.href === '/admin/users' ? returnTo : item.href) : null,
        }))
        const props: RecordPageIslandProps = {
          id,
          title,
          loadingLabel: USER_RECORD_MODAL_LABELS[lang]['recordModal.loading']!,
          trail,
          trailLabel: _('user_backend.users.title'),
          envelope,
        }
        const page = await ctx.joint(url, req, options.joint, props)
        return userPageScreen(
          _,
          title,
          options.beside ? [page, options.beside(_, title, frame)] : page,
          frame,
        )
      },
    })
  }

/**
 * One narrowing question, offered beside paging.
 *
 * Choosing the row that is already chosen clears it, so the menu is both how a
 * filter is set and how it is dropped.
 */
const translatedErrors = (ctx: ServeContext, url: URL, req: Req, result: unknown): string[] => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  return ((result as { errors?: Array<{ field?: string; code?: string }> } | null)?.errors ?? []).map(
    (error) => `${error.field ? `${error.field}: ` : ''}${_(error.code ?? 'user.error.required')}`,
  )
}

const userOf = (ctx: ServeContext, url: URL, req: Req, id: string) =>
  ctx.call('user.getUser', { id }, url, req) as Promise<UserRow | null>

const rolesOf = (ctx: ServeContext, url: URL, req: Req) =>
  ctx.call('user.listRoles', {}, url, req) as Promise<RoleRow[]>

const accessOptions = async (ctx: ServeContext, url: URL, req: Req) => {
  const [companies, roles] = await Promise.all([
    ctx.call('company.listCompanies', { includeArchived: false }, url, req) as Promise<AnyRow[]>,
    rolesOf(ctx, url, req),
  ])
  const branches = (
    await Promise.all(
      companies.map(
        (company) =>
          ctx.call(
            'company.listBranches',
            { companyId: company.id, includeArchived: false },
            url,
            req,
          ) as Promise<AnyRow[]>,
      ),
    )
  ).flat()
  return {
    companies: companies.map((company) => ({
      value: String(company.id),
      label: String(company.name),
    })),
    branches: branches.map((branch) => ({
      value: String(branch.id),
      label: `${String(branch.code)} · ${String(branch.name)}`,
      companyId: String(branch.companyId),
    })),
    roles: roles.map((role) => ({ value: role.id, label: role.name })),
  }
}

const sessionRows = async (ctx: ServeContext, url: URL, req: Req, userId: string): Promise<SessionRow[]> => {
  const sessions = await ctx.sessionsOf(url, req)
  if (!sessions) return []
  const current = await sessions.of(req)
  return (await sessions.store.listUser(userId)).map((row) => ({
    id: row.id,
    current: row.id === current?.id,
    company: row.company,
    branch: row.branch,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }))
}

export const routes: Record<string, RouteEntry> = {
  ...accessPolicyRoutes,
  ...managedRoleRoutes,
  '/admin/users':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const live = await ctx.live(req)
      if (live.routes['/admin/users/directory']) return seeOther(`/admin/users/directory${url.search}`)
      // A person is read on their own page; links written for the old modal land there.
      const named = readRecordModalTarget(url)
      if (named?.kind === 'user.user' && named.id !== RECORD_NEW_ID) {
        const closed = new URL(recordModalClosedHref(url.href), url)
        return seeOther(userDetailPath(url, named.id, `${closed.pathname}${closed.search}`))
      }
      // An identity adapter that owns account creation keeps its own page; only the
      // deployments without one open the create action in the record modal.
      const deploymentCreatesAccounts = !!live.routes[accountCreationRoute]
      if (!(await ctx.allows('user.listUsers', url, req))) return text('Forbidden', { status: 403 })
      // The create action is offered to whoever the create modal would answer; a
      // viewer who may only read people is not shown a button that opens a refusal.
      const mayCreate = await ctx.allows('user.createUser', url, req)
      const mayChangeActive = await ctx.allows('user.archiveUser', url, req)
      return adminPage(ctx, url, req, {
        title: 'user_backend.users.title',
        active: '/admin/users',
        body: async (_, frame) => {
          const target = rowListTarget(url, `${url.pathname}${url.search}`, USERS_PATH)!
          const returnTo = safeUserReturnTo(url, `${target.pathname}${target.search}`)
          const bar = await rowListBar(ctx, url, req, userListSearch, target, userListBarOptions(_))
          // Rows are checked to change many people at once; the form only exists for
          // a viewer who may change whether someone is active.
          const selection: TableSelection | null = mayChangeActive
            ? {
                formId: 'user-people-bulk',
                action: inLocale(url, '/admin/users/bulk'),
                hidden: { returnTo },
                presentation: 'bar',
                actions: [
                  { id: 'activate', label: _('user_backend.action.activateSelected') },
                  { id: 'deactivate', label: _('user_backend.action.deactivateSelected'), tone: 'danger' },
                ],
              }
            : null
          const islands = rowListIslands(
            userListProps(_, {
              href: `${target.pathname}${target.search}`,
              read: inLocale(url, USERS_READ_PATH),
              bar,
              lang: url.searchParams.get('lang'),
              selection,
            }),
          )
          return usersScreen(_, frame, {
            islands,
            selection,
            lang: _.locale === 'en' ? 'en' : 'vi',
            createHref: !mayCreate
              ? null
              : deploymentCreatesAccounts
                ? withUserReturnTo(url, '/admin/users/new', returnTo)
                : recordModalCreateHref(`${target.pathname}${target.search}`, { kind: 'user.user' }),
          })
        },
      })
    },

  // One page of people, for whoever may list them: searched and narrowed by the list's spec, and by
  // a company or a role through `user.listUsers` itself, whose choices come with the answer.
  [USERS_READ_PATH]: rowListReadRoute(async (ctx, url, req, href) => {
    if (!(await ctx.allows('user.listUsers', url, req))) return null
    const target = rowListTarget(url, href, USERS_PATH)
    if (!target) return undefined
    const _ = ctx.translate(ctx.localeOf(url, req))
    const [companies, roles, people] = (await Promise.all([
      ctx.call('company.listCompanies', {}, url, req),
      ctx.call('user.listRoles', {}, url, req),
      ctx.call(
        'user.listUsers',
        {
          includeArchived: target.searchParams.get('archived') === '1',
          companyId: target.searchParams.get('company') || undefined,
          roleId: target.searchParams.get('role') || undefined,
        },
        url,
        req,
      ),
    ])) as [AnyRow[], AnyRow[], UserRow[]]
    const answer = await rowListAnswer(ctx, url, req, {
      spec: userListSearch,
      rows: people,
      target,
      view: userGridRow(_),
      search: userListBarOptions(_),
      groupLabel: (key, value) => userGroupLabel(_, key, value),
      filters: ['company', 'role'],
    })
    return {
      ...answer,
      menus: [
        rowListMenu(target, 'company', _('user_backend.field.company'), companies),
        rowListMenu(target, 'role', _('user_backend.field.role'), roles),
      ],
    }
  }),

  // Many people made active or inactive at once, from the rows checked in the list.
  // Each person goes through `user.archiveUser` on its own, so the guard that keeps
  // the last full administrator active still answers for every one of them.
  '/admin/users/bulk':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Cross-site request', { status: 403 })
      const form = await readForm(req)
      const returnTo = safeUserReturnTo(url, form.returnTo)
      const ids = Object.keys(form)
        .filter((key) => key.startsWith('selected.'))
        .map((key) => key.slice('selected.'.length))
        .filter(Boolean)
      if (form.action !== 'activate' && form.action !== 'deactivate')
        return text('Unknown bulk action', { status: 400 })
      for (const id of ids)
        await ctx.call('user.archiveUser', { id, active: form.action === 'activate' }, url, req)
      return seeOther(returnTo)
    },

  '/admin/users/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      if ((await ctx.live(req)).routes[accountCreationRoute])
        return seeOther(inLocale(url, accountCreationRoute))
      return seeOther(
        recordModalCreateHref(new URL(safeUserReturnTo(url, url.searchParams.get('returnTo')), url), {
          kind: 'user.user',
        }),
      )
    },
  '/admin/users/{id}': (ctx: ServeContext): Route => {
    const page = userPageRoute({ joint: 'user_backend:user.record-page' })(ctx)
    return async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      // A deployment whose people sign in elsewhere serves the person's page itself, with that
      // service's state and commands; every link written for this one lands there.
      if ((await ctx.live(req)).routes[deploymentUserPageRoute])
        return seeOther(`/admin/users/${encodeURIComponent(params.id!)}/profile${url.search}`)
      return page(url, req, params)
    }
  },
  '/admin/users/{id}/sessions/{sessionId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      if (form.action !== 'revoke') return text('invalid action', { status: 400 })
      const sessions = await ctx.sessionsOf(url, req)
      if (!sessions)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.sessionsUnavailable'), {
          status: 501,
        })
      const current = await sessions.of(req)
      if (!current)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      // Session management remains self-service; administrators use password reset.
      if (params.id !== current.userId) return text('Forbidden', { status: 403 })
      const held = (await sessions.store.listUser(params.id)).find((row) => row.id === params.sessionId)
      if (held) await sessions.store.destroy(held.id)
      await ctx.call('user.recordSecurityEvent', { event: 'session.revoke', userId: params.id }, url, req)
      return seeOther(
        params.id === current?.userId
          ? inLocale(url, '/admin/profile')
          : userDetailPath(url, params.id, safeUserReturnTo(url, url.searchParams.get('returnTo'))),
      )
    },

  '/admin/profile':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const sessions = await ctx.sessionsOf(url, req)
      const record = await sessions?.of(req)
      if (!record)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      const row = (await ctx.callUnchecked('user.getUser', { id: record.userId }, url, req)) as UserRow | null
      if (!row)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      return adminPage(ctx, url, req, {
        title: 'user_backend.profile.title',
        active: '/admin/profile',
        body: async (_, frame) =>
          profileScreen(
            _,
            row,
            {
              sessions: await sessionRows(ctx, url, req, row.id),
              timezoneAction: inLocale(url, '/admin/profile/timezone'),
              passwordAction: inLocale(url, '/admin/profile/password'),
              sessionAction: (session) =>
                inLocale(
                  url,
                  `/admin/users/${encodeURIComponent(row.id)}/sessions/${encodeURIComponent(session.id)}`,
                ),
              integration: await ctx.joint(url, req, 'user_backend:profile.external-identities', {
                userId: row.id,
              }),
            },
            frame,
          ),
      })
    },

  '/admin/profile/password':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const sessions = await ctx.sessionsOf(url, req)
      const record = await sessions?.of(req)
      if (!sessions || !record)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      const form = await readForm(req)
      if (form.action && form.action !== 'change') return text('invalid action', { status: 400 })
      const result = (await ctx.call(
        'user.setPassword',
        {
          id: record.userId,
          currentPassword: form.currentPassword ?? '',
          newPassword: form.newPassword ?? '',
        },
        url,
        req,
      )) as { ok?: boolean; securityVersion?: number }
      if (!result.ok) {
        const row = (await ctx.callUnchecked(
          'user.getUser',
          {
            id: record.userId,
          },
          url,
          req,
        )) as UserRow | null
        if (!row)
          return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), {
            status: 401,
          })
        const _ = ctx.translate(ctx.localeOf(url, req))
        return adminPage(ctx, url, req, {
          title: 'user_backend.profile.title',
          active: '/admin/profile',
          body: async (_, frame) =>
            profileScreen(
              _,
              row,
              {
                sessions: await sessionRows(ctx, url, req, row.id),
                timezoneAction: inLocale(url, '/admin/profile/timezone'),
                passwordAction: inLocale(url, '/admin/profile/password'),
                sessionAction: (session) =>
                  inLocale(
                    url,
                    `/admin/users/${encodeURIComponent(row.id)}/sessions/${encodeURIComponent(session.id)}`,
                  ),
                passwordErrors: translatedErrors(ctx, url, req, result),
                integration: await ctx.joint(url, req, 'user_backend:profile.external-identities', {
                  userId: row.id,
                }),
              },
              frame,
            ),
        })
      }
      await sessions.endUserExcept(record.userId, record.id)
      const context: SessionContext = {
        companies: record.companies,
        company: record.company,
        branches: record.branches,
        branch: record.branch,
        securityVersion: Number(result.securityVersion ?? record.securityVersion),
      }
      if (!(await sessions.update(record, context))) return seeOther('/login')
      return seeOther(inLocale(url, '/admin/profile'))
    },

  '/admin/profile/timezone':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const sessions = await ctx.sessionsOf(url, req)
      const record = await sessions?.of(req)
      if (!record)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      const form = await readForm(req)
      if (form.action && form.action !== 'save') return text('invalid action', { status: 400 })
      const result = (await ctx.callUnchecked(
        'user.setTimezone',
        { timezone: form.timezone ?? '' },
        url,
        req,
      )) as {
        ok?: boolean
      }
      return result.ok
        ? seeOther(inLocale(url, '/admin/profile'))
        : seeOther(inLocale(url, '/admin/profile?invalid=timezone'))
    },
}
