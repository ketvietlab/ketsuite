import { defineModule } from '@ketvietlab/ketjs'
import type { JsonSchema, Row, Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, idempotencyKey, routesOf } from '../channel_api/core.ts'

type Req = Parameters<Route>[1]
const text: JsonSchema = { type: 'string' }
const nullableText: JsonSchema = { type: ['string', 'null'] }
const object = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
})
const strings: JsonSchema = { type: 'array', items: text, maxItems: 30 }
const taskProperties: Record<string, JsonSchema> = {
  id: text,
  projectId: text,
  title: text,
  columnId: nullableText,
  priority: text,
  assigneeIds: strings,
  dueDate: nullableText,
  startDate: nullableText,
  version: { type: 'integer' },
  archived: { type: 'boolean' },
  updatedAt: text,
}
const task = object(taskProperties)
const detail = object({
  ...taskProperties,
  description: nullableText,
  epicId: nullableText,
  sprintId: nullableText,
  fieldValues: { type: 'object' },
  checklist: { type: 'array', items: object({ id: text, text, checked: { type: 'boolean' } }) },
})
// Channel routes describe the `data` envelope schema; the framework writes the OpenAPI response.
const response = (schema: JsonSchema) => ({
  '200': { type: 'object', properties: { data: schema, error: {}, meta: { type: 'object' } } },
})
const summary = (row: Row, full = false) => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  columnId: row.columnId ?? null,
  priority: row.priority,
  assigneeIds: row.assigneeIds ?? [],
  dueDate: row.dueDate ?? null,
  startDate: row.startDate ?? null,
  version: Number(row.version),
  archived: Boolean(row.archived),
  updatedAt: row.updatedAt,
  ...(full
    ? {
        description: row.description ?? null,
        epicId: row.epicId ?? null,
        sprintId: row.sprintId ?? null,
        fieldValues: row.fieldValues ?? {},
        checklist: row.checklist ?? [],
      }
    : {}),
})
const failure = (ctx: ServeContext, url: URL, req: Req, result: Row) => {
  const errors = Array.isArray(result.errors) ? (result.errors as Row[]) : []
  const code = String(errors[0]?.code ?? 'unavailable')
  return {
    status:
      code === 'forbidden'
        ? 403
        : code === 'not_found'
          ? 404
          : ['conflict', 'replay_mismatch'].includes(code)
            ? 409
            : 422,
    error: channelError(ctx, url, req, 'flow.' + code, {
      messageKey: 'flow_staff_channel.error.invalidRequest',
      fieldErrors: Object.fromEntries(
        Object.entries((result.fields ?? {}) as Row).map(([field, reason]) => [
          field,
          { code: String(reason), messageKey: 'flow_staff_channel.error.invalidRequest', params: {} },
        ]),
      ),
    }),
  }
}
const body = (properties: Record<string, JsonSchema>, required = Object.keys(properties)) =>
  object({ expectedVersion: { type: 'integer', minimum: 1 }, ...properties }, [
    'expectedVersion',
    ...required,
  ])
const routeParams = object({ id: text })

/** Explicit Flow resource v2: UUID projects, task keys and multiple assignees. */
export function createNativeFlowStaffChannel() {
  const routes = routesOf(
    defineChannelRoute({
      profile: 'staff',
      method: 'GET',
      path: 'flow/v2/projects',
      operationId: 'staff.flow.v2.projects',
      auth: 'required',
      summary: 'Read authorized native projects with a cursor.',
      request: {
        query: object({ query: text, cursor: text, limit: { type: 'integer', minimum: 1, maximum: 50 } }, []),
      },
      responses: response(
        object({
          items: { type: 'array', items: object({ id: text, code: text, title: text, workspaceId: text }) },
          cursor: nullableText,
          total: { type: 'integer' },
        }),
      ),
      handler: async (ctx, url, req) => {
        const value = (await ctx.call(
          'flow.project.options',
          {
            query: url.searchParams.get('query') || undefined,
            cursor: url.searchParams.get('cursor') || undefined,
            limit: Number(url.searchParams.get('limit') ?? 25),
          },
          url,
          req,
        )) as Row
        return value.ok === false ? failure(ctx, url, req, value) : { data: value }
      },
    }),
    defineChannelRoute({
      profile: 'staff',
      method: 'GET',
      path: 'flow/v2/issues',
      operationId: 'staff.flow.v2.issues',
      auth: 'required',
      summary: 'Read native task summaries in the caller’s scope.',
      request: {
        query: object(
          {
            projectId: text,
            query: text,
            mine: { type: 'boolean' },
            cursor: text,
            limit: { type: 'integer', minimum: 1, maximum: 50 },
          },
          [],
        ),
      },
      responses: response(
        object({
          items: { type: 'array', items: task },
          cursor: nullableText,
          total: { type: 'integer' },
          statusCounts: { type: 'object' },
        }),
      ),
      handler: async (ctx, url, req) => {
        const value = (await ctx.call(
          'flow.issue.list',
          {
            projectId: url.searchParams.get('projectId') || undefined,
            query: url.searchParams.get('query') || undefined,
            mine: url.searchParams.get('mine') === 'true',
            cursor: url.searchParams.get('cursor') || undefined,
            limit: Number(url.searchParams.get('limit') ?? 25),
          },
          url,
          req,
        )) as Row
        return value.ok === false
          ? failure(ctx, url, req, value)
          : {
              data: {
                items: (value.tasks as Row[]).map((row) => summary(row)),
                cursor: value.cursor,
                total: value.total,
                statusCounts: value.statusCounts,
              },
            }
      },
    }),
    defineChannelRoute({
      profile: 'staff',
      method: 'GET',
      path: 'flow/v2/issues/{id}',
      operationId: 'staff.flow.v2.issue',
      auth: 'required',
      summary: 'Read authorized native task details.',
      request: { params: routeParams },
      responses: response(detail),
      handler: async (ctx, url, req, params) => {
        const value = (await ctx.call('flow.issue.detail', { id: params.id }, url, req)) as Row
        return value.ok === false ? failure(ctx, url, req, value) : { data: summary(value.task as Row, true) }
      },
    }),
    ...(['move', 'assign', 'comment'] as const).map((action) =>
      defineChannelRoute({
        profile: 'staff',
        method: 'POST',
        path: `flow/v2/issues/{id}/${action}`,
        operationId: `staff.flow.v2.issue.${action}`,
        auth: 'required',
        idempotent: true,
        summary: `Apply a native ${action} through Core’s capability and extension guards.`,
        request: {
          params: routeParams,
          body:
            action === 'move'
              ? body({ columnId: text })
              : action === 'assign'
                ? body({ assigneeIds: strings })
                : object({ text: { type: 'string', minLength: 1, maxLength: 100000 } }),
        },
        responses: response(action === 'comment' ? object({ id: text, taskId: text }) : detail),
        handler: async (ctx, url, req, params, request) => {
          const key = idempotencyKey(ctx, url, req)
          if (typeof key !== 'string') return key
          const name =
            action === 'move'
              ? 'flow.issue.move'
              : action === 'assign'
                ? 'flow.issue.save'
                : 'flow.issue.comment'
          const value = (await ctx.call(
            name,
            { id: params.id, ...request.body, idempotencyKey: key },
            url,
            req,
          )) as Row
          return value.ok === false
            ? failure(ctx, url, req, value)
            : {
                data:
                  action === 'comment'
                    ? { id: value.id, taskId: value.taskId }
                    : summary((value.record as Row).task as Row, true),
              }
        },
      }),
    ),
  )
  return defineModule({
    name: 'flow_staff_channel',
    version: '0.2.0',
    depends: ['channel_api', 'flow'],
    compatible: { channel_api: '^1' },
    title: 'Native Flow staff channel',
    summary: 'Versioned native staff contract.',
    category: 'Productivity',
    routes,
    messages: {
      vi: { 'error.invalidRequest': 'Không thể thực hiện thao tác này.' },
      en: { 'error.invalidRequest': 'The command cannot be performed.' },
    },
  })
}
