import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, SessionContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { Req } from '../backend/screen.ts'
import { contextScreen } from './screens/index.ts'
import type { ContextBranch, ContextCompany } from './screens/index.ts'

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const translatedErrors = (result: unknown, _: ReturnType<ServeContext['translate']>): string[] =>
  ((result as { errors?: Array<{ field?: string; code?: string }> } | null)?.errors ?? []).map(
    (error) => `${error.field ? `${error.field}: ` : ''}${_(error.code ?? 'user_backend.context.invalid')}`,
  )

/**
 * The branch a switch writes to. Choosing another company while the branch still
 * names one of the old company's means "work in that company", so the new company's
 * root branch, or its first, stands in.
 */
const branchForCompany = (
  branches: readonly ContextBranch[],
  companyId: string,
  branchId: string,
): string => {
  const own = branches.filter((branch) => branch.companyId === companyId)
  if (own.some((branch) => branch.id === branchId)) return branchId
  return (own.find((branch) => branch.isRoot) ?? own[0])?.id ?? branchId
}

/**
 * The working context. Every deployment composes it: a session works in one company,
 * and this is where its user switches to another.
 */
export const contextRoutes: Record<string, RouteEntry> = {
  '/admin/context': {
    handler:
      (ctx: ServeContext): Route =>
      async (url, req) => {
        const sessions = await ctx.sessionsOf(url, req)
        const record = await sessions?.of(req)
        if (!sessions || !record) return text('Unauthorized', { status: 401 })
        const _ = ctx.translate(ctx.localeOf(url, req))
        const options = (await ctx.call('user.contextOptions', { userId: record.userId }, url, req)) as {
          companies: ContextCompany[]
          branches: ContextBranch[]
        }
        const render = (
          errors?: string[],
          values: { companyId?: string; branchId?: string; branches?: string[] } = {},
        ) =>
          adminPage(ctx, url, req, {
            title: 'user_backend.context.title',
            active: '/admin/context',
            body: (_, frame) =>
              contextScreen(_, frame, {
                ...options,
                selectedBranches:
                  values.branches ?? record.branches ?? options.branches.map((branch) => branch.id),
                companyId: values.companyId ?? record.company ?? '',
                branchId: values.branchId ?? record.branch ?? '',
                action: inLocale(url, '/admin/context'),
                errors,
              }),
          })
        if (req.method === 'GET') return render()
        if (req.method !== 'POST') return text('GET or POST', { status: 405 })
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        // The form names its save command. Keep accepting an absent action for
        // established API/test clients that predate explicit commands.
        if (form.action && form.action !== 'save') return text('invalid action', { status: 400 })
        const companyId = form.companyId ?? ''
        const branchId = branchForCompany(options.branches, companyId, form.branchId ?? '')
        const branches = Object.keys(form)
          .filter((key) => key.startsWith('branch.'))
          .map((key) => key.slice('branch.'.length))
        const result = (await ctx.call(
          'user.prepareContext',
          {
            userId: record.userId,
            companyId,
            branchId,
            companies: [companyId],
            branches,
            securityVersion: record.securityVersion,
          },
          url,
          req,
        )) as { ok?: boolean; context?: SessionContext; errors?: unknown[] }
        if (!result.ok || !result.context)
          return render(translatedErrors(result, _), { companyId, branchId, branches })
        if (!(await sessions.update(record, result.context)))
          return render([_('user_backend.context.conflict')], { companyId, branchId, branches })
        await ctx.call(
          'user.recordSecurityEvent',
          {
            event: 'context.switch',
            userId: record.userId,
            metadata: { company: result.context.company, branch: result.context.branch },
          },
          url,
          req,
        )
        return seeOther(inLocale(url, '/admin/context'))
      },
  },
}
