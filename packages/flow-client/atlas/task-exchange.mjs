import { createHash, randomUUID } from 'node:crypto'
import { atlasFlowCommand } from '@ketvietlab/flow-client/command-contract.mjs'
import {
  exchangeFields,
  exchangeSchema,
  exchangeVersion,
} from '@ketvietlab/flow-client/exchange-contract.mjs'
import { accessFor } from '@ketvietlab/flow-client/access-model.mjs'
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const map = (id, mapping) => (Object.hasOwn(mapping ?? {}, id) ? mapping[id] : id)

/** Fixture-only transactional simulation of the published exchange contract. */
export function atlasTaskExchange({ d, name, args, scenario, replay, dispatch, ok, fail }) {
  if (!['flow.issue.export', 'flow.issue.importPreview', 'flow.issue.importApply'].includes(name)) return null
  const project = d.projects.find((p) => p.id === args.projectId),
    role = project && accessFor(d, project, d.user.id).role
  if (!role) return fail('forbidden', 'Project access required')
  if (project.archived) return fail('archived', 'Project archived')
  const tasks = d.tasks
    .filter((t) => t.projectId === project.id && !t.archived)
    .sort((a, b) => a.id.localeCompare(b.id))
  const revision = parseInt(hash(tasks.map((t) => [t.id, t.version ?? 1])).slice(0, 12), 16)
  if (name === 'flow.issue.export') {
    if (args.expectedRevision !== undefined && args.expectedRevision !== revision)
      return fail('conflict', 'Export changed')
    const selected = tasks.filter((t) => !args.cursor || t.id > args.cursor),
      limit = args.limit ?? 25
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail('validation', 'Invalid limit')
    const rows = selected.slice(0, limit).map((t) => ({
      sourceId: t.id,
      id: t.id,
      expectedVersion: t.version ?? 1,
      title: t.title,
      description: t.description ?? '',
      priority: t.priority ?? 'normal',
      points: t.points ?? 0,
      dueDate: t.due ?? null,
      startDate: t.start ?? null,
      columnId: t.status,
      typeId: (d.types ?? []).find((type) => type.code === t.type || type.id === t.type)?.id ?? null,
      tagIds: t.tags ?? [],
      assigneeIds: (t.assignees ?? []).map((u) => u.id),
      fieldValues: t.customFields ?? {},
      checklist: t.checklist ?? [],
    }))
    return ok({
      ok: true,
      schema: exchangeSchema,
      version: exchangeVersion,
      rows,
      revision,
      cursor: selected.length > limit ? rows.at(-1).id : null,
    })
  }
  if (role === 'viewer' || ['guest', 'readonly'].includes(scenario))
    return fail('forbidden', 'Write access required')
  if (
    args.schema !== exchangeSchema ||
    args.version !== exchangeVersion ||
    !['create', 'update'].includes(args.mode) ||
    !args.importId ||
    !args.idempotencyKey ||
    !Array.isArray(args.rows) ||
    !args.rows.length ||
    args.rows.length > 100 ||
    args.rows.some(
      (row) => !row?.sourceId || Object.keys(row).some((key) => !exchangeFields.includes(key)),
    ) ||
    new Set(args.rows.map((row) => row.sourceId)).size !== args.rows.length
  )
    return fail('validation', 'Invalid exchange batch')
  const preview = name === 'flow.issue.importPreview',
    operationKey = 'exchange:' + d.company.id + ':' + d.user.id + ':' + args.idempotencyKey,
    inputDigest = hash(args),
    previous = replay.get(operationKey),
    previewDigest = hash([project.id, args.importId, args.mode, args.rows, args.mapping ?? {}, revision])
  if (previous)
    return previous.digest === inputDigest
      ? structuredClone(previous.value)
      : fail('replay_mismatch', 'Changed import operation')
  if (!preview && args.previewDigest !== previewDigest)
    return fail('conflict', 'Stale preview', { previewDigest: 'stale_preview' })
  const snapshot = structuredClone(d),
    receipts = new Map(replay),
    results = []
  const rollback = () => {
    for (const key of Object.keys(d)) if (!Object.hasOwn(snapshot, key)) delete d[key]
    Object.assign(d, snapshot)
    replay.clear()
    for (const [key, value] of receipts) replay.set(key, value)
  }
  for (const [index, row] of args.rows.entries()) {
    const draft = Object.fromEntries(
      Object.entries(row).filter(([key]) => !['sourceId', 'id', 'expectedVersion'].includes(key)),
    )
    draft.projectId = project.id
    const mappings = args.mapping ?? {}
    draft.columnId = map(draft.columnId, mappings.columns)
    if (draft.typeId) draft.typeId = map(draft.typeId, mappings.types)
    for (const [field, category] of [
      ['tagIds', 'labels'],
      ['assigneeIds', 'assignees'],
    ])
      if (draft[field]) draft[field] = draft[field].map((id) => map(id, mappings[category]))
    if (draft.fieldValues)
      draft.fieldValues = Object.fromEntries(
        Object.entries(draft.fieldValues).map(([key, value]) => [map(key, mappings.fields), value]),
      )
    if (args.mode === 'update') {
      draft.id = row.id
      draft.expectedVersion = row.expectedVersion
    }
    const key = 'exchange-row:' + hash([d.company.id, d.user.id, project.id, args.importId, row.sourceId]),
      digest = hash(draft),
      existing = replay.get(key)
    if (existing && existing.digest === digest) {
      results.push({ ...existing.result, replayed: true })
      continue
    }
    let response
    if (existing) response = fail('replay_mismatch', 'Changed imported row')
    else if (args.mode === 'update' && !tasks.some((t) => t.id === row.id))
      response = fail('validation', 'Task outside project', { id: 'scope' })
    else {
      const prepared = atlasFlowCommand('flow.issue.save', {
        ...draft,
        idempotencyKey: preview ? 'preview-' + randomUUID() : key,
      })
      response = dispatch(prepared.name, prepared.input)
    }
    if (response.value?.ok === false) {
      if (!preview) {
        rollback()
        return response
      }
      results.push({
        sourceId: row.sourceId,
        ok: false,
        index,
        code: response.value.errors?.[0]?.code,
        fields: response.value.fields ?? {},
      })
    } else {
      const result = { sourceId: row.sourceId, ...response.value, ok: true }
      results.push(result)
      if (!preview) replay.set(key, { digest, result })
    }
  }
  if (preview) {
    rollback()
    return ok({ ok: true, valid: results.every((row) => row.ok), rows: results, previewDigest })
  }
  const response = ok({
    ok: true,
    rows: results,
    imported: results.filter((row) => !row.replayed).length,
    replayed: results.filter((row) => row.replayed).length,
  })
  replay.set(operationKey, { digest: inputDigest, value: structuredClone(response) })
  return response
}
