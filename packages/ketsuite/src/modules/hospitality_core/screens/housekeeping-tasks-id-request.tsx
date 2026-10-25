import { cleaningTaskWorkspaceRequest } from './cleaning-task-workspace-request.tsx'
import { operationErrors, readForm, renderCleaningTaskDetail, seeOther, text } from './request-shared.tsx'
import type { OperationResult, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestHousekeepingTasksId: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'GET') return cleaningTaskWorkspaceRequest(ctx)(url, req, params)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const form = await readForm(req)
    let result: OperationResult
    let status: 'started' | 'completed' | 'cancelled'
    if (form.operation === 'start') {
      result = (await ctx.call(
        'hospitality_core.startCleaningTask',
        { id: params.id, assigneeId: form.assigneeId?.trim() || undefined },
        url,
        req,
      )) as OperationResult
      status = 'started'
    } else if (form.operation === 'complete') {
      result = (await ctx.call(
        'hospitality_core.completeCleaningTask',
        {
          id: params.id,
          checklist: ['linen', 'bathroom', 'supplies', 'final'].filter(
            (key) => form[`check-${key}`] === 'yes',
          ),
          completionNotes: form.completionNotes ?? '',
          expectedVersion: Number(form.expectedVersion),
          requestKey: form.requestKey,
        },
        url,
        req,
      )) as OperationResult
      status = 'completed'
    } else if (form.operation === 'cancel') {
      result = (await ctx.call(
        'hospitality_core.cancelCleaningTask',
        { id: params.id },
        url,
        req,
      )) as OperationResult
      status = 'cancelled'
    } else return text('unknown action', { status: 400 })

    if (!result.ok)
      return renderCleaningTaskDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
    const query = new URLSearchParams({ status })
    const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
    if (lang) query.set('lang', lang)
    return seeOther(`${url.pathname}?${query.toString()}`)
  }
