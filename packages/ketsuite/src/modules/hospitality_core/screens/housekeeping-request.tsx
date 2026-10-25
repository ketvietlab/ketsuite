import { collectionPages, renderHospitalityCollection } from './collection-page.tsx'
import {
  CLEANING_TASK_STATES,
  adminPage,
  cleaningTasksScreen,
  loadCollectionRows,
  modalAction,
  modalErrors,
  modalHref,
  modalResultRedirect,
  modalValues,
  propertyTimezone,
  randomUUID,
  readForm,
  text,
} from './request-shared.tsx'
import type {
  CleaningTaskRow,
  CleaningTaskSummary,
  OperationResult,
  PropertyRow,
  RoomRow,
  Route,
  ServeContext,
} from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestHousekeeping: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (
      req.method === 'GET' &&
      !['create', 'edit', 'filter', 'group', 'groups', 'favorite', 'preview'].some((name) =>
        url.searchParams.has(name),
      )
    ) {
      return renderHospitalityCollection(
        ctx,
        url,
        req,
        collectionPages.find((page) => page.id === 'housekeeping')!,
      )
    }
    if (req.method === 'POST') {
      const form = await readForm(req)
      if (form.operation !== 'create') return text('unknown action', { status: 400 })
      const id = form.id?.trim() || randomUUID()
      const result = (await ctx.call(
        'hospitality_core.createCleaningTask',
        {
          id,
          code: form.code?.trim() || `HK-${id.slice(0, 12).toUpperCase()}`,
          roomId: form.roomId?.trim() || '',
          taskType: form.taskType?.trim() || 'daily_clean',
          priority: form.priority?.trim() || 'normal',
          assigneeId: form.assigneeId?.trim() || undefined,
          notes: form.notes?.trim() || undefined,
        },
        url,
        req,
      )) as OperationResult
      return modalResultRedirect(
        url,
        Boolean(result.ok),
        'created',
        {
          property: form.propertyId,
          state: form.state === 'all' ? undefined : form.state,
          lang: form.lang,
          room: result.ok ? undefined : form.roomId,
          roomId: form.roomId,
          taskType: form.taskType,
          priority: form.priority,
          assigneeId: form.assigneeId,
          notes: form.notes,
        },
        ['roomId', 'taskType', 'priority', 'assigneeId', 'notes'],
      )
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
    const requestedProperty = url.searchParams.get('property')?.trim()
    const propertyId = properties.some((row) => row.id === requestedProperty)
      ? requestedProperty
      : properties[0]?.id
    const requestedState = url.searchParams.get('state')?.trim()
    const state = CLEANING_TASK_STATES.includes(requestedState as (typeof CLEANING_TASK_STATES)[number])
      ? requestedState!
      : 'all'
    const canCreate = await ctx.allows('hospitality_core.createCleaningTask', url, req)
    const [rows, rooms, summary] = propertyId
      ? ((await Promise.all([
          loadCollectionRows(
            (page) =>
              ctx.call(
                'hospitality_core.listCleaningTasks',
                { propertyId, state: state === 'all' ? undefined : state, ...page },
                url,
                req,
              ) as Promise<CleaningTaskRow[]>,
          ),
          canCreate ? ctx.call('hospitality_core.listRooms', { propertyId }, url, req) : Promise.resolve([]),
          ctx.call('hospitality_core.cleaningTaskSummary', { propertyId }, url, req),
        ])) as [CleaningTaskRow[], RoomRow[], CleaningTaskSummary])
      : [[], [], { todo: 0, inProgress: 0, done: 0, cancelled: 0 }]
    const timezone = await propertyTimezone(ctx, propertyId, url, req)
    const taskId = randomUUID()
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.cleaningTasks.title',
      body: (_, frame) =>
        cleaningTasksScreen(
          _,
          {
            rows,
            properties,
            propertyId,
            state,
            rooms,
            summary,
            id: taskId,
            code: `HK-${taskId.slice(0, 12).toUpperCase()}`,
            selectedRoomId: rooms.some((room) => room.id === url.searchParams.get('room'))
              ? url.searchParams.get('room')!
              : undefined,
          },
          lang,
          timezone,
          frame,
          url.searchParams.get('status'),
          canCreate
            ? {
                open: url.searchParams.get('create') === '1',
                createHref: modalHref(url, true),
                closeHref: modalHref(url, false, ['room']),
                action: modalAction(url),
                errors: modalErrors(url, _),
                values: modalValues(url, ['roomId', 'taskType', 'priority', 'assigneeId', 'notes']),
              }
            : undefined,
          canCreate,
        ),
    })
  }
