import { randomUUID } from 'node:crypto'
import { KetError, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { fold } from '../product/text-fold.ts'
import { userNames } from './customers.ts'
import { company, ours } from './scope.ts'
import { companyCurrency, invalid } from './functions/shared.ts'

/**
 * Sales teams (D16): a name, a leader, members and a monthly invoicing target, kept per company.
 * A salesperson sells in at most one team in use; an archived team frees its members and comes
 * back only if none of them joined another. An order is in its salesperson's team unless someone
 * picked another, and keeps an archived team it is already in.
 */
const refused = (field: string, reason: string) => invalid(field, `sale.error.team.${reason}`)
class TeamRefused extends Error {
  readonly result: ReturnType<typeof refused>
  constructor(field: string, reason: string) {
    super(reason)
    this.result = refused(field, reason)
  }
}
/** What naming a new order's salesperson and team reads (D16), for every writer that creates orders. */
export const ORDER_SALES_EFFECTS = [
  'read:user.Membership',
  'read:user.User',
  'read:sale.Team',
  'read:sale.TeamMember',
] as const
const nameKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('vi')
const MAX_TEAM_MEMBERS = 100

/** Active users of this company: the people who may sell, lead or join a team (one directory, D7). */
export async function salespeople(ctx: Ctx, ids?: readonly string[]): Promise<Set<string>> {
  if (ids && !ids.length) return new Set()
  const M = ctx.table('user.Membership')
  const members = (
    await ctx.db.all(
      from(M)
        .select(M.userId)
        .where(eq(M.companyId, company(ctx)), ...(ids ? [inArray(M.userId, [...ids])] : [])),
    )
  ).map((row) => String(row.userId))
  if (!members.length) return new Set()
  const U = ctx.table('user.User')
  return new Set(
    (await ctx.db.all(from(U).select(U.id, U.active).where(inArray(U.id, members))))
      .filter((row) => row.active !== false)
      .map((row) => String(row.id)),
  )
}

/** The team in use a salesperson sells in, if any. */
export async function teamOf(ctx: Ctx, userId: unknown): Promise<string | null> {
  if (!userId) return null
  return String((await ours(ctx, 'sale.TeamMember', { heldBy: String(userId) }))[0]?.teamId ?? '') || null
}

/** Saving and archiving hold the team row, so neither slips past the other. */
async function lockTeam(ctx: Ctx, id: unknown): Promise<Row | undefined> {
  const row = (await ours(ctx, 'sale.Team', { id }))[0]
  if (!row) return undefined
  const held = await ctx.db.compareAndSet(
    'sale.Team',
    { id: row.id },
    { revisionId: row.revisionId, active: row.active },
    { revisionId: row.revisionId },
  )
  if (!('dryRun' in held) && !held.matched)
    throw new KetError({ code: 'conflict', message: 'The team changed; reload before saving.' })
  return row
}

function uniqueViolation(error: unknown, pattern: RegExp) {
  for (let current = error, depth = 0; current && depth < 6; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (pattern.test(message)) return true
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null
  }
  return false
}
const duplicateName = (error: unknown) =>
  uniqueViolation(error, /sale_team.*name_key|name_key.*sale_team|UNIQUE constraint failed: sale_team\./i)
const memberTaken = (error: unknown) =>
  uniqueViolation(
    error,
    /sale_team_member.*held|held.*sale_team_member|UNIQUE constraint failed: sale_team_member\./i,
  )

/** Whole đồng, at most fifteen digits; empty is no target. */
function target(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return '0'
  return /^\d{1,15}$/.test(raw) ? String(BigInt(raw)) : null
}

/** Members are written by who they are, and hold their place only while the team is in use. */
async function writeMembers(tx: Ctx, teamId: string, memberIds: readonly string[], active: boolean) {
  const others = (await ours(tx, 'sale.TeamMember', { teamId })).map((row) => String(row.id))
  // The rows go by id: a member leaving one team may join another in the same save.
  const Member = tx.table('sale.TeamMember')
  if (others.length)
    await tx.db.del(deleteFrom(Member).where(eq(Member.companyId, company(tx)), inArray(Member.id, others)))
  for (const userId of memberIds)
    await tx.db.insert('sale.TeamMember', {
      id: JSON.stringify([company(tx), teamId, userId]),
      teamId,
      userId,
      heldBy: active ? userId : null,
    })
}

/** A member already selling in another team in use. */
async function takenMember(tx: Ctx, teamId: string, memberIds: readonly string[]) {
  if (!memberIds.length) return null
  const held = (await ours(tx, 'sale.TeamMember')).find(
    (row) => row.heldBy && row.teamId !== teamId && memberIds.includes(String(row.heldBy)),
  )
  return held ?? null
}

export async function saveTeam(ctx: Ctx, args: Row) {
  const name = String(args.name ?? '')
    .trim()
    .normalize('NFC')
  if (!name) return refused('name', 'required')
  if ([...name].length > 60) return refused('name', 'tooLong')
  const leaderId = String(args.leaderId ?? '').trim()
  if (!leaderId) return refused('leaderId', 'leader')
  if (!Array.isArray(args.memberIds) || args.memberIds.some((id) => typeof id !== 'string' || !id.trim()))
    return refused('memberIds', 'member')
  const memberIds = [...new Set(args.memberIds.map((id: string) => id.trim()))]
  if (memberIds.length > MAX_TEAM_MEMBERS) return refused('memberIds', 'tooMany')
  const monthlyTarget = target(args.monthlyTarget)
  if (monthlyTarget === null) return refused('monthlyTarget', 'target')
  try {
    return await ctx.tx(async (tx) => {
      const id = String(args.id)
      const current = await lockTeam(tx, id)
      if (!current && (await tx.db.select('sale.Team', { id })).length) return refused('id', 'missing')
      if (current?.active === false) return refused('id', 'inactive')
      if (current && args.expectedRevisionId !== current.revisionId)
        return refused('expectedRevisionId', 'conflict')
      const people = await salespeople(tx, [leaderId, ...memberIds])
      if (!people.has(leaderId)) return refused('leaderId', 'leader')
      if (memberIds.some((member) => !people.has(member))) return refused('memberIds', 'member')
      const key = nameKey(name)
      if ((await ours(tx, 'sale.Team', { nameKey: key })).some((row) => row.id !== id))
        return refused('name', 'duplicateName')
      if (await takenMember(tx, id, memberIds)) return refused('memberIds', 'memberTaken')
      const values = { name, nameKey: key, leaderId, monthlyTarget, active: true, revisionId: randomUUID() }
      if (current) await tx.db.update('sale.Team', { id }, values)
      else await tx.db.insert('sale.Team', { id, ...values })
      await writeMembers(tx, id, memberIds, true)
      return { ok: true, id, revisionId: values.revisionId }
    })
  } catch (error) {
    if (duplicateName(error)) return refused('name', 'duplicateName')
    if (memberTaken(error)) return refused('memberIds', 'memberTaken')
    throw error
  }
}

/** Archiving frees the members; bringing a team back holds them again, unless one sells elsewhere now. */
export async function setTeamActive(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx(async (tx) => {
      const row = await lockTeam(tx, args.id)
      if (!row) return refused('id', 'missing')
      if (args.expectedRevisionId !== row.revisionId) return refused('expectedRevisionId', 'conflict')
      const active = args.active === true
      const members = (await ours(tx, 'sale.TeamMember', { teamId: row.id })).map((m) => String(m.userId))
      if (active && (await takenMember(tx, String(row.id), members)))
        return refused('memberIds', 'memberTaken')
      const revisionId = randomUUID()
      await tx.db.update('sale.Team', { id: row.id }, { active, revisionId })
      await writeMembers(tx, String(row.id), members, active)
      return { ok: true, id: row.id, revisionId }
    })
  } catch (error) {
    if (memberTaken(error)) return refused('memberIds', 'memberTaken')
    throw error
  }
}

/** The company's teams by name, each with its leader's name and its members. */
export async function listTeams(ctx: Ctx, args: Row = {}) {
  const [teams, members] = await Promise.all([ours(ctx, 'sale.Team'), ours(ctx, 'sale.TeamMember')])
  const ids = Array.isArray(args.ids) ? new Set(args.ids.map(String)) : null
  const wanted = teams.filter((row) =>
    ids ? ids.has(String(row.id)) : args.includeArchived === true || row.active !== false,
  )
  const byTeam = new Map<string, string[]>()
  for (const member of members)
    byTeam.set(String(member.teamId), [...(byTeam.get(String(member.teamId)) ?? []), String(member.userId)])
  const currency = await companyCurrency(ctx)
  const names = await userNames(ctx, [
    ...wanted.map((row) => row.leaderId),
    ...wanted.flatMap((row) => byTeam.get(String(row.id)) ?? []),
  ])
  return wanted
    .map((row) => {
      const memberIds = (byTeam.get(String(row.id)) ?? []).sort((a, b) =>
        (names.get(a) ?? a).localeCompare(names.get(b) ?? b, 'vi'),
      )
      return {
        id: row.id,
        name: row.name,
        leaderId: row.leaderId,
        leaderName: names.get(String(row.leaderId)) ?? '',
        memberIds,
        memberNames: memberIds.map((id) => names.get(id) ?? ''),
        memberCount: memberIds.length,
        monthlyTarget: String(row.monthlyTarget ?? '0'),
        currency,
        active: row.active !== false,
        revisionId: row.revisionId,
      }
    })
    .sort(
      (a, b) =>
        String(a.name).localeCompare(String(b.name), 'vi') || String(a.id).localeCompare(String(b.id)),
    )
}

/** Who may lead or join a team, by name. */
export async function teamChoices(ctx: Ctx) {
  const ids = [...(await salespeople(ctx))]
  const names = await userNames(ctx, ids)
  return {
    salespeople: ids
      .map((id) => ({ id, name: names.get(id) ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id)),
  }
}

/**
 * The salesperson and team a new order starts with: the ones its caller named, else the customer's
 * salesperson (D11) or the person creating it, and that salesperson's team. An explicit null stays null.
 */
export async function orderSalesDefaults(ctx: Ctx, args: Row, customerUserId: unknown) {
  let userId: string | null
  if (args.userId === undefined) {
    const actor = typeof ctx.actor === 'string' ? ctx.actor : ''
    userId = customerUserId
      ? String(customerUserId)
      : actor && (await salespeople(ctx, [actor])).has(actor)
        ? actor
        : null
  } else userId = args.userId ? String(args.userId) : null
  if (args.userId && !(await salespeople(ctx, [String(args.userId)])).has(String(args.userId)))
    return refused('userId', 'salesperson')
  let teamId: string | null
  if (args.teamId === undefined) teamId = await teamOf(ctx, userId)
  else {
    teamId = args.teamId ? String(args.teamId) : null
    if (teamId && (await ours(ctx, 'sale.Team', { id: teamId }))[0]?.active !== true)
      return refused('teamId', 'invalid')
  }
  return { ok: true as const, userId, teamId }
}

/**
 * Names an order's salesperson and team, in any state: they say who sold it, not what was sold,
 * so the order keeps its revision. A new salesperson brings their team unless a team is named too;
 * the order keeps a salesperson who left or a team archived since, and takes on no other.
 */
export async function setOrderSalesperson(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx(async (tx) => {
      const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (!order) return refused('id', 'orderMissing')
      const current = {
        userId: order.userId ? String(order.userId) : null,
        teamId: order.teamId ? String(order.teamId) : null,
      }
      const userId = args.userId === undefined ? current.userId : args.userId ? String(args.userId) : null
      if (userId && userId !== current.userId && !(await salespeople(tx, [userId])).has(userId))
        return refused('userId', 'salesperson')
      let teamId: string | null
      if (args.teamId === undefined)
        teamId = userId === current.userId ? current.teamId : await teamOf(tx, userId)
      else teamId = args.teamId ? String(args.teamId) : null
      if (teamId && teamId !== current.teamId) {
        const team = (await ours(tx, 'sale.Team', { id: teamId }))[0]
        if (team?.active !== true) throw new TeamRefused('teamId', 'invalid')
      }
      await tx.db.update('sale.Order', { id: order.id }, { userId, teamId })
      return { ok: true, id: order.id, userId, teamId }
    })
  } catch (error) {
    if (error instanceof TeamRefused) return error.result
    throw error
  }
}

/** Who sold an order and with which team, by name, also once they left or the team was archived. */
export async function getOrderSales(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!order) return null
  const [named] = await withSalesNames(ctx, [order])
  return {
    id: order.id,
    userId: order.userId ?? null,
    userName: named?.userName ?? '',
    teamId: order.teamId ?? null,
    teamName: named?.teamName ?? '',
  }
}

/** The orders in a team whose name contains the search, without accents or case. */
export async function ordersInTeams(ctx: Ctx, search: string): Promise<string[]> {
  const wanted = fold(search.trim())
  if (!wanted) return []
  const ids = (await ours(ctx, 'sale.Team'))
    .filter((row) => fold(String(row.name)).includes(wanted))
    .map((row) => String(row.id))
  if (!ids.length) return []
  const O = ctx.table('sale.Order')
  const rows = await ctx.db.all(
    from(O)
      .select(O.id)
      .where(eq(O.companyId, company(ctx)), inArray(O.teamId, ids)),
  )
  return rows.map((row) => String(row.id))
}

/** Each listed order's salesperson and team by name, for lists that search in memory. */
export async function withSalesNames<R extends Row>(
  ctx: Ctx,
  rows: R[],
): Promise<Array<R & { userName: string; teamName: string }>> {
  const people = await userNames(
    ctx,
    rows.map((row) => row.userId),
  )
  const teamIds = [...new Set(rows.map((row) => String(row.teamId ?? '')).filter(Boolean))]
  const teams = new Map(
    teamIds.length
      ? (await ours(ctx, 'sale.Team'))
          .filter((row) => teamIds.includes(String(row.id)))
          .map((row) => [String(row.id), String(row.name)])
      : [],
  )
  return rows.map((row) => ({
    ...row,
    userName: row.userId ? (people.get(String(row.userId)) ?? '') : '',
    teamName: row.teamId ? (teams.get(String(row.teamId)) ?? '') : '',
  }))
}
