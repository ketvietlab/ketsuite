import { selectAssignmentMember } from './assignment-policy.ts'
import { eq, from, inArray, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { audienceHolds, caseAudience, dialled } from './operations.ts'
import type { CaseAudience } from './operations.ts'
import { importNameKey, mapImportRow } from './import-format.ts'
import type { ImportContact, ImportMapping, ImportRules } from './import-format.ts'
import { companyRows, batchData, batchMapping, batchRules, importAllowed, objectOf } from './import-policy.ts'

export type PlannedImportRow = {
  rowNumber: number
  original: string[]
  normalized: ImportContact
  outcome: string
  issue: string
  caseId: string | null
  partnerId: string | null
  teamId: string
  assigneeUserId: string | null
}
export type ImportMatches = { cases: Row[]; partners: Row[] }

export type ImportPlanContext = {
  assignAudience: CaseAudience | null
  editAudience: CaseAudience | null
  members: Row[]
  teams: Row[]
  users: Row[]
  rules: Row[]
}
export async function importPlanContext(ctx: Ctx): Promise<ImportPlanContext> {
  const [assignAudience, editAudience, members, users, rules, teams] = await Promise.all([
    caseAudience(ctx, 'assign'),
    caseAudience(ctx, 'edit'),
    companyRows(ctx, 'crm.TeamMember', { active: true }),
    ctx.db.select('user.User', { active: true }),
    companyRows(ctx, 'crm.AssignmentRule', { active: true }),
    companyRows(ctx, 'crm.Team', { active: true }),
  ])
  return {
    assignAudience,
    editAudience,
    teams,
    members: members.sort(
      (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
    ),
    users,
    rules: rules.sort((a, b) => Number(a.priority) - Number(b.priority)),
  }
}

/** Read only contacts in this chunk; the query remains company-scoped for CRM. */
export async function matchImportContacts(ctx: Ctx, contacts: ImportContact[]): Promise<ImportMatches> {
  const phones = [...new Set(contacts.map((row) => row.phone).filter(Boolean))]
  const emails = [...new Set(contacts.map((row) => row.email).filter(Boolean))]
  const C = ctx.table('crm.Case'),
    P = ctx.table('partner.Partner')
  if (!phones.length && !emails.length) return { cases: [], partners: [] }
  const caseConditions = [
    phones.length ? inArray(C.phoneDigits, phones.map(dialled)) : null,
    emails.length ? inArray(C.email, emails) : null,
  ].filter((v) => v !== null)
  const partnerConditions = [
    phones.length ? inArray(P.phone, phones) : null,
    emails.length ? inArray(P.email, emails) : null,
  ].filter((v) => v !== null)
  return {
    cases: await ctx.db.all(
      from(C).where(eq(C.active, true), eq(C.companyId, ctx.scope.company), or(...caseConditions)),
    ),
    partners: await ctx.db.all(from(P).where(eq(P.active, true), or(...partnerConditions))),
  }
}
export const contactMatches = (row: Row, contact: ImportContact) =>
  Boolean(
    (contact.phone && dialled(row.phone) === dialled(contact.phone)) ||
      (contact.email &&
        String(row.email ?? '')
          .trim()
          .toLowerCase() === contact.email),
  )
export const rememberContact = (seen: Set<string>, row: ImportContact) => {
  if (row.phone) seen.add(`phone:${dialled(row.phone)}`)
  if (row.email) seen.add(`email:${row.email}`)
}
export const alreadySeen = (seen: Set<string>, row: ImportContact) =>
  Boolean(
    (row.phone && seen.has(`phone:${dialled(row.phone)}`)) || (row.email && seen.has(`email:${row.email}`)),
  )

export function importAssignment(context: ImportPlanContext, rules: ImportRules, row: ImportContact) {
  let teamId = rules.teamId,
    assigneeUserId: string | null = null
  if (rules.assignment === 'person') assigneeUserId = rules.assigneeUserId
  if (rules.assignment === 'rules') {
    const rule = context.rules.find(
      (rule) =>
        objectOf<string[]>(rule.allowedKinds, []).includes(rules.kind) &&
        (!rule.utmSource || importNameKey(rule.utmSource) === importNameKey(row.source)) &&
        Number(rule.minimumScore ?? 0) <= 0,
    )
    teamId = String(rule?.teamId || teamId)
    assigneeUserId = rule?.assigneeUserId ? String(rule.assigneeUserId) : null
  }
  if ((rules.assignment === 'team' || rules.assignment === 'rules') && !assigneeUserId) {
    const active = context.members.filter(
      (member) => member.teamId === teamId && context.users.some((user) => user.id === member.userId),
    )
    const member = selectAssignmentMember(context.teams.find((team) => team.id === teamId) || {}, active)
    if (member) assigneeUserId = String(member.userId)
  }
  return { teamId, assigneeUserId }
}

export function planImportRow(
  context: ImportPlanContext,
  original: string[],
  mapping: ImportMapping,
  rules: ImportRules,
  rowNumber: number,
  matches: ImportMatches,
  seen: Set<string>,
): PlannedImportRow {
  const { value, issues } = mapImportRow(original, mapping, rules)
  const plan: PlannedImportRow = {
    rowNumber,
    original,
    normalized: value,
    outcome: 'created',
    issue: issues.join(','),
    caseId: null,
    partnerId: null,
    ...importAssignment(context, rules, value),
  }
  const effectiveTags = [
    ...rules.tags,
    ...value.recordTags.map((name) => rules.tagValues[name] ?? name),
  ].filter(Boolean)
  if (new Set(effectiveTags.map(importNameKey)).size > 10) return { ...plan, outcome: 'error', issue: 'tags' }
  if (issues.length) return { ...plan, outcome: 'error' }
  if (alreadySeen(seen, value)) return { ...plan, outcome: 'skipped', issue: 'fileDuplicate' }
  rememberContact(seen, value)
  const cases = matches.cases.filter((row) => contactMatches(row, value))
  const partners = matches.partners.filter((row) => contactMatches(row, value))
  const partnerIds = new Set([
    ...partners.map((row) => String(row.id)),
    ...cases.flatMap((row) => (row.partnerId ? [String(row.partnerId)] : [])),
  ])
  if (partnerIds.size > 1) return { ...plan, outcome: 'error', issue: 'ambiguous' }
  if (cases.some((row) => !['lead', 'opportunity'].includes(String(row.kind))))
    return { ...plan, outcome: 'skipped', issue: 'scope' }
  // Import permission never grants visibility into another salesperson's record.
  for (const row of cases)
    if (!audienceHolds(context.editAudience, row)) return { ...plan, outcome: 'skipped', issue: 'scope' }
  plan.partnerId = [...partnerIds][0] || null
  const open = cases.filter((row) => row.terminalState === 'open')
  if (open.length > 1 && rules.duplicate === 'merge') return { ...plan, outcome: 'error', issue: 'ambiguous' }
  if (open.length && rules.duplicate === 'skip')
    return { ...plan, outcome: 'skipped', issue: 'openDuplicate' }
  if (open.length && rules.duplicate === 'merge')
    return {
      ...plan,
      outcome: 'merged',
      caseId: String(open[0].id),
      teamId: String(open[0].teamId),
      assigneeUserId: open[0].assigneeUserId ? String(open[0].assigneeUserId) : null,
    }
  if (!audienceHolds(context.assignAudience, plan))
    return { ...plan, outcome: 'error', issue: 'assignmentPermission' }
  if ((rules.assignment === 'person' || rules.assignment === 'team') && !plan.assigneeUserId)
    return { ...plan, outcome: 'error', issue: 'teamEmpty' }
  if (plan.assigneeUserId && !context.users.some((user) => user.id === plan.assigneeUserId))
    return { ...plan, outcome: 'error', issue: 'assigneeInactive' }
  if (plan.partnerId) plan.outcome = 'linked'
  return plan
}

/** Preview advances an isolated snapshot; the worker persists the same counters. */
export function consumeImportAssignment(
  context: ImportPlanContext,
  row: PlannedImportRow,
  rules: ImportRules,
  timestamp: string,
) {
  if (!['created', 'linked'].includes(row.outcome) || !['team', 'rules'].includes(rules.assignment))
    return null
  const team = context.teams.find((team) => team.id === row.teamId)
  const member = context.members.find(
    (member) => member.teamId === row.teamId && member.userId === row.assigneeUserId,
  )
  if (!team || !member) return null
  member.assignedCount = Number(member.assignedCount || 0) + 1
  member.lastAssignedAt = timestamp
  team.assignmentCursor = Number(team.assignmentCursor || 0) + 1
  team.version = Number(team.version || 0) + 1
  return { team, member }
}

export async function previewImport(ctx: Ctx, batch: Row, offset = 0, outcome = '', limit = 50) {
  const mapping = batchMapping(batch),
    rules = batchRules(batch),
    data = batchData(batch)
  const context = await importPlanContext(ctx)
  const seen = new Set<string>(),
    counts: Record<string, number> = {},
    distribution: Record<string, number> = {}
  const rows: PlannedImportRow[] = []
  const canCreateTags = await importAllowed(ctx, 'crm.tag.save')
  const tags = await companyRows(ctx, 'crm.Tag', { active: true }),
    labels = await companyRows(ctx, 'crm.CustomerLabel', { active: true })
  const missingTags = new Set<string>(),
    missingLabels = new Set<string>()
  let matched = 0
  for (let start = 0; start < data.length; start += 200) {
    const slice = data.slice(start, start + 200)
    const matches = await matchImportContacts(
      ctx,
      slice.map((cells) => mapImportRow(cells, mapping, rules).value),
    )
    for (let i = 0; i < slice.length; i++) {
      const row = planImportRow(context, slice[i], mapping, rules, start + i + 1, matches, seen)
      consumeImportAssignment(context, row, rules, new Date().toISOString())
      counts[row.outcome] = (counts[row.outcome] || 0) + 1
      if (!['skipped', 'error'].includes(row.outcome))
        distribution[row.assigneeUserId || ''] = (distribution[row.assigneeUserId || ''] || 0) + 1
      for (const name of [
        ...rules.tags,
        ...row.normalized.recordTags.map((name) => rules.tagValues[name] ?? name),
      ].filter(Boolean))
        if (!tags.some((tag) => importNameKey(tag.name) === importNameKey(name))) missingTags.add(name)
      for (const name of row.normalized.customerLabels
        .map((name) => rules.customerLabelValues[name] ?? name)
        .filter(Boolean))
        if (!labels.some((label) => importNameKey(label.name) === importNameKey(name)))
          missingLabels.add(name)
      if (!outcome || row.outcome === outcome) {
        if (matched >= offset && rows.length < limit) rows.push(row)
        matched++
      }
    }
  }
  return {
    counts,
    distribution,
    rows,
    total: data.length,
    filtered: matched,
    offset,
    canCreateTags,
    missingTags: [...missingTags],
    missingLabels: [...missingLabels],
  }
}
