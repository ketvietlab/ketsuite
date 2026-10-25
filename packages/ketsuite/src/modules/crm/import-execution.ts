import { deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { scheduleActivity } from '../activity/index.ts'
import { addTimeline, audienceHolds, caseAudience, crmActivityType, now, saveCase } from './operations.ts'
import { importNameKey, mapImportRow } from './import-format.ts'
import type { ImportRules } from './import-format.ts'
import {
  companyRows,
  batchData,
  batchMapping,
  batchRules,
  changeBatch,
  importAllowed,
  importId,
  lockImportCompany,
  objectOf,
  rejectImport,
} from './import-policy.ts'
import {
  consumeImportAssignment,
  importPlanContext,
  matchImportContacts,
  planImportRow,
  rememberContact,
} from './import-plan.ts'
import type { PlannedImportRow } from './import-plan.ts'

export async function materializeImportTags(ctx: Ctx, batch: Row) {
  const rules = batchRules(batch),
    mapping = batchMapping(batch)
  const names = new Map<string, string>(),
    labels = new Map<string, string>()
  for (const name of rules.tags) names.set(importNameKey(name), name.trim())
  for (const cells of batchData(batch)) {
    const { value } = mapImportRow(cells, mapping, rules)
    for (const raw of value.recordTags) {
      const name = rules.tagValues[raw] ?? raw
      if (name) names.set(importNameKey(name), name.trim())
    }
    for (const raw of value.customerLabels) {
      const name = rules.customerLabelValues[raw] ?? raw
      if (name) labels.set(importNameKey(name), name.trim())
    }
  }
  if (!(await importAllowed(ctx, 'crm.tag.save'))) return
  for (const [model, wanted] of [
    ['crm.Tag', names],
    ['crm.CustomerLabel', labels],
  ] as const) {
    const existing = await companyRows(ctx, model)
    for (const [key, name] of wanted) {
      if (existing.some((row) => importNameKey(row.name) === key)) continue
      const row = {
        id: importId(ctx.scope.company, model, key),
        name,
        active: true,
        ...(model === 'crm.CustomerLabel' ? { normalizedName: key } : {}),
      }
      await ctx.db.insertIfAbsent(model, row)
      existing.push(row)
    }
  }
}

export async function addImportTags(
  ctx: Ctx,
  caseId: string,
  names: string[],
  batchId: string,
  rowNumber: number,
) {
  const tags = await companyRows(ctx, 'crm.Tag', { active: true }),
    links = await companyRows(ctx, 'crm.CaseTag', { caseId })
  const added: string[] = []
  for (const key of new Set(names.map(importNameKey))) {
    const tag = tags.find((tag) => importNameKey(tag.name) === key)
    if (!tag || links.some((link) => link.tagId === tag.id)) continue
    const link = { id: importId(batchId, rowNumber, caseId, tag.id), caseId, tagId: tag.id, createdAt: now() }
    await ctx.db.insertIfAbsent('crm.CaseTag', link)
    links.push(link)
    added.push(String(link.id))
  }
  return added
}
async function addCustomerLabels(
  ctx: Ctx,
  partnerId: string | null,
  names: string[],
  batchId: string,
  rowNumber: number,
) {
  if (!partnerId) return []
  const labels = await companyRows(ctx, 'crm.CustomerLabel', { active: true }),
    links = await companyRows(ctx, 'crm.CustomerLabelLink', { partnerId })
  const added: string[] = []
  for (const key of new Set(names.map(importNameKey))) {
    const label = labels.find((label) => importNameKey(label.name) === key)
    if (!label || links.some((link) => link.labelId === label.id)) continue
    const link = { id: importId(batchId, rowNumber, partnerId, label.id), partnerId, labelId: label.id }
    await ctx.db.insertIfAbsent('crm.CustomerLabelLink', link)
    links.push(link)
    added.push(String(link.id))
  }
  return added
}

async function firstContact(ctx: Ctx, batch: Row, row: PlannedImportRow, caseId: string, rules: ImportRules) {
  if (!rules.firstTask) return null
  const record = (await companyRows(ctx, 'crm.Case', { id: caseId }))[0]
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  const timezone = String(company?.accountingTimezone || 'Asia/Ho_Chi_Minh')
  const when = new Date(
    Date.parse(String(batch.startedAt)) +
      (rules.due === 'tomorrow' ? 86400_000 : rules.due === 'two-hours' ? 7200_000 : 0),
  )
  const dueDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when)
  const activityId = importId(batch.id, row.rowNumber, 'first-contact')
  const activity = await scheduleActivity(ctx, {
    id: activityId,
    threadId: String(record.threadId),
    typeId: (await crmActivityType(ctx))!,
    assigneeUserId: row.assigneeUserId || String(batch.actorUserId),
    summary: `Liên hệ lần đầu · ${row.normalized.name}`,
    dueDate,
    ...(rules.due === 'two-hours' ? { dueAt: when.toISOString() } : {}),
    createdAt: String(batch.startedAt),
  })
  await ctx.db.insertIfAbsent('crm.ActivityLink', { id: importId(activityId, 'link'), caseId, activityId })
  return activity
}

async function writeImportRow(ctx: Ctx, batch: Row, row: PlannedImportRow) {
  const rules = batchRules(batch),
    timestamp = now()
  const receipt: Row = {
    id: importId(batch.id, row.rowNumber),
    batchId: batch.id,
    rowNumber: row.rowNumber,
    outcome: row.outcome,
    issue: row.issue || null,
    original: row.original,
    normalized: row.normalized,
    caseId: row.caseId,
    partnerId: row.partnerId,
    assigneeUserId: row.assigneeUserId,
    createdCase: false,
    createdPartner: false,
    caseVersion: null,
    addedTags: [],
    addedCustomerLabels: [],
    activityId: null,
    processedAt: timestamp,
  }
  if (['error', 'skipped'].includes(row.outcome)) {
    await ctx.db.insert('crm.ImportRow', receipt)
    return receipt
  }
  if (row.outcome !== 'merged') {
    if (!row.partnerId) {
      const partnerId = importId(batch.id, row.rowNumber, 'partner')
      // No import checkbox may manufacture consent. The shared address book
      // stores the identity only; contact data stays on the CRM record until its
      // own permission/consent workflow authorises outreach.
      await ctx.db.commit(
        ctx
          .change('partner.Partner', {
            id: partnerId,
            kind: 'person',
            name: row.normalized.name,
            contactConsent: false,
            active: true,
          })
          .cast(['id', 'kind', 'name', 'contactConsent', 'active']),
      )
      row.partnerId = partnerId
      receipt.createdPartner = true
    }
    row.caseId = importId(batch.id, row.rowNumber, 'case')
    const stage = (await companyRows(ctx, 'crm.Stage', { active: true }))
      .filter(
        (stage) =>
          stage.terminalState === 'open' && objectOf<string[]>(stage.allowedKinds, []).includes(rules.kind),
      )
      .sort((a, b) => Number(a.sequence) - Number(b.sequence))[0]
    if (!stage) throw new Error('CRM import has no active opening stage')
    const result = await saveCase(
      ctx,
      {
        stageId: String(stage.id),
        id: row.caseId,
        kind: rules.kind,
        name: row.normalized.name,
        partnerId: row.partnerId,
        contactName: row.normalized.contactName,
        phone: row.normalized.phone,
        email: row.normalized.email,
        description: row.normalized.description,
        utmSource: row.normalized.source,
        utmMedium: row.normalized.medium,
        utmCampaign: row.normalized.campaign,
        teamId: row.teamId,
        assigneeUserId: row.assigneeUserId || undefined,
        contactConsent: false,
        idempotencyKey: importId(batch.id, row.rowNumber),
      },
      { inTransaction: true },
    )
    if (!result.ok) throw new Error('CRM import write refused; chunk transaction rolled back')
    receipt.createdCase = true
    receipt.caseVersion = result.version
  } else {
    const held = (await companyRows(ctx, 'crm.Case', { id: row.caseId }))[0]
    const changed = await ctx.db.compareAndSet(
      'crm.Case',
      { id: row.caseId },
      { version: held.version },
      { version: Number(held.version) + 1, updatedAt: timestamp },
    )
    if (!('dryRun' in changed) && !changed.matched)
      throw new Error('CRM import concurrent case edit; retry chunk')
    receipt.caseVersion = Number(held.version) + 1
  }
  receipt.caseId = row.caseId
  receipt.partnerId = row.partnerId
  receipt.addedTags = await addImportTags(
    ctx,
    row.caseId!,
    [...rules.tags, ...row.normalized.recordTags.map((name) => rules.tagValues[name] ?? name)].filter(
      Boolean,
    ),
    String(batch.id),
    row.rowNumber,
  )
  receipt.addedCustomerLabels = await addCustomerLabels(
    ctx,
    row.partnerId,
    row.normalized.customerLabels.map((name) => rules.customerLabelValues[name] ?? name).filter(Boolean),
    String(batch.id),
    row.rowNumber,
  )
  await addTimeline(ctx, {
    id: importId(batch.id, row.rowNumber, 'timeline'),
    caseId: row.caseId!,
    eventType: 'imported',
    body: row.normalized.description || String(batch.name),
    metadata: { batchId: batch.id, rowNumber: row.rowNumber },
    customerVisible: false,
    occurredAt: timestamp,
  })
  const activity = await firstContact(ctx, batch, row, row.caseId!, rules)
  receipt.activityId = activity?.id ?? null
  receipt.activitySnapshot = activity
    ? {
        summary: activity.summary,
        dueDate: activity.dueDate,
        dueAt: activity.dueAt ?? null,
        assigneeUserId: activity.assigneeUserId,
        updatedAt: activity.updatedAt,
      }
    : null
  await ctx.db.insert('crm.ImportRow', receipt)
  return receipt
}

/** A worker transaction commits both its cursor and its rows, or neither. */
export async function runImportChunk(ctx: Ctx, input: { batchId: string; cursor: number }) {
  return ctx.tx((tx) => writeImportChunk(tx, input))
}
async function writeImportChunk(ctx: Ctx, input: { batchId: string; cursor: number }) {
  await lockImportCompany(ctx)
  const batch = (await companyRows(ctx, 'crm.ImportBatch', { id: input.batchId }))[0]
  if (batch?.state !== 'running' || Number(batch.cursor) !== input.cursor) return
  // Role revocation also stops queued work. A background job is not a system-user bypass.
  const actor = { ...ctx, actor: String(batch.actorUserId) }
  if (!(await importAllowed(actor, 'crm.import.start')) || !(await importAllowed(actor, 'crm.case.save'))) {
    await changeBatch(ctx, batch, { state: 'stopped', stoppedReason: 'permission' })
    return
  }
  const rules = batchRules(batch),
    mapping = batchMapping(batch),
    data = batchData(batch)
  if (rules.firstTask && !(await importAllowed(actor, 'crm.activity.schedule'))) {
    await changeBatch(ctx, batch, { state: 'stopped', stoppedReason: 'permission' })
    return
  }
  const context = await importPlanContext(actor)
  const seen = new Set<string>()
  for (const cells of data.slice(0, input.cursor)) {
    const mapped = mapImportRow(cells, mapping, rules)
    if (!mapped.issues.length) rememberContact(seen, mapped.value)
  }
  const slice = data.slice(input.cursor, input.cursor + 25),
    matches = await matchImportContacts(
      actor,
      slice.map((cells) => mapImportRow(cells, mapping, rules).value),
    )
  const counts = { ...objectOf<Record<string, number>>(batch.counts, {}) }
  for (let i = 0; i < slice.length; i++) {
    const row = planImportRow(context, slice[i], mapping, rules, input.cursor + i + 1, matches, seen)
    const receipt = await writeImportRow(actor, batch, row)
    const routing = consumeImportAssignment(context, row, rules, String(receipt.processedAt))
    if (routing) {
      await ctx.db.update(
        'crm.TeamMember',
        { id: routing.member.id },
        { assignedCount: routing.member.assignedCount, lastAssignedAt: routing.member.lastAssignedAt },
      )
      await ctx.db.update(
        'crm.Team',
        { id: routing.team.id },
        { assignmentCursor: routing.team.assignmentCursor, version: routing.team.version },
      )
    }
    counts[String(receipt.outcome)] = (counts[String(receipt.outcome)] || 0) + 1
    if (receipt.createdCase)
      matches.cases.push((await companyRows(ctx, 'crm.Case', { id: receipt.caseId }))[0])
  }
  const cursor = input.cursor + slice.length,
    finished = cursor >= data.length
  await changeBatch(ctx, batch, {
    cursor,
    counts,
    state: finished ? (counts.error ? 'partial' : 'completed') : 'running',
    ...(finished ? { finishedAt: now() } : {}),
  })
  if (!finished)
    await ctx.jobs.enqueue(
      'crm.importChunk',
      { batchId: batch.id, cursor },
      { uniqueKey: `crm.import:${batch.id}:${cursor}` },
    )
}

export async function undoImport(ctx: Ctx, batch: Row) {
  if (batch.state === 'undone') return { ok: true, id: batch.id }
  if (
    !['completed', 'partial', 'stopped'].includes(String(batch.state)) ||
    Date.parse(String(batch.undoUntil)) < Date.now()
  )
    rejectImport('state', 'undoExpired')
  await lockImportCompany(ctx)
  const audience = await caseAudience(ctx, 'edit')
  const receipts = await companyRows(ctx, 'crm.ImportRow', { batchId: batch.id })
  let archived = 0,
    kept = 0,
    removedTags = 0
  for (const receipt of receipts) {
    if (!receipt.caseId || receipt.undoneAt) continue
    const held = (await companyRows(ctx, 'crm.Case', { id: receipt.caseId }))[0]
    if (!held) continue
    if (!audienceHolds(audience, held)) {
      kept++
      await ctx.db.update(
        'crm.ImportRow',
        { id: receipt.id },
        { undoneAt: now(), undoResult: 'kept-permission' },
      )
      continue
    }
    const timeline = await companyRows(ctx, 'crm.TimelineEntry', { caseId: held.id })
    const links = await companyRows(ctx, 'crm.ActivityLink', { caseId: held.id })
    const activities = links.length
      ? await ctx.db.all(
          from(ctx.table('activity.Activity')).where(
            inArray(
              ctx.table('activity.Activity').id,
              links.map((link) => link.activityId),
            ),
          ),
        )
      : []
    const touched =
      Number(held.version) !== Number(receipt.caseVersion) ||
      timeline.some((entry) => !['created', 'imported'].includes(String(entry.eventType))) ||
      activities.some(
        (activity) =>
          activity.id !== receipt.activityId ||
          activity.doneAt ||
          activity.canceledAt ||
          Object.entries(objectOf<Row>(receipt.activitySnapshot, {})).some(
            ([key, value]) => (activity[key] ?? null) !== value,
          ),
      )
    let result = 'tags-removed'
    if (receipt.createdCase && !touched) {
      const changed = await ctx.db.compareAndSet(
        'crm.Case',
        { id: held.id },
        { version: held.version },
        { active: false, version: Number(held.version) + 1, updatedAt: now() },
      )
      if (!('dryRun' in changed) && !changed.matched) throw new Error('CRM import concurrent undo; retry')
      for (const activity of activities)
        await ctx.db.update('activity.Activity', { id: activity.id }, { active: false, canceledAt: now() })
      archived++
      result = 'archived'
    } else if (receipt.createdCase) {
      kept++
      result = 'kept'
    }
    // Link ids identify ownership. Removing/re-adding a tag after import produces
    // another link id, so undo cannot remove the later user's decision.
    if (!receipt.createdCase || !touched) {
      for (const id of objectOf<string[]>(receipt.addedTags, []))
        removedTags += (
          await ctx.db.del(deleteFrom(ctx.table('crm.CaseTag')).where(eq(ctx.table('crm.CaseTag').id, id)))
        ).changes
      for (const id of objectOf<string[]>(receipt.addedCustomerLabels, []))
        await ctx.db.del(
          deleteFrom(ctx.table('crm.CustomerLabelLink')).where(eq(ctx.table('crm.CustomerLabelLink').id, id)),
        )
    }
    await ctx.db.update('crm.ImportRow', { id: receipt.id }, { undoneAt: now(), undoResult: result })
  }
  // Customers are shared with other business modules. Keep their identity and
  // the import audit rather than guessing that an unedited CRM case proves a
  // customer has no orders or invoices. The confirmation explains this precisely.
  await changeBatch(ctx, batch, { state: 'undone', stoppedReason: null })
  return { ok: true, id: batch.id, archived, kept, removedTags }
}
