import {
  adminPage,
  defaultPropertyValues,
  newPropertyScreen,
  operationErrors,
  propertyFormValues,
  propertySaveInput,
  randomUUID,
  readForm,
  seeOther,
  text,
} from './request-shared.tsx'
import type { BranchChoice, OperationResult, PolicyRow, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestPropertiesNew: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const policies = (await ctx.call(
      'hospitality_core.listCancellationPolicies',
      {},
      url,
      req,
    )) as PolicyRow[]
    const scope = await ctx.scopeOf(url, req)
    const branches = scope.company
      ? ((await ctx.call('company.listBranches', { companyId: scope.company }, url, req)) as BranchChoice[])
      : []
    if (req.method === 'GET') {
      const values = defaultPropertyValues(randomUUID())
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.property.create.title',
        body: (_, frame) => newPropertyScreen(_, values, policies, branches, lang, frame),
      })
    }
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const form = await readForm(req)
    const values = propertyFormValues(randomUUID(), form)
    const result = (await ctx.call(
      'hospitality_core.saveProperty',
      propertySaveInput(values),
      url,
      req,
    )) as OperationResult
    if (!result.ok)
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.property.create.title',
        body: (_, frame) =>
          newPropertyScreen(
            _,
            values,
            policies,
            branches,
            lang,
            frame,
            operationErrors(ctx, url, req, result),
          ),
      })
    const query = new URLSearchParams({ status: 'created', lang })
    return seeOther(`/admin/hospitality/properties/${encodeURIComponent(values.id)}?${query.toString()}`)
  }
