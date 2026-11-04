import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext, Translator } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { fold } from '../../product/text-fold.ts'
import { formatMoney } from '../../../ui/format.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { TEAM_PATH, teamHref, teamQuery } from './shared.ts'
import type { TeamAnswer, TeamModalData, TeamRow } from './shared.ts'

const str = (value: unknown) => String(value ?? '')

export function teamAnswer(teams: Row[], args: Row, money: (row: Row) => string): TeamAnswer {
  const requested = new URL(str(args.href) || TEAM_PATH, 'http://ket.local')
  if (typeof args.q === 'string') requested.searchParams.set('q', args.q)
  if (args.page != null) requested.searchParams.set('page', String(args.page))
  const query = teamQuery(requested, Number(args.pageSize) || undefined)
  const url = new URL(query.href, 'http://ket.local')
  // A team is found by its name or its leader's.
  const matched = teams.filter((row) =>
    [row.name, row.leaderName].some((value) => fold(str(value)).includes(fold(query.q))),
  )
  const active = matched.filter((row) => row.active !== false).length
  const status = url.searchParams.get('status')
  const rows = matched
    .filter(
      (row) => status === 'all' || (status === 'archived' ? row.active === false : row.active !== false),
    )
    .map((row) => ({
      row: {
        id: str(row.id),
        name: str(row.name),
        leaderName: str(row.leaderName),
        memberCount: Number(row.memberCount ?? 0),
        monthlyTarget: money(row),
        active: row.active !== false,
        editHref: '',
      } satisfies TeamRow,
      target: BigInt(str(row.monthlyTarget) || '0'),
    }))
  const direction = url.searchParams.get('dir') === 'desc' ? -1 : 1
  rows.sort(
    (a, b) =>
      direction *
        (url.searchParams.get('sort') === 'target'
          ? Number(a.target - b.target) || a.row.name.localeCompare(b.row.name, 'vi')
          : a.row.name.localeCompare(b.row.name, 'vi')) || a.row.id.localeCompare(b.row.id),
  )
  const pages = Math.max(1, Math.ceil(rows.length / query.pageSize)),
    page = Math.min(query.page, pages)
  const href = teamHref(query.href, { page: page > 1 ? String(page) : null })
  return {
    query: { ...query, page, href },
    total: rows.length,
    page,
    pages,
    counts: { active, archived: matched.length - active, all: matched.length },
    isEmpty: teams.length === 0,
    rows: rows
      .slice((page - 1) * query.pageSize, page * query.pageSize)
      .map(({ row }) => ({ ...row, editHref: recordModalHref(href, { kind: 'sale.team', id: row.id }) })),
    ...(page > 1 ? { previous: teamHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
    ...(page < pages ? { next: teamHref(href, { page: String(page + 1) }) } : {}),
  }
}

const target = (_: Translator) => (row: Row) =>
  formatMoney(_, str(row.monthlyTarget) || '0', str(row.currency) || 'VND')

export const teamRead =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.allows('sale.listTeams', url, req))) return text('Forbidden', { status: 403 })
    const input = await readForm(req)
    const teams = (await ctx.call('sale.listTeams', { includeArchived: true }, url, req)) as Row[]
    const _ = ctx.translate(ctx.localeOf(url, req) === 'en' ? 'en' : 'vi')
    return json({ ok: true, value: teamAnswer(teams, input, target(_)) })
  }

export const teamContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    const edit = await ctx.allows('sale.saveTeam', url, req)
    if (!(await ctx.allows('sale.listTeams', url, req)) || (creating && !edit))
      return text('Forbidden', { status: 403 })
    const current = creating
      ? undefined
      : ((await ctx.call('sale.listTeams', { ids: [params.id] }, url, req)) as Row[])[0]
    if (!creating && !current) return text('Not found', { status: 404 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const active = current?.active !== false
    const people =
      edit && active
        ? ((((await ctx.call('sale.getTeamChoices', {}, url, req)) as Row).salespeople as Row[]) ?? [])
        : []
    const memberIds = ((current?.memberIds as string[] | undefined) ?? []).map(String)
    const memberNames = (current?.memberNames as string[] | undefined) ?? []
    // A member or leader who left the company stays named in the team until someone changes it.
    const kept = [
      ...(current?.leaderId ? [{ id: str(current.leaderId), name: str(current.leaderName) }] : []),
      ...memberIds.map((id, index) => ({ id, name: str(memberNames[index]) })),
    ].filter((row) => !people.some((person) => person.id === row.id))
    const data: TeamModalData = {
      lang,
      record: {
        id: current ? str(current.id) : randomUUID(),
        name: str(current?.name),
        leaderId: str(current?.leaderId),
        memberIds,
        monthlyTarget: current ? str(current.monthlyTarget) : '',
        active,
        revisionId: str(current?.revisionId),
      },
      display: {
        leaderName: str(current?.leaderName) || '—',
        memberNames: memberNames.filter(Boolean).join(', ') || '—',
        monthlyTarget: current ? target(ctx.translate(lang))(current) : '—',
      },
      choices: {
        salespeople: [
          ...people.map((row) => ({ id: str(row.id), name: str(row.name) })),
          ...kept.filter((row, index) => kept.findIndex((other) => other.id === row.id) === index),
        ],
      },
      permissions: { edit: active && edit, lifecycle: await ctx.allows('sale.setTeamActive', url, req) },
    }
    const manifest = await ctx.live(req)
    return json({
      data,
      messages: Object.fromEntries(
        Object.entries(manifest.messages?.[lang] ?? {}).filter(
          ([key]) =>
            key.startsWith('sale_backend.team.') ||
            key.startsWith('sale.error.team.') ||
            key.startsWith('backend.relation.') ||
            key.startsWith('recordModal.'),
        ),
      ),
    })
  }
