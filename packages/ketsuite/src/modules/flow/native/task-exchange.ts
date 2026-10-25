import { asc, eq, from, gt } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { createFlowServerExtensions } from '@ketvietlab/flow-client/server'
import {
  exchangeFields,
  exchangeSchema,
  exchangeVersion,
} from '@ketvietlab/flow-client/exchange-contract.mjs'
import { hash, mutate, now, revision } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { FlowRefusal, owned, refuse, requireCapability, string } from './policy.ts'
import { taskByKey, taskDTOs } from './queries.ts'
import { writeTask } from './tasks.ts'

const mapped = (id: unknown, mapping: unknown): unknown => {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return id
  return Object.hasOwn(mapping, string(id)) ? (mapping as Row)[string(id)] : id
}
function checkedRows(input: Row): Row[] {
  if (
    input.schema !== exchangeSchema ||
    input.version !== exchangeVersion ||
    !['create', 'update'].includes(string(input.mode)) ||
    typeof input.importId !== 'string' ||
    !input.importId ||
    input.importId.length > 128 ||
    !Array.isArray(input.rows) ||
    !input.rows.length ||
    input.rows.length > 100 ||
    Buffer.byteLength(JSON.stringify(input.rows)) > 1024 * 1024
  )
    return refuse('validation', { rows: 'exchange_batch_invalid' })
  const seen = new Set<string>()
  for (const row of input.rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !exchangeFields.includes(key)) ||
      typeof row.sourceId !== 'string' ||
      !row.sourceId.trim() ||
      row.sourceId.length > 1000 ||
      seen.has(row.sourceId)
    )
      return refuse('validation', { rows: 'exchange_source_invalid' })
    seen.add(row.sourceId)
  }
  return input.rows as Row[]
}
function taskInput(row: Row, input: Row): Row {
  const value: Row = { projectId: input.projectId }
  for (const key of exchangeFields)
    if (!['sourceId', 'id', 'expectedVersion'].includes(key) && row[key] !== undefined) value[key] = row[key]
  const maps = (input.mapping ?? {}) as Row
  if (
    maps &&
    (typeof maps !== 'object' ||
      Array.isArray(maps) ||
      Object.keys(maps).some((key) => !['columns', 'types', 'labels', 'assignees', 'fields'].includes(key)))
  )
    return refuse('validation', { mapping: 'invalid' })
  for (const [field, category] of [
    ['columnId', 'columns'],
    ['typeId', 'types'],
  ])
    if (value[field]) value[field] = mapped(value[field], maps[category])
  for (const [field, category] of [
    ['tagIds', 'labels'],
    ['assigneeIds', 'assignees'],
  ])
    if (Array.isArray(value[field]))
      value[field] = (value[field] as unknown[]).map((id) => mapped(id, maps[category]))
  if (value.fieldValues && typeof value.fieldValues === 'object' && !Array.isArray(value.fieldValues)) {
    const fields: Row = Object.create(null)
    for (const [id, fieldValue] of Object.entries(value.fieldValues)) {
      const target = string(mapped(id, maps.fields))
      if (Object.hasOwn(fields, target)) return refuse('validation', { mapping: 'duplicate_field' })
      fields[target] = fieldValue
    }
    value.fieldValues = fields
  }
  if (input.mode === 'update') {
    value.id = row.id
    value.expectedVersion = row.expectedVersion
  }
  return value
}
const digestOf = (input: Row, changeRevision: number) =>
  hash(
    JSON.stringify([
      input.projectId,
      input.importId,
      input.mode,
      input.rows,
      input.mapping ?? {},
      changeRevision,
    ]),
  )
class PreviewRollback extends Error {
  readonly value: Row
  constructor(value: Row) {
    super('preview rollback')
    this.value = value
  }
}

async function importRows(
  ctx: Ctx,
  input: Row,
  rows: Row[],
  extensions: NativeServerExtension[],
  preview: boolean,
) {
  const registry = createFlowServerExtensions<Ctx>(extensions),
    results: Row[] = []
  for (const [index, row] of rows.entries()) {
    try {
      const args = taskInput(row, input),
        existing = input.mode === 'update' ? await taskByKey(ctx, args.id) : null
      if (existing && existing.projectId !== input.projectId) return refuse('validation', { id: 'scope' })
      if (
        existing &&
        args.description !== undefined &&
        string(args.description) !== existing.description &&
        (existing.contentAttachmentId || existing.descriptionDoc)
      )
        return refuse('validation', { description: 'edit_live_document' })
      const rowId = hash(
        JSON.stringify([
          ctx.scope.company,
          ctx.actor,
          input.projectId,
          'flow.issue.import.row',
          input.importId,
          row.sourceId,
        ]),
      )
      const requestDigest = hash(JSON.stringify(args)),
        R = ctx.table('flow.CommandReceipt')
      const receipt = await ctx.db.one(from(R).where(eq(R.companyId, ctx.scope.company), eq(R.id, rowId)))
      if (receipt) {
        if (receipt.requestDigest !== requestDigest) return refuse('replay_mismatch')
        const held = await taskByKey(ctx, (receipt.result as Row).id)
        if (held.projectId !== input.projectId) return refuse('conflict')
        results.push({ sourceId: row.sourceId, ...(receipt.result as Row), replayed: true })
        continue
      }
      const mutation = { name: 'flow.issue.save', capability: 'project.write', input: args }
      const value = await registry.mutate(
        {
          requireCapability: (capability, args) => requireCapability(ctx, capability, args),
          transaction: (work) => work(ctx),
        },
        mutation,
        (tx) => writeTask(tx, args, existing),
      )
      results.push({ sourceId: row.sourceId, ...value })
      if (!preview)
        await ctx.db.insert('flow.CommandReceipt', {
          id: rowId,
          actorId: ctx.actor,
          command: 'flow.issue.import.row',
          projectId: input.projectId,
          requestDigest,
          result: value,
          createdAt: now(),
        })
    } catch (error) {
      if (!(error instanceof FlowRefusal)) throw error
      if (!preview)
        return refuse(
          error.code,
          Object.fromEntries(
            Object.entries(error.fields).map(([key, value]) => ['rows.' + index + '.' + key, value]),
          ),
        )
      results.push({ sourceId: row.sourceId, ok: false, index, code: error.code, fields: error.fields })
    }
  }
  return results
}

export async function previewTaskImport(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const rows = checkedRows(input)
  try {
    await mutate(
      ctx,
      { name: 'flow.issue.importPreview', capability: 'project.write', input },
      extensions,
      async (tx) => {
        const changeRevision = await revision(tx, 'project-change:' + input.projectId)
        const results = await importRows(tx, input, rows, extensions, true)
        throw new PreviewRollback({
          ok: true,
          valid: results.every((row) => row.ok),
          rows: results,
          previewDigest: digestOf(input, changeRevision),
        })
      },
    )
  } catch (error) {
    if (error instanceof PreviewRollback) return error.value
    throw error
  }
}
export async function applyTaskImport(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const rows = checkedRows(input)
  return mutate(
    ctx,
    { name: 'flow.issue.importApply', capability: 'project.write', input },
    extensions,
    async (tx) => {
      const changeRevision = await revision(tx, 'project-change:' + input.projectId)
      if (input.previewDigest !== digestOf(input, changeRevision))
        return refuse('conflict', { previewDigest: 'stale_preview' })
      const results = await importRows(tx, input, rows, extensions, false)
      return {
        ok: true,
        rows: results,
        imported: results.filter((row) => !row.replayed).length,
        replayed: results.filter((row) => row.replayed).length,
      }
    },
  )
}

export async function exportTasks(ctx: Ctx, input: Row) {
  await requireCapability(ctx, 'project.read', input)
  const project = await owned(ctx, 'flow.ProjectRecord', input.projectId)
  if (project.archived) return refuse('archived')
  const changeRevision = await revision(ctx, 'project-change:' + input.projectId)
  if (input.expectedRevision !== undefined && input.expectedRevision !== changeRevision)
    return refuse('conflict')
  const cursor = string(input.cursor),
    limit = input.limit ?? 25
  if (cursor.length > 100 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100)
    return refuse('validation', { limit: 'invalid' })
  const T = ctx.table('flow.Task'),
    tasks = await ctx.db.all(
      from(T)
        .where(
          eq(T.companyId, ctx.scope.company),
          eq(T.projectId, input.projectId),
          eq(T.archived, false),
          ...(cursor ? [gt(T.id, cursor)] : []),
        )
        .orderBy(asc(T.id))
        .limit(Number(limit) + 1),
    )
  const selected = tasks.slice(0, Number(limit)),
    detail = await taskDTOs(ctx, selected, true)
  const rows = detail.map((task) => ({
    sourceId: task.id,
    id: task.id,
    expectedVersion: task.version,
    title: task.title,
    description: task.description,
    priority: task.priority,
    points: task.points,
    columnId: task.status,
    typeId: task.typeId,
    dueDate: task.dueDate,
    startDate: task.startDate,
    tagIds: task.tags,
    assigneeIds: task.assignees?.map((user: Row) => user.id),
    fieldValues: task.fieldValues,
    checklist: task.checklist,
  }))
  await requireCapability(ctx, 'project.read', input)
  if (changeRevision !== (await revision(ctx, 'project-change:' + input.projectId))) return refuse('conflict')
  if (Buffer.byteLength(JSON.stringify(rows)) > 2 * 1024 * 1024)
    return refuse('limit', { limit: 'exchange_page_too_large' })
  return {
    ok: true,
    schema: exchangeSchema,
    version: exchangeVersion,
    rows,
    revision: changeRevision,
    cursor: tasks.length > selected.length ? selected.at(-1)!.id : null,
  }
}
