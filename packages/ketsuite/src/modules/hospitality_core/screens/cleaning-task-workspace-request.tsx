import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { shell } from '../../../ui/index.ts'
import { messages } from '../messages.ts'
import { HOSPITALITY_RECORD_LABELS } from '../records/config.ts'
import type { CleaningTaskPageData } from '../records/cleaning-task-page.tsx'
import { localDateTime } from './request-shared.tsx'
import { hospitalityAdminPage } from './hospitality-admin-page.tsx'
import { hospitalityRecordBack, hospitalityScopedHref } from './scoped-href.ts'

export const cleaningTaskWorkspaceRequest =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('hospitality_core.getCleaningTaskRecord', url, req)))
      return text('Forbidden', { status: 403 })
    const { record } = (await ctx.call(
      'hospitality_core.getCleaningTaskRecord',
      { id: params.id },
      url,
      req,
    )) as { record: Record<string, unknown> | null }
    if (!record) return text('Not found', { status: 404 })
    const locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi',
      _ = ctx.translate(locale)
    const can: Record<string, boolean> = {}
    for (const [action, fn] of Object.entries({
      start: 'startCleaningTask',
      complete: 'completeCleaningTask',
      assign: 'saveCleaningTask',
      cancel: 'cancelCleaningTask',
      decline: 'declineCleaningTask',
    }))
      can[action] = await ctx.allows(`hospitality_core.${fn}`, url, req)
    const identity = await ctx.requestIdentityOf(url, req)
    const own = can.assign || identity?.userId === record.assigneeId
    can.start = can.start === true && own
    can.complete = can.complete === true && own
    can.decline =
      can.decline === true &&
      own &&
      record.taskType === 'daily_clean' &&
      (record.room as Record<string, unknown>).status === 'occupied'
    const translated = Object.fromEntries(
      Object.keys(messages[locale])
        .filter((key) =>
          /^(taskPage\.|collection\.lookup\.|cleaningState\.|cleaningType\.|cleaningPriority\.|validation\.)/.test(
            key,
          ),
        )
        .map((key) => [`hospitality_core.${key}`, _(`hospitality_core.${key}`)]),
    )
    const fallback = hospitalityScopedHref(
      url,
      `/admin/hospitality/housekeeping?property=${encodeURIComponent(String(record.propertyId))}`,
    )
    const envelope: { data: CleaningTaskPageData; messages: Record<string, string> } = {
      data: {
        record,
        locale,
        can,
        commandKey: randomUUID(),
        scope: new URLSearchParams(
          [...url.searchParams].filter(([key]) =>
            ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
          ),
        ).toString(),
        dueLocal: record.dueAt
          ? localDateTime(
              new Date(String(record.dueAt)),
              String((record.property as Record<string, unknown>).timezone),
            )
          : '',
        backHref: hospitalityRecordBack(url.pathname + url.search, fallback),
      },
      messages: { ...translated, ...HOSPITALITY_RECORD_LABELS[locale] },
    }
    if (url.pathname.endsWith('/workspace-context')) return json(envelope)
    const title = _('hospitality_core.taskPage.title') + ' ' + String(record.code)
    const island = await ctx.joint(url, req, 'hospitality_core:cleaningTask.page', {
      id: String(record.id),
      title,
      loading: envelope.messages['recordModal.loading'],
      back: envelope.data.backHref,
      width: 'wide',
      dialog: url.searchParams.get('dialog') ?? '',
      envelope,
    })
    return hospitalityAdminPage(ctx, url, req, {
      title,
      translate: false,
      body: (_, frame) => shell(_, title, <>{island}</>, { ...frame, topbar: false, titled: false }),
    })
  }
