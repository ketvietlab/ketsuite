import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { invalid, issue, n, normalized, seedCompanyRow, seededId, stageKinds } from '../operations.ts'
import { defaultLostReasons, LOST_REASON_CODES } from '../reporting.ts'
import { ASSIGNMENT_MODES, CASE_KINDS, SCORE_RULE_OPERATORS, TERMINAL_STATES } from '../types.ts'
import { command, optionRows, saveConfiguration } from './shared.ts'
import { importNameKey } from '../import-contract.ts'
import { importTransaction, lockImportCompany } from '../import-policy.ts'

/** A form value that was filled in: an empty field keeps what the row had. */
const given = (value: unknown) => value != null && String(value).trim() !== ''
/** A field a form may empty: sent empty, it clears; left out, the row keeps what it had. */
const cleared = (args: Record<string, unknown>, existing: Row | undefined, key: string) =>
  Object.hasOwn(args, key) ? (given(args[key]) ? args[key] : null) : (existing?.[key] ?? null)
const stageTerminal = (args: Record<string, unknown>, existing: Row | undefined): string =>
  TERMINAL_STATES.includes(args.terminalState as never)
    ? String(args.terminalState)
    : String(existing?.terminalState ?? 'open')

const saveTag: NonNullable<FnSpec['handler']> = (ctx, args) =>
  importTransaction(ctx, async (ctx) => {
    await lockImportCompany(ctx)
    const name = String(args.name ?? '').trim()
    if (!name || name.length > 80) return invalid(issue('name', 'crm.error.required'))
    const existing = (await ctx.db.select('crm.Tag', { id: args.id, companyId: ctx.scope.company }))[0]
    const clash = (await ctx.db.select('crm.Tag', { companyId: ctx.scope.company })).find(
      (row) => row.id !== args.id && importNameKey(row.name) === importNameKey(name),
    )
    if (clash) return invalid(issue('name', 'crm.error.duplicateName'))
    const values = {
      name,
      color: args.color ? String(args.color) : (existing?.color ?? null),
      active: args.active ?? existing?.active ?? true,
    }
    if (existing) await ctx.db.update('crm.Tag', { id: args.id }, values)
    else await ctx.db.insert('crm.Tag', { id: args.id, ...values })
    return { ok: true, id: args.id }
  })

const archiveTag: NonNullable<FnSpec['handler']> = (ctx, args) =>
  importTransaction(ctx, async (ctx) => {
    await lockImportCompany(ctx)
    const existing = (await ctx.db.select('crm.Tag', { id: args.id, companyId: ctx.scope.company }))[0]
    if (!existing) return invalid(issue('id', 'crm.error.notFound'))
    await ctx.db.update('crm.Tag', { id: args.id }, { active: false })
    // Archive hides the choice for future tagging; historical classification stays intact.
    return { ok: true, id: args.id }
  })

export const configurationFunctions: Record<string, FnSpec> = {
  /**
   * The lists the relational pickers page through.
   *
   * Each one takes the `search` and `limit` the picker sends on every keystroke
   * and returns a plain array, which is the shape `backend:relation.select`
   * reads. They exist so a user filling in a case never has to leave the form to
   * find a team, a stage or a tag.
   */
  'team.list': defineFn({
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', code: 'text', name: 'text', assignmentMode: 'text', active: 'bool' },
    effects: ['read:crm.Team'],
    agent: true,
    handler: (ctx, args) => optionRows(ctx, 'crm.Team', args),
  }),

  'stage.list': defineFn({
    input: { search: 'text?', limit: 'int?', kind: 'text?', includeArchived: 'bool?' },
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      sequence: 'int',
      terminalState: 'text',
      allowedKinds: 'json',
      active: 'bool',
    },
    effects: ['read:crm.Stage'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = await optionRows(ctx, 'crm.Stage', args, (a, b) => n(a.sequence) - n(b.sequence))
      return args.kind ? rows.filter((row) => stageKinds(row).includes(String(args.kind))) : rows
    },
  }),

  'tag.list': defineFn({
    input: { search: 'text?', limit: 'int?', cursor: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', name: 'text', color: 'text?', active: 'bool' },
    effects: ['read:crm.Tag'],
    agent: true,
    handler: (ctx, args) => optionRows(ctx, 'crm.Tag', args),
  }),

  /**
   * Tags were reachable from the data model and from `case.save`, but nothing
   * could create one — so the field could never hold a value. This is the
   * missing half, shaped for the picker's inline editor: an id and a name, no
   * idempotency key, because the picker mints the id itself.
   */
  'tag.save': defineFn({
    input: { id: 'id', name: 'text', color: 'text?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Tag', 'write:crm.Tag', 'read:crm.ImportControl', 'write:crm.ImportControl'],
    idempotent: true,
    agent: true,
    handler: saveTag,
  }),

  /**
   * A loss reason as the company names it. Internal: the sales command route checks `crm.stage.save`, the
   * configuration right, first. A company that has saved none reads the standard five; its first save writes
   * them all, so the list loses none.
   */
  'lostReason.save': defineFn({
    input: { values: 'json', lang: 'text?', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:crm.LostReason', 'write:crm.LostReason'],
    exposure: 'internal',
    idempotent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const values = (args.values && typeof args.values === 'object' ? args.values : {}) as Record<
        string,
        unknown
      >
      const name = String(values.name ?? '').trim()
      if (!name) return invalid(issue('name', 'crm.error.required'))
      const asked = String(values.id ?? '').trim()
      if (!asked) return invalid(issue('id', 'crm.error.required'))
      return ctx.tx(async (tx) => {
        if (!(await tx.db.select('crm.LostReason')).length)
          for (const reason of defaultLostReasons(args.lang === 'en' ? 'en' : 'vi'))
            await seedCompanyRow(tx, 'crm.LostReason', reason)
        const id = (await seededId(tx, 'crm.LostReason', asked)) ?? asked
        const existing = (await tx.db.select('crm.LostReason', { id }))[0]
        const expected = values.expectedVersion == null ? null : n(values.expectedVersion)
        if (existing && expected != null && n(existing.version) !== expected)
          return invalid(issue('version', 'crm.error.stageConflict', { current: n(existing.version) }))
        if ((await tx.db.select('crm.LostReason', { name })).some((row) => row.id !== id))
          return invalid(issue('name', 'crm.error.duplicateName'))
        const version = n(existing?.version) + 1
        const row = {
          name,
          // A new reason reports as "other" unless it names its bucket; a standard one keeps its own.
          code:
            existing?.code ?? (LOST_REASON_CODES.includes(values.code as never) ? String(values.code) : null),
          requiresNote: values.requiresNote ?? existing?.requiresNote ?? false,
          sequence: n(values.sequence ?? existing?.sequence ?? 10),
          active: values.active ?? existing?.active ?? true,
          version,
        }
        if (existing?.version != null) {
          const changed = await tx.db.compareAndSet(
            'crm.LostReason',
            { id },
            { version: n(existing.version) },
            row,
          )
          if (!('dryRun' in changed) && !changed.matched)
            return invalid(issue('version', 'crm.error.stageConflict', { current: n(existing.version) }))
        } else if (existing) await tx.db.update('crm.LostReason', { id }, row)
        else await tx.db.insert('crm.LostReason', { id, ...row })
        return { ok: true, id, version }
      })
    },
  }),

  'tag.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Tag', 'write:crm.Tag', 'read:crm.ImportControl', 'write:crm.ImportControl'],
    idempotent: true,
    agent: true,
    handler: archiveTag,
  }),

  'team.member.list': defineFn({
    input: { teamId: 'id?', search: 'text?', limit: 'int?' },
    output: {
      id: 'id',
      teamId: 'id',
      userId: 'id',
      userName: 'text?',
      capacity: 'int',
      sequence: 'int',
      assignedCount: 'int',
      active: 'bool',
    },
    effects: ['read:crm.TeamMember', 'read:user.User'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = args.teamId
        ? await ctx.db.select('crm.TeamMember', { teamId: args.teamId })
        : await ctx.db.select('crm.TeamMember')
      const users = new Map((await ctx.db.select('user.User')).map((user) => [String(user.id), user]))
      const needle = normalized(args.search)
      const named: Row[] = rows.map((row) => ({
        ...row,
        userName: users.get(String(row.userId))?.name ?? String(row.userId),
      }))
      return named
        .filter((row) => !needle || normalized(row.userName).includes(needle))
        .sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
        .slice(0, Math.max(1, Math.min(200, n(args.limit ?? 100))))
    },
  }),

  'team.member.remove': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.TeamMember', 'write:crm.TeamMember'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('crm.TeamMember', { id: args.id }))[0]
      if (!existing) return invalid(issue('id', 'crm.error.notFound'))
      await ctx.db.update('crm.TeamMember', { id: args.id }, { active: false })
      return { ok: true, id: args.id }
    },
  }),

  'configuration.get': defineFn({
    input: {},
    output: {
      teams: 'json',
      stages: 'json',
      assignmentRules: 'json',
      scoreRules: 'json',
    },
    effects: [
      'read:crm.Team',
      'read:crm.TeamMember',
      'read:crm.Stage',
      'read:crm.AssignmentRule',
      'read:crm.ScoreRule',
    ],
    handler: async (ctx) => {
      const [teams, members, stages, assignmentRules, scoreRules] = await Promise.all([
        ctx.db.select('crm.Team'),
        ctx.db.select('crm.TeamMember'),
        ctx.db.select('crm.Stage'),
        ctx.db.select('crm.AssignmentRule'),
        ctx.db.select('crm.ScoreRule'),
      ])
      const membersByTeam = new Map<string, Row[]>()
      for (const member of members) {
        const key = String(member.teamId)
        const rows = membersByTeam.get(key) ?? []
        rows.push(member)
        membersByTeam.set(key, rows)
      }
      return {
        teams: teams.map((team) => ({ ...team, members: membersByTeam.get(String(team.id)) ?? [] })),
        stages,
        assignmentRules,
        scoreRules,
      }
    },
  }),

  'team.save': saveConfiguration(
    'crm.Team',
    (args, existing) => ({
      code: String(args.code ?? existing?.code ?? args.id).trim(),
      name: String(args.name ?? '').trim(),
      active: args.active ?? existing?.active ?? true,
      leaderUserId: cleared(args, existing, 'leaderUserId'),
      assignmentMode: ASSIGNMENT_MODES.includes(args.assignmentMode as never)
        ? args.assignmentMode
        : (existing?.assignmentMode ?? 'manual'),
      assignmentCursor: existing?.assignmentCursor ?? 0,
      version: n(existing?.version) + 1,
    }),
    // A team used to save with an empty name, and a repeated code reached the
    // unique index as a database error instead of a refusal on the field.
    async (ctx, args, existing) => {
      if (!String(args.name ?? '').trim()) return invalid(issue('name', 'crm.error.required'))
      const code = String(args.code ?? existing?.code ?? '').trim()
      if (!code) return invalid(issue('code', 'crm.error.required'))
      if ((await ctx.db.select('crm.Team', { code })).some((row) => row.id !== args.id))
        return invalid(issue('code', 'crm.error.duplicateCode'))
      return null
    },
  ),

  'team.member.save': defineFn({
    input: {
      id: 'id',
      teamId: 'id',
      userId: 'id',
      capacity: 'int?',
      sequence: 'int?',
      active: 'bool?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Team', 'read:crm.TeamMember', 'write:crm.TeamMember', 'read:user.User'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const [team, user] = await Promise.all([
        ctx.db.select('crm.Team', { id: args.teamId, active: true }),
        ctx.db.select('user.User', { id: args.userId, active: true }),
      ])
      if (!team[0]) return invalid(issue('teamId', 'crm.error.notFound'))
      if (!user[0]) return invalid(issue('userId', 'crm.error.notFound'))
      const existing = (await ctx.db.select('crm.TeamMember', { id: args.id }))[0]
      // One membership per person per team: a second row for the same user used
      // to reach the unique index as a database error.
      const same = await ctx.db.select('crm.TeamMember', { teamId: args.teamId, userId: args.userId })
      if (same.some((row) => row.id !== args.id)) return invalid(issue('userId', 'crm.error.duplicateMember'))
      const values = {
        teamId: args.teamId,
        userId: args.userId,
        capacity: Math.max(1, n(args.capacity ?? existing?.capacity ?? 1)),
        sequence: n(args.sequence ?? existing?.sequence ?? 10),
        active: args.active ?? existing?.active ?? true,
        assignedCount: n(existing?.assignedCount),
        lastAssignedAt: existing?.lastAssignedAt ?? null,
      }
      if (existing) await ctx.db.update('crm.TeamMember', { id: args.id }, values)
      else await ctx.db.insert('crm.TeamMember', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),

  'stage.save': saveConfiguration(
    'crm.Stage',
    (args, existing) => {
      const terminalState = stageTerminal(args, existing)
      return {
        code: String(args.code ?? existing?.code ?? args.id).trim(),
        name: String(args.name ?? '').trim(),
        sequence: n(args.sequence ?? existing?.sequence ?? 10),
        allowedKinds: Array.isArray(args.allowedKinds)
          ? args.allowedKinds.map(String).filter((kind) => CASE_KINDS.includes(kind as never))
          : (existing?.allowedKinds ?? ['lead', 'opportunity']),
        terminalState,
        teamId: cleared(args, existing, 'teamId'),
        fold: args.fold ?? existing?.fold ?? false,
        active: args.active ?? existing?.active ?? true,
        // A won stage is certain and a lost one hopeless; an open one keeps what it was given, or nothing.
        probability:
          terminalState === 'won'
            ? '100'
            : terminalState === 'lost'
              ? '0'
              : given(args.probability)
                ? String(args.probability)
                : (existing?.probability ?? null),
        staleDays: given(args.staleDays) ? n(args.staleDays) : (existing?.staleDays ?? null),
      }
    },
    async (ctx, args, existing) => {
      if (!String(args.name ?? '').trim()) return invalid(issue('name', 'crm.error.required'))
      const code = String(args.code ?? '').trim()
      if (!code) return invalid(issue('code', 'crm.error.required'))
      if ((await ctx.db.select('crm.Stage', { code })).some((row) => row.id !== args.id))
        return invalid(issue('code', 'crm.error.duplicateCode'))
      if (!Array.isArray(args.allowedKinds) || args.allowedKinds.length === 0)
        return invalid(issue('allowedKinds', 'crm.error.required'))
      if (args.teamId && !(await ctx.db.select('crm.Team', { id: args.teamId, active: true }))[0])
        return invalid(issue('teamId', 'crm.error.notFound'))
      const probability = Number(args.probability)
      if (given(args.probability) && !(probability >= 0 && probability <= 100))
        return invalid(issue('probability', 'crm.error.outOfRange'))
      const stale = Number(args.staleDays)
      if (given(args.staleDays) && !(Number.isInteger(stale) && stale >= 0 && stale <= 365))
        return invalid(issue('staleDays', 'crm.error.outOfRange'))
      // The records in a stage must still fit it: move them before the stage stops taking their kind, team or state.
      if (existing) {
        const kinds = args.allowedKinds.map(String)
        const team = cleared(args, existing, 'teamId')
        const terminal = stageTerminal(args, existing)
        const active = args.active ?? existing.active ?? true
        const held = await ctx.db.select('crm.Case', { stageId: args.id, active: true })
        if (
          held.some(
            (row) =>
              !active ||
              !kinds.includes(String(row.kind)) ||
              (team && String(row.teamId ?? '') !== String(team)) ||
              String(row.terminalState) !== terminal,
          )
        )
          return invalid(issue('active', 'crm.error.stageInUse'))
      }
      return null
    },
    ['read:crm.Team', 'read:crm.Case'],
  ),

  'assignmentRule.save': saveConfiguration(
    'crm.AssignmentRule',
    (args, existing) => ({
      name: String(args.name ?? '').trim(),
      priority: n(args.priority ?? existing?.priority ?? 10),
      allowedKinds: Array.isArray(args.allowedKinds)
        ? args.allowedKinds.map(String)
        : (existing?.allowedKinds ?? []),
      teamId: args.teamId ?? existing?.teamId,
      assigneeUserId: cleared(args, existing, 'assigneeUserId'),
      utmSource: cleared(args, existing, 'utmSource'),
      minimumScore: cleared(args, existing, 'minimumScore'),
      active: args.active ?? existing?.active ?? true,
    }),
    async (ctx, args, existing) => {
      if (!String(args.name ?? '').trim()) return invalid(issue('name', 'crm.error.required'))
      // A rule saved without its kinds keeps the ones it had.
      const kinds = Array.isArray(args.allowedKinds) ? args.allowedKinds : existing?.allowedKinds
      if (!Array.isArray(kinds) || !kinds.length) return invalid(issue('allowedKinds', 'crm.error.required'))
      const team = args.teamId
        ? (await ctx.db.select('crm.Team', { id: args.teamId, active: true }))[0]
        : null
      if (!team) return invalid(issue('teamId', 'crm.error.notFound'))
      if (args.assigneeUserId) {
        const member = (
          await ctx.db.select('crm.TeamMember', {
            teamId: args.teamId,
            userId: args.assigneeUserId,
            active: true,
          })
        )[0]
        if (!member && team.leaderUserId !== args.assigneeUserId)
          return invalid(issue('assigneeUserId', 'crm.error.notTeamMember'))
      }
      return null
    },
    ['read:crm.Team', 'read:crm.TeamMember'],
  ),

  'scoreRule.save': saveConfiguration(
    'crm.ScoreRule',
    (args, existing) => ({
      name: String(args.name ?? '').trim(),
      field: String(args.field ?? '').trim(),
      operator: String(args.operator ?? 'eq'),
      value: String(args.value ?? ''),
      points: String(args.points ?? '0'),
      active: args.active ?? existing?.active ?? true,
      sequence: n(args.sequence ?? existing?.sequence ?? 10),
    }),
    (_ctx, args) => {
      const field = String(args.field ?? '')
      const operator = String(args.operator ?? '')
      const allowed = SCORE_RULE_OPERATORS[field] ?? []
      if (!String(args.name ?? '').trim()) return invalid(issue('name', 'crm.error.required'))
      if (!allowed.length) return invalid(issue('field', 'crm.error.required'))
      if (!allowed.includes(operator)) return invalid(issue('operator', 'crm.error.invalidOperator'))
      if (operator !== 'present' && !String(args.value ?? '').trim())
        return invalid(issue('value', 'crm.error.required'))
      if (field === 'expectedRevenue' && !Number.isFinite(Number(args.value)))
        return invalid(issue('value', 'crm.error.invalidKind'))
      return null
    },
  ),
}
