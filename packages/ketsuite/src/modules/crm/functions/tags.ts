import { defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addTimeline, audienceHolds, caseAudience, caseQuery, now, serializeCaseList } from '../operations.ts'
import { importNameKey } from '../import-format.ts'
import { addImportTags } from '../import-execution.ts'
import {
  companyRows,
  batchRules,
  changeBatch,
  importFailure,
  importId,
  importReadEffects,
  importTransaction,
  importWriteEffects,
  lockImportCompany,
  objectOf,
  ownedImport,
  rejectImport,
} from '../import-policy.ts'

async function catalogue(ctx: Ctx) {
  const { query } = await caseQuery(ctx, {})
  const C = ctx.table('crm.Case'),
    B = ctx.table('crm.ImportBatch')
  const cases = await ctx.db.all(
    query.where(eq(C.companyId, ctx.scope.company)).select(C.id, C.terminalState, C.createdAt),
  )
  const tags = await companyRows(ctx, 'crm.Tag', { companyId: ctx.scope.company })
  const links = await companyRows(ctx, 'crm.CaseTag', { companyId: ctx.scope.company })
  const batches = await ctx.db.all(from(B).select(B.id, B.rules).where(eq(B.companyId, ctx.scope.company)))
  const casesById = new Map(cases.map((row) => [row.id, row]))
  const casesByTag = new Map<unknown, Row[]>()
  const usedByTag = new Map<unknown, string>()
  for (const link of links) {
    const row = casesById.get(link.caseId)
    if (row) {
      casesByTag.set(link.tagId, [...(casesByTag.get(link.tagId) || []), row])
      const used = String(link.createdAt || row.createdAt)
      if (used > (usedByTag.get(link.tagId) || '')) usedByTag.set(link.tagId, used)
    }
  }
  return tags.map((tag) => {
    const records = casesByTag.get(tag.id) || []
    const won = records.filter((row) => row.terminalState === 'won').length
    const closed = records.filter((row) => row.terminalState !== 'open').length
    const lastUsedAt = usedByTag.get(tag.id) || null
    return {
      ...tag,
      id: String(tag.id),
      name: String(tag.name),
      active: tag.active === true,
      records: records.length,
      open: records.filter((row) => row.terminalState === 'open').length,
      won,
      winRate: closed ? won / closed : 0,
      batches: batches.filter((batch) =>
        batchRules(batch).tags.some((name) => importNameKey(name) === importNameKey(tag.name)),
      ).length,
      lastUsedAt,
      similar: tags
        .filter(
          (other) =>
            other.id !== tag.id && other.active && importNameKey(other.name) === importNameKey(tag.name),
        )
        .map((other) => other.id),
    }
  })
}

async function editTags(ctx: Ctx, a: Row) {
  const ids = objectOf<unknown[]>(a.ids, []),
    tagIds = objectOf<unknown[]>(a.tagIds, [])
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    !ids.length ||
    ids.some((id) => typeof id !== 'string') ||
    !Array.isArray(tagIds) ||
    !tagIds.length ||
    tagIds.length > 10 ||
    tagIds.some((id) => typeof id !== 'string') ||
    !['add', 'remove'].includes(String(a.operation))
  )
    return importFailure('selection', 'selection')
  return importTransaction(ctx, async (tx) => {
    const audience = await caseAudience(tx, 'edit')
    const tags = await companyRows(tx, 'crm.Tag', { companyId: tx.scope.company })
    if (tagIds.some((id) => !tags.some((tag) => tag.id === id && (a.operation === 'remove' || tag.active))))
      return importFailure('tagIds', 'tags')
    const errors: Row[] = [],
      changed: string[] = []
    for (const id of new Set(ids as string[])) {
      const row = (await companyRows(tx, 'crm.Case', { id, companyId: tx.scope.company }))[0]
      if (!row || !['lead', 'opportunity'].includes(String(row.kind)) || !audienceHolds(audience, row)) {
        errors.push({ id, code: 'crm.import.permission' })
        continue
      }
      const existing = await companyRows(tx, 'crm.CaseTag', { caseId: id })
      const changes = tagIds.filter((tagId) =>
        a.operation === 'remove'
          ? existing.some((link) => link.tagId === tagId)
          : !existing.some((link) => link.tagId === tagId),
      )
      if (!changes.length) continue
      if (a.operation === 'add' && existing.length + changes.length > 10) {
        errors.push({ id, code: 'crm.import.tags' })
        continue
      }
      const result = await tx.db.compareAndSet(
        'crm.Case',
        { id },
        { version: row.version },
        { version: Number(row.version) + 1, updatedAt: now() },
      )
      if (!('dryRun' in result) && !result.matched) rejectImport('version', 'conflict')
      for (const tagId of changes) {
        const table = tx.table('crm.CaseTag')
        if (a.operation === 'remove')
          await tx.db.del(deleteFrom(table).where(eq(table.caseId, id), eq(table.tagId, tagId)))
        else if (
          !(await companyRows(tx, 'crm.CaseTag', { caseId: id, tagId, companyId: tx.scope.company }))[0]
        )
          await tx.db.insert('crm.CaseTag', {
            id: importId('manual-tag', id, tagId),
            caseId: id,
            tagId,
            createdAt: now(),
          })
      }
      await addTimeline(tx, {
        id: importId(id, row.version, a.operation, tagIds),
        caseId: id,
        eventType: 'tags_changed',
        body: a.operation === 'add' ? 'crm.timeline.tagsAdded' : 'crm.timeline.tagsRemoved',
        metadata: { tagIds },
      })
      changed.push(id)
    }
    return { ok: true, changed, errors }
  })
}

const tagCatalogueHandler: NonNullable<FnSpec['handler']> = async (ctx, a) => {
  let rows = await catalogue(ctx)
  const selected = a.id ? (rows.find((row) => row.id === a.id) ?? null) : null
  if (a.search) rows = rows.filter((tag) => importNameKey(tag.name).includes(importNameKey(a.search)))
  if (a.filter === 'similar') rows = rows.filter((tag) => tag.similar.length > 0)
  if (a.filter === 'unused')
    rows = rows.filter((tag) => !tag.lastUsedAt || Date.parse(tag.lastUsedAt) < Date.now() - 90 * 86400_000)
  if (a.filter !== 'archived') rows = rows.filter((tag) => tag.active)
  else rows = rows.filter((tag) => !tag.active)
  const total = rows.length,
    offset = Math.min(Math.max(0, Number(a.offset) || 0), Math.max(0, Math.ceil(total / 50) - 1) * 50)
  return {
    rows: rows.sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(offset, offset + 50),
    total,
    selected,
    offset,
  }
}

const tagMergeHandler: NonNullable<FnSpec['handler']> = (ctx, a) =>
  importTransaction(ctx, async (tx) => {
    if ((await caseAudience(tx, 'edit')) !== null) return importFailure('permission', 'permission')
    if (a.sourceId === a.targetId) return importFailure('targetId', 'tags')
    await lockImportCompany(tx)
    const source = (await companyRows(tx, 'crm.Tag', { id: a.sourceId, companyId: tx.scope.company }))[0]
    const target = (
      await companyRows(tx, 'crm.Tag', { id: a.targetId, companyId: tx.scope.company, active: true })
    )[0]
    if (!source || !target) return importFailure('targetId', 'notFound')
    if (!source.active) return { ok: true }
    const links = await companyRows(tx, 'crm.CaseTag', { tagId: source.id, companyId: tx.scope.company })
    for (const link of links) {
      if (
        (
          await companyRows(tx, 'crm.CaseTag', {
            caseId: link.caseId,
            tagId: target.id,
            companyId: tx.scope.company,
          })
        )[0]
      )
        await tx.db.del(deleteFrom(tx.table('crm.CaseTag')).where(eq(tx.table('crm.CaseTag').id, link.id)))
      else await tx.db.update('crm.CaseTag', { id: link.id }, { tagId: target.id })
    }
    for (const batch of await companyRows(tx, 'crm.ImportBatch', { companyId: tx.scope.company })) {
      const rules = batchRules(batch),
        replace = (name: string) =>
          importNameKey(name) === importNameKey(source.name) ? String(target.name) : name
      const updated = {
        ...rules,
        tags: [...new Set(rules.tags.map(replace))],
        tagValues: Object.fromEntries(
          Object.entries(rules.tagValues).map(([key, name]) => [key, replace(name)]),
        ),
      }
      if (JSON.stringify(updated) !== JSON.stringify(rules)) await changeBatch(tx, batch, { rules: updated })
    }
    await tx.db.update('crm.Tag', { id: source.id }, { active: false })
    return { ok: true }
  })

const caseTaggedHandler: NonNullable<FnSpec['handler']> = async (ctx, a) => {
  let { query } = await caseQuery(ctx, a)
  const C = ctx.table('crm.Case'),
    tags = await companyRows(ctx, 'crm.Tag', { companyId: ctx.scope.company }),
    links = await companyRows(ctx, 'crm.CaseTag', { companyId: ctx.scope.company })
  if (a.batchId) {
    if (!(await ownedImport(ctx, String(a.batchId), true)))
      return { rows: [], total: 0, nextCursor: null, tags: [] }
    const rows = await companyRows(ctx, 'crm.ImportRow', { batchId: a.batchId, companyId: ctx.scope.company })
    query = query.where(inArray(C.id, rows.map((row) => row.caseId).filter(Boolean)))
  }
  query = query.where(eq(C.companyId, ctx.scope.company))
  const candidates = await ctx.db.all(query.select(C.id))
  const linksByCase = new Map<unknown, Set<unknown>>()
  for (const link of links) {
    if (!linksByCase.has(link.caseId)) linksByCase.set(link.caseId, new Set())
    linksByCase.get(link.caseId)!.add(link.tagId)
  }
  const facets = tags
    .filter((tag) => tag.active)
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      count: candidates.filter((row) => linksByCase.get(row.id)?.has(tag.id)).length,
    }))
  const filtered = candidates.filter(
    (row) => (!a.tagId || linksByCase.get(row.id)?.has(a.tagId)) && (!a.untagged || !linksByCase.has(row.id)),
  )
  const offset = Math.max(0, Number(a.cursor) || 0),
    limit = Math.min(100, Math.max(1, Number(a.limit) || 50)),
    total = filtered.length
  const appliedOffset = Math.min(offset, Math.max(0, Math.ceil(total / limit) - 1) * limit)
  return {
    offset: appliedOffset,
    rows: await serializeCaseList(
      ctx,
      await ctx.db.all(
        query.where(
          inArray(
            C.id,
            filtered.slice(appliedOffset, appliedOffset + limit).map((row) => row.id),
          ),
        ),
      ),
    ),
    total,
    nextCursor: appliedOffset + limit < total ? String(appliedOffset + limit) : null,
    tags: facets,
  }
}

const importTagHandler: NonNullable<FnSpec['handler']> = (ctx, a) =>
  importTransaction(ctx, async (tx) => {
    const batch = await ownedImport(tx, String(a.id))
    if (!batch || !['completed', 'partial', 'stopped'].includes(String(batch.state)))
      return importFailure('id', 'notFound')
    await lockImportCompany(tx)
    const names = objectOf<string[]>(a.names, [])
    if (
      !Array.isArray(names) ||
      !names.length ||
      names.length > 10 ||
      names.some((name) => typeof name !== 'string')
    )
      return importFailure('tags', 'tags')
    const tags = await companyRows(tx, 'crm.Tag', { active: true, companyId: tx.scope.company })
    if (names.some((name) => !tags.some((tag) => importNameKey(tag.name) === importNameKey(name))))
      return importFailure('tags', 'tags')
    const rules = batchRules(batch)
    if (new Set([...rules.tags, ...names].map(importNameKey)).size > 10) return importFailure('tags', 'tags')
    const audience = await caseAudience(tx, 'edit')
    let changed = 0
    for (const row of await companyRows(tx, 'crm.ImportRow', {
      batchId: batch.id,
      companyId: tx.scope.company,
    })) {
      if (!row.caseId || row.undoneAt) continue
      const record = (await companyRows(tx, 'crm.Case', { id: row.caseId, companyId: tx.scope.company }))[0]
      if (!record || !audienceHolds(audience, record)) rejectImport('permission', 'permission')
      const currentTags = await companyRows(tx, 'crm.CaseTag', { caseId: row.caseId })
      const requestedIds = names.map(
        (name) => tags.find((tag) => importNameKey(tag.name) === importNameKey(name))!.id,
      )
      if (new Set([...currentTags.map((link) => link.tagId), ...requestedIds]).size > 10)
        rejectImport('tags', 'tags')
      const added = await addImportTags(
        tx,
        String(row.caseId),
        names,
        String(batch.id),
        Number(row.rowNumber),
      )
      if (added.length) {
        await tx.db.update(
          'crm.ImportRow',
          { id: row.id },
          { addedTags: [...objectOf<string[]>(row.addedTags, []), ...added] },
        )
        changed++
      }
    }
    await changeBatch(tx, batch, { rules: { ...rules, tags: [...new Set([...rules.tags, ...names])] } })
    return { ok: true, changed }
  })

export const tagFunctions: Record<string, FnSpec> = {
  'tag.catalogue': defineFn({
    input: { id: 'id?', search: 'text?', filter: 'text?', offset: 'int?' },
    output: { rows: 'json', total: 'int', offset: 'int', selected: 'json?' },
    effects: importReadEffects,
    handler: tagCatalogueHandler,
  }),
  'tag.merge': defineFn({
    input: { sourceId: 'id', targetId: 'id' },
    output: { ok: 'bool', errors: 'json?' },
    effects: importWriteEffects,
    idempotent: true,
    handler: tagMergeHandler,
  }),
  'case.tags': defineFn({
    input: { ids: 'json', tagIds: 'json', operation: 'text' },
    output: { ok: 'bool', changed: 'json?', errors: 'json?' },
    effects: importWriteEffects,
    idempotent: true,
    handler: editTags,
  }),
  'case.tagged': defineFn({
    input: {
      tagId: 'id?',
      batchId: 'id?',
      untagged: 'bool?',
      search: 'text?',
      kind: 'text?',
      cursor: 'text?',
      limit: 'int?',
    },
    output: { rows: 'json', total: 'int', offset: 'int', nextCursor: 'text?', tags: 'json' },
    effects: importReadEffects,
    handler: caseTaggedHandler,
  }),
  'import.tag': defineFn({
    input: { id: 'id', names: 'json' },
    output: { ok: 'bool', changed: 'int?', errors: 'json?' },
    effects: importWriteEffects,
    idempotent: true,
    handler: importTagHandler,
  }),
}
