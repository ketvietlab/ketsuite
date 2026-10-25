import { propertyWorkbenchAction } from './property-workbench-actions.ts'
import {
  operationErrors,
  propertyFormValues,
  propertySaveInput,
  readForm,
  renderPropertyDetail,
  seeOther,
  text,
} from './request-shared.tsx'
import type { OperationResult, PropertyDetail, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestPropertiesId: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'GET') return renderPropertyDetail(ctx, url, req, params.id)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const profile = (await ctx.call('hospitality_core.getPropertyProfile', { id: params.id }, url, req)) as {
      property: PropertyDetail | null
    }
    const current = profile.property
    if (!current) return text('Not found', { status: 404 })
    const form = await readForm(req)
    const command = await propertyWorkbenchAction(ctx, url, req, params.id, form)
    if (command) {
      if (!command.ok)
        return renderPropertyDetail(
          ctx,
          url,
          req,
          params.id,
          operationErrors(ctx, url, req, command),
          undefined,
          form,
        )
      const next = new URL(url)
      next.searchParams.delete('dialog')
      next.searchParams.delete('item')
      next.searchParams.delete('locale')
      next.searchParams.set('status', 'saved')
      return seeOther(next.pathname + next.search)
    }
    const values = propertyFormValues(params.id, form, current)
    const result = (await ctx.call(
      'hospitality_core.saveProperty',
      propertySaveInput(values, current),
      url,
      req,
    )) as OperationResult
    if (!result.ok)
      return renderPropertyDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), values)
    const next = new URL(url)
    next.searchParams.set('status', 'saved')
    return seeOther(next.pathname + next.search)
  }
