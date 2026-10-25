import { createHash } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_READ_EFFECTS, effectiveFunctionKeys } from '../user/authorization.ts'
import { activityEffects, caseWriteEffects } from './functions/shared.ts'
import { canAssignCase, caseAudience, now } from './operations.ts'
import {
  defaultImportRules,
  IMPORT_LIMITS,
  importFields,
  importNameKey,
  mapImportRow,
} from './import-format.ts'
import type { ImportMapping, ImportRules } from './import-format.ts'

export const importReadEffects = [
  ...new Set([
    ...AUTHORIZATION_READ_EFFECTS,
    ...caseWriteEffects.filter((effect) => effect.startsWith('read:')),
    'read:crm.ImportBatch',
    'read:crm.ImportRow',
    'read:crm.CustomerLabel',
    'read:crm.CustomerLabelLink',
    'read:crm.AssignmentRule',
    'read:company.Company',
  ]),
]
export const importWriteEffects = [
  ...new Set([
    ...importReadEffects,
    ...caseWriteEffects,
    ...activityEffects,
    'write:crm.ImportBatch',
    'write:crm.ImportRow',
    'read:crm.ImportControl',
    'write:crm.ImportControl',
    'write:crm.TeamMember',
    'write:crm.Tag',
    'write:crm.CustomerLabel',
    'write:crm.CustomerLabelLink',
    'write:partner.Partner',
    'enqueue:crm.importChunk',
  ]),
]
export const importId = (...parts: unknown[]) =>
  `imp-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)}`
/** Import is one selected company's operation even when a reader can see several companies. */
export const companyRows = (ctx: Ctx, model: string, where: Row = {}) =>
  ctx.db.select(model, { ...where, companyId: ctx.scope.company })
export const objectOf = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return (value ?? fallback) as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
export const importFailure = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, code: `crm.import.${code}` }],
})
export class ImportAbort extends Error {
  readonly result: ReturnType<typeof importFailure>
  constructor(result: ReturnType<typeof importFailure>) {
    super('CRM import refused')
    this.result = result
  }
}
export function rejectImport(field: string, code: string): never {
  throw new ImportAbort(importFailure(field, code))
}
export async function importTransaction<T>(ctx: Ctx, body: (tx: Ctx) => Promise<T>) {
  try {
    return await ctx.tx(body)
  } catch (error) {
    if (error instanceof ImportAbort) return error.result
    throw error
  }
}
export const importAllowed = async (ctx: Ctx, key: string) => {
  if (!ctx.actor || !(await ctx.db.select('user.User', { id: ctx.actor, active: true }))[0]) return false
  const keys = await effectiveFunctionKeys(ctx, ctx.actor)
  return keys === null || keys.includes(key)
}
export async function ownedImport(ctx: Ctx, id: string, company = false): Promise<Row | null> {
  if (!ctx.actor || !ctx.scope.company) return null
  const batch = (await companyRows(ctx, 'crm.ImportBatch', { id }))[0]
  if (!batch) return null
  if (batch.actorUserId === ctx.actor) return batch
  return company && (await caseAudience(ctx)) === null ? batch : null
}
export const batchMapping = (batch: Row) => objectOf<ImportMapping>(batch.mapping, [])
export const batchRules = (batch: Row) => objectOf<ImportRules>(batch.rules, defaultImportRules())
export const batchData = (batch: Row) => objectOf<string[][]>(batch.data, [])

/** Acquire before matching or writing: serialization is company local, never process local. */
export async function lockImportCompany(ctx: Ctx) {
  await ctx.db.insertIfAbsent('crm.ImportControl', { id: importId(ctx.scope.company, 'control'), version: 0 })
  const lock = (
    await companyRows(ctx, 'crm.ImportControl', { id: importId(ctx.scope.company, 'control') })
  )[0]
  const changed = await ctx.db.compareAndSet(
    'crm.ImportControl',
    { id: lock.id },
    { version: lock.version },
    { version: Number(lock.version) + 1 },
  )
  if (!('dryRun' in changed) && !changed.matched)
    throw new Error('CRM import concurrent writer; retry transaction')
}

export async function validateImportPlan(ctx: Ctx, batch: Row, mappingInput: unknown, rulesInput: unknown) {
  const mapping = objectOf<ImportMapping>(mappingInput, [])
  const rules = { ...defaultImportRules(), ...objectOf<Partial<ImportRules>>(rulesInput, {}) }
  if (
    !Array.isArray(mapping) ||
    mapping.length !== objectOf<string[]>(batch.headers, []).length ||
    mapping.some((f) => !importFields.includes(f))
  )
    rejectImport('mapping', 'mapping')
  if (!mapping.includes('name') || (!mapping.includes('phone') && !mapping.includes('email')))
    rejectImport('mapping', 'mappingRequired')
  const targets = mapping.filter((f) => f !== 'ignore')
  if (new Set(targets).size !== targets.length) rejectImport('mapping', 'mappingDuplicate')
  if (
    !['lead', 'opportunity'].includes(rules.kind) ||
    !['merge', 'skip', 'create'].includes(rules.duplicate) ||
    !['rules', 'team', 'person', 'unassigned'].includes(rules.assignment) ||
    !['two-hours', 'today', 'tomorrow'].includes(rules.due)
  )
    rejectImport('rules', 'rules')
  if (
    typeof rules.firstTask !== 'boolean' ||
    !Array.isArray(rules.tags) ||
    rules.tags.length > 10 ||
    rules.tags.some((tag) => typeof tag !== 'string' || tag.length > 80 || !tag.trim())
  )
    rejectImport('tags', 'tags')
  for (const key of ['source', 'medium', 'campaign', 'teamId', 'assigneeUserId'] as const)
    if (typeof rules[key] !== 'string' || rules[key].length > 240) rejectImport(key, 'length')
  for (const key of ['tagValues', 'customerLabelValues'] as const) {
    if (
      !rules[key] ||
      typeof rules[key] !== 'object' ||
      Array.isArray(rules[key]) ||
      Object.keys(rules[key]).length > 200
    )
      rejectImport(key, 'tags')
    if (
      Object.entries(rules[key]).some(
        ([from, to]) => from.length > 80 || typeof to !== 'string' || to.length > 80,
      )
    )
      rejectImport(key, 'tags')
  }
  if (!(await importAllowed(ctx, 'crm.case.save'))) rejectImport('permission', 'permission')
  if (rules.firstTask && !(await importAllowed(ctx, 'crm.activity.schedule')))
    rejectImport('firstTask', 'permission')
  const teams = await companyRows(ctx, 'crm.Team', { active: true })
  let team = rules.teamId
    ? teams.find((team) => team.id === rules.teamId)
    : (teams.find((team) => team.code === 'SALES') ?? teams[0])
  if (rules.assignment === 'person') {
    if (!rules.assigneeUserId) rejectImport('assigneeUserId', 'required')
    const memberships = await companyRows(ctx, 'crm.TeamMember', {
      userId: rules.assigneeUserId,
      active: true,
    })
    team =
      teams.find(
        (team) =>
          team.id === rules.teamId &&
          (memberships.some((member) => member.teamId === team.id) ||
            team.leaderUserId === rules.assigneeUserId),
      ) ??
      teams.find(
        (team) =>
          memberships.some((member) => member.teamId === team.id) ||
          team.leaderUserId === rules.assigneeUserId,
      )
  }
  if (!team || (rules.assignment === 'team' && !rules.teamId)) rejectImport('teamId', 'required')
  rules.teamId = String(team.id)
  if (
    !(await canAssignCase(ctx, {
      teamId: team.id,
      assigneeUserId: rules.assignment === 'person' ? rules.assigneeUserId : null,
    }))
  )
    rejectImport('assignment', 'permission')
  if (rules.assignment === 'team') {
    const members = await companyRows(ctx, 'crm.TeamMember', { teamId: team.id, active: true })
    if (!members.length) rejectImport('teamId', 'teamEmpty')
  }
  const tagSet = new Set(rules.tags.map(importNameKey))
  const labelSet = new Set<string>()
  for (const row of batchData(batch)) {
    const { value } = mapImportRow(row, mapping, rules)
    for (const tag of value.recordTags) {
      const mapped = rules.tagValues[tag] ?? tag
      if (mapped) tagSet.add(importNameKey(mapped))
    }
    for (const label of value.customerLabels) {
      const mapped = rules.customerLabelValues[label] ?? label
      if (mapped) labelSet.add(importNameKey(mapped))
    }
  }
  const tags = await companyRows(ctx, 'crm.Tag', { active: true })
  const labels = await companyRows(ctx, 'crm.CustomerLabel', { active: true })
  const missing =
    [...tagSet].filter((key) => !tags.some((tag) => importNameKey(tag.name) === key)).length +
    [...labelSet].filter((key) => !labels.some((label) => importNameKey(label.name) === key)).length
  if (missing > IMPORT_LIMITS.newTags && (await importAllowed(ctx, 'crm.tag.save')))
    rejectImport('tags', 'newTags')
  // Unknown mapped values are visibly skipped for non-configurators. Explicit
  // new batch tags, however, must never be silently accepted and then dropped.
  if (
    rules.tags.some((name) => !tags.some((tag) => importNameKey(tag.name) === importNameKey(name))) &&
    !(await importAllowed(ctx, 'crm.tag.save'))
  )
    rejectImport('tags', 'permission')
  return { mapping, rules }
}

export async function changeBatch(ctx: Ctx, batch: Row, values: Row) {
  const changed = await ctx.db.compareAndSet(
    'crm.ImportBatch',
    { id: batch.id },
    { version: batch.version },
    { ...values, version: Number(batch.version) + 1, updatedAt: now() },
  )
  if (!('dryRun' in changed) && !changed.matched) rejectImport('version', 'conflict')
}
