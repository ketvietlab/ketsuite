import { asc, desc, defineFn, eq, from, ilike } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { caseAudience, ensureCrmDefaults, now } from '../operations.ts'
import {
  defaultImportRules,
  exportImportCsv,
  ImportFormatError,
  parseImportFile,
  tagNames,
} from '../import-format.ts'
import {
  companyRows,
  batchData,
  batchMapping,
  changeBatch,
  importAllowed,
  importFailure,
  importId,
  importReadEffects,
  importTransaction,
  importWriteEffects,
  lockImportCompany,
  objectOf,
  ownedImport,
  validateImportPlan,
} from '../import-policy.ts'
import { previewImport } from '../import-plan.ts'
import { materializeImportTags, undoImport } from '../import-execution.ts'
import { importPerformance } from '../import-report.ts'

const result = { ok: 'bool', id: 'id?', errors: 'json?' } as const
const paging = (a: Row) => ({
  offset: Math.max(0, Math.trunc(Number(a.offset) || 0)),
  limit: Math.min(100, Math.max(1, Math.trunc(Number(a.limit) || 50))),
})
const publicBatch = (batch: Row, actor?: string | null) => {
  const { data, source, ...safe } = batch
  const matrix = batchData(batch),
    mapping = batchMapping(batch)
  const values = (field: string) =>
    [...new Set(matrix.flatMap((row) => tagNames(row[mapping.indexOf(field as never)])))].slice(0, 200)
  return {
    ...safe,
    canManage: actor === batch.actorUserId,
    preview: matrix.slice(0, 5),
    tagValues: values('recordTags'),
    customerLabelValues: values('customerLabels'),
  }
}

export async function uploadImport(ctx: Ctx, a: Row) {
  if (!ctx.actor || !ctx.scope.company) return importFailure('permission', 'permission')
  let parsed: Awaited<ReturnType<typeof parseImportFile>>
  try {
    parsed = await parseImportFile({
      filename: String(a.filename),
      content: String(a.content),
      sheet: a.sheet ? String(a.sheet) : undefined,
      header: a.header !== false,
      delimiter: a.delimiter ? String(a.delimiter) : undefined,
    })
  } catch (error) {
    if (error instanceof ImportFormatError) return importFailure('file', error.code)
    throw error
  }
  const id = importId(ctx.scope.company, ctx.actor, a.id)
  return importTransaction(ctx, async (tx) => {
    const existing = await ownedImport(tx, id)
    if (existing) return existing.source === a.content ? { ok: true, id } : importFailure('id', 'conflict')
    const timestamp = now()
    await ensureCrmDefaults(tx)
    await tx.db.insert('crm.ImportBatch', {
      id,
      actorUserId: ctx.actor,
      name: String(a.name || a.filename)
        .trim()
        .slice(0, 240),
      filename: String(a.filename).slice(0, 240),
      state: 'draft',
      version: 1,
      headers: parsed.headers,
      data: parsed.rows,
      source: a.content,
      mapping: parsed.mapping,
      rules: defaultImportRules(),
      sheets: parsed.sheets,
      header: a.header !== false,
      sheet: parsed.sheet,
      total: parsed.rows.length,
      cursor: 0,
      counts: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    return { ok: true, id }
  })
}

export async function configureImport(ctx: Ctx, a: Row) {
  return importTransaction(ctx, async (tx) => {
    const batch = await ownedImport(tx, String(a.id))
    if (!batch) return importFailure('id', 'notFound')
    if (!['draft', 'ready'].includes(String(batch.state)) || batch.version !== a.version)
      return importFailure('version', 'conflict')
    if (a.sheet && a.sheet !== batch.sheet) {
      let parsed: Awaited<ReturnType<typeof parseImportFile>>
      try {
        parsed = await parseImportFile({
          filename: String(batch.filename),
          content: String(batch.source),
          sheet: String(a.sheet),
          header: batch.header !== false,
        })
      } catch {
        return importFailure('sheet', 'sheet')
      }
      await changeBatch(tx, batch, {
        headers: parsed.headers,
        data: parsed.rows,
        mapping: parsed.mapping,
        total: parsed.rows.length,
        sheet: parsed.sheet,
        state: 'draft',
      })
      return { ok: true, id: batch.id }
    }
    // The mapping step saves independently; rules are validated at the review boundary.
    const mapping = a.mapping ?? batch.mapping,
      rules = a.rules ?? batch.rules
    if (a.review === true) {
      const plan = await validateImportPlan(tx, batch, mapping, rules)
      await changeBatch(tx, batch, { ...plan, state: 'ready' })
    } else {
      const candidate = objectOf<unknown[]>(mapping, [])
      if (!Array.isArray(candidate) || candidate.length !== objectOf<string[]>(batch.headers, []).length)
        return importFailure('mapping', 'mapping')
      await changeBatch(tx, batch, { mapping: candidate, rules, state: 'draft' })
    }
    return { ok: true, id: batch.id }
  })
}

export async function startImport(ctx: Ctx, a: Row) {
  return importTransaction(ctx, async (tx) => {
    await lockImportCompany(tx)
    const batch = await ownedImport(tx, String(a.id))
    if (!batch) return importFailure('id', 'notFound')
    if (['running', 'completed', 'partial'].includes(String(batch.state))) return { ok: true, id: batch.id }
    if (batch.state !== 'ready' || batch.version !== a.version) return importFailure('version', 'conflict')
    const plan = await validateImportPlan(tx, batch, batch.mapping, batch.rules)
    await materializeImportTags(tx, { ...batch, ...plan })
    const timestamp = now()
    await changeBatch(tx, batch, {
      ...plan,
      state: 'running',
      source: null,
      startedAt: timestamp,
      undoUntil: new Date(Date.now() + 72 * 3600_000).toISOString(),
    })
    await tx.jobs.enqueue(
      'crm.importChunk',
      { batchId: batch.id, cursor: 0 },
      { uniqueKey: `crm.import:${batch.id}:0` },
    )
    return { ok: true, id: batch.id }
  })
}

const importPerformanceHandler: NonNullable<FnSpec['handler']> = async (ctx, a) => {
  const batch = await ownedImport(ctx, String(a.id), true)
  return batch
    ? importPerformance(ctx, String(batch.id))
    : { total: 0, contacted: 0, won: 0, wonValue: 0, byOwner: [], byTag: [] }
}

const importListHandler: NonNullable<FnSpec['handler']> = async (ctx, a) => {
  if (!ctx.actor) return { rows: [], total: 0, offset: 0 }
  const B = ctx.table('crm.ImportBatch'),
    { offset, limit } = paging(a)
  let query = from(B).where(eq(B.companyId, ctx.scope.company))
  if ((await caseAudience(ctx)) !== null) query = query.where(eq(B.actorUserId, ctx.actor))
  if (a.state) query = query.where(eq(B.state, a.state))
  if (a.search) query = query.where(ilike(B.name, `%${String(a.search).slice(0, 100)}%`))
  const total = await ctx.db.count(query)
  const appliedOffset = Math.min(offset, Math.max(0, Math.ceil(total / limit) - 1) * limit)
  const rows = await ctx.db.all(
    query
      .select(
        ...[
          'id',
          'name',
          'filename',
          'actorUserId',
          'state',
          'version',
          'total',
          'cursor',
          'counts',
          'createdAt',
          'updatedAt',
          'startedAt',
          'finishedAt',
          'undoUntil',
          'stoppedReason',
        ].map((key) => B[key]),
      )
      .orderBy(desc(B.createdAt), desc(B.id))
      .limit(limit)
      .offset(appliedOffset),
  )
  return { rows: rows.map((row) => publicBatch(row, ctx.actor)), total, offset: appliedOffset }
}

const importGetHandler: NonNullable<FnSpec['handler']> = async (ctx, a) => {
  const batch = await ownedImport(ctx, String(a.id), true)
  return { batch: batch ? publicBatch(batch, ctx.actor) : null }
}

const importOptionsHandler: NonNullable<FnSpec['handler']> = async (ctx) => {
  const audience = await caseAudience(ctx, 'assign')
  const teams = (await companyRows(ctx, 'crm.Team', { active: true })).filter(
    (team) =>
      !audience || audience.teams.includes(String(team.id)) || audience.queueTeams.includes(String(team.id)),
  )
  const members = await companyRows(ctx, 'crm.TeamMember', { active: true })
  const people = (await ctx.db.select('user.User', { active: true }))
    .filter(
      (user) =>
        (!audience ||
          user.id === audience.actor ||
          members.some(
            (member) => member.userId === user.id && audience.teams.includes(String(member.teamId)),
          )) &&
        members.some(
          (member) => member.userId === user.id && teams.some((team) => team.id === member.teamId),
        ),
    )
    .map((user) => ({ id: user.id, name: user.name }))
  return {
    teams: teams.map((team) => ({ id: team.id, name: team.name })),
    people,
    tags: await companyRows(ctx, 'crm.Tag', { active: true }),
    customerLabels: await companyRows(ctx, 'crm.CustomerLabel', { active: true }),
    permissions: {
      createTags: await importAllowed(ctx, 'crm.tag.save'),
      import: await importAllowed(ctx, 'crm.import.start'),
      undo: await importAllowed(ctx, 'crm.import.undo'),
    },
  }
}

const importPreviewHandler: NonNullable<FnSpec['handler']> = async (ctx, a) => {
  const batch = await ownedImport(ctx, String(a.id))
  if (!batch) return importFailure('id', 'notFound')
  if (!['draft', 'ready'].includes(String(batch.state))) return importFailure('state', 'conflict')
  return { ok: true, preview: await previewImport(ctx, batch, paging(a).offset, String(a.outcome || '')) }
}

const importRowsHandler: NonNullable<FnSpec['handler']> = async (ctx, a) => {
  const batch = await ownedImport(ctx, String(a.id), true),
    { offset, limit } = paging(a)
  if (!batch) return { rows: [], total: 0, offset }
  const R = ctx.table('crm.ImportRow')
  let query = from(R).where(eq(R.batchId, batch.id), eq(R.companyId, ctx.scope.company))
  for (const key of ['outcome', 'assigneeUserId', 'issue'])
    if (a[key]) query = query.where(eq(R[key], a[key]))
  const total = await ctx.db.count(query)
  return {
    rows: await ctx.db.all(query.orderBy(asc(R.rowNumber)).limit(limit).offset(offset)),
    total,
    offset,
  }
}

const importStopHandler: NonNullable<FnSpec['handler']> = (ctx, a) =>
  importTransaction(ctx, async (tx) => {
    await lockImportCompany(tx)
    const batch = await ownedImport(tx, String(a.id))
    if (!batch) return importFailure('id', 'notFound')
    if (batch.state === 'stopped') return { ok: true, id: batch.id }
    if (batch.state !== 'running') return importFailure('state', 'conflict')
    await changeBatch(tx, batch, { state: 'stopped', stoppedReason: 'operator' })
    return { ok: true, id: batch.id }
  })

const importResumeHandler: NonNullable<FnSpec['handler']> = (ctx, a) =>
  importTransaction(ctx, async (tx) => {
    await lockImportCompany(tx)
    const batch = await ownedImport(tx, String(a.id))
    if (!batch) return importFailure('id', 'notFound')
    if (!['stopped', 'running'].includes(String(batch.state)) || Number(batch.cursor) >= Number(batch.total))
      return importFailure('state', 'conflict')
    if (batch.state === 'running' && Date.now() - Date.parse(String(batch.updatedAt)) < 60_000)
      return { ok: true, id: batch.id }
    await validateImportPlan(tx, batch, batch.mapping, batch.rules)
    await changeBatch(tx, batch, { state: 'running', stoppedReason: null })
    await tx.jobs.enqueue(
      'crm.importChunk',
      { batchId: batch.id, cursor: batch.cursor },
      { uniqueKey: `crm.import:${batch.id}:${batch.cursor}:resume:${batch.version}` },
    )
    return { ok: true, id: batch.id }
  })

const importUndoHandler: NonNullable<FnSpec['handler']> = (ctx, a) =>
  importTransaction(ctx, async (tx) => {
    const batch = await ownedImport(tx, String(a.id))
    if (!batch) return importFailure('id', 'notFound')
    if (batch.state !== 'undone' && batch.version !== a.version) return importFailure('version', 'conflict')
    return undoImport(tx, batch)
  })

const importExportHandler: NonNullable<FnSpec['handler']> = async (ctx, a) => {
  const batch = await ownedImport(ctx, String(a.id), true)
  if (!batch) return importFailure('id', 'notFound')
  const rows = ['draft', 'ready'].includes(String(batch.state))
    ? (await previewImport(ctx, batch, 0, a.errorsOnly ? 'error' : '', 20_000)).rows
    : await companyRows(ctx, 'crm.ImportRow', { batchId: batch.id })
  return {
    ok: true,
    content: exportImportCsv([
      ['Row', ...objectOf<string[]>(batch.headers, []), 'Outcome', 'Issue'],
      ...rows
        .filter((row) => !a.errorsOnly || row.outcome === 'error')
        .sort((a, b) => Number(a.rowNumber) - Number(b.rowNumber))
        .map((row) => [row.rowNumber, ...objectOf<string[]>(row.original, []), row.outcome, row.issue]),
    ]),
  }
}

export const importFunctions: Record<string, FnSpec> = {
  'import.performance': defineFn({
    input: { id: 'id' },
    output: {
      total: 'int',
      contacted: 'int',
      won: 'int',
      wonValue: 'decimal',
      byOwner: 'json',
      byTag: 'json',
    },
    effects: importReadEffects,
    handler: importPerformanceHandler,
  }),
  'import.upload': defineFn({
    input: {
      id: 'id',
      filename: 'text',
      content: 'text',
      name: 'text?',
      sheet: 'text?',
      delimiter: 'text?',
      header: 'bool?',
    },
    output: result,
    effects: importWriteEffects,
    idempotent: true,
    handler: uploadImport,
  }),
  'import.configure': defineFn({
    input: { id: 'id', version: 'int', mapping: 'json?', rules: 'json?', sheet: 'text?', review: 'bool?' },
    output: result,
    effects: importWriteEffects,
    idempotent: true,
    handler: configureImport,
  }),
  'import.start': defineFn({
    input: { id: 'id', version: 'int' },
    output: result,
    effects: importWriteEffects,
    idempotent: true,
    handler: startImport,
  }),
  'import.list': defineFn({
    input: { offset: 'int?', limit: 'int?', state: 'text?', search: 'text?' },
    output: { rows: 'json', total: 'int', offset: 'int' },
    effects: importReadEffects,
    handler: importListHandler,
  }),
  'import.get': defineFn({
    input: { id: 'id' },
    output: { batch: 'json?' },
    effects: importReadEffects,
    handler: importGetHandler,
  }),
  'import.options': defineFn({
    input: {},
    output: { teams: 'json', people: 'json', tags: 'json', customerLabels: 'json', permissions: 'json' },
    effects: importReadEffects,
    handler: importOptionsHandler,
  }),
  'import.preview': defineFn({
    input: { id: 'id', offset: 'int?', outcome: 'text?' },
    output: { ok: 'bool', preview: 'json?', errors: 'json?' },
    effects: importReadEffects,
    handler: importPreviewHandler,
  }),
  'import.rows': defineFn({
    input: {
      id: 'id',
      offset: 'int?',
      limit: 'int?',
      outcome: 'text?',
      assigneeUserId: 'id?',
      issue: 'text?',
    },
    output: { rows: 'json', total: 'int', offset: 'int' },
    effects: importReadEffects,
    handler: importRowsHandler,
  }),
  'import.stop': defineFn({
    input: { id: 'id', version: 'int' },
    output: result,
    effects: importWriteEffects,
    idempotent: true,
    handler: importStopHandler,
  }),
  'import.resume': defineFn({
    input: { id: 'id', version: 'int' },
    output: result,
    effects: importWriteEffects,
    idempotent: true,
    handler: importResumeHandler,
  }),
  'import.undo': defineFn({
    input: { id: 'id', version: 'int' },
    output: { ...result, archived: 'int?', kept: 'int?', removedTags: 'int?' },
    effects: importWriteEffects,
    idempotent: true,
    handler: importUndoHandler,
  }),
  'import.export': defineFn({
    input: { id: 'id', errorsOnly: 'bool?' },
    output: { ok: 'bool', content: 'text?', errors: 'json?' },
    effects: importReadEffects,
    handler: importExportHandler,
  }),
}
