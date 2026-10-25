// @ts-nocheck Shared by the server read and the demo; its tests exercise it.
// One read per CRM sales screen. The island renders everything from this JSON; the server only draws the
// frame. The host hands over the state it may show (records, partners, activities, configuration), the
// people who own work and its access rules; every row passes the same rules as the commands that change it.
// Every date is local wall time (`YYYY-MM-DDTHH:mm:ss+07:00`), so a calendar day is the ISO prefix.
import { createSalesFormat, salesWords } from './format.mjs'

export class SalesError extends Error {
  constructor(code, message, fields = {}, status = 400) {
    super(message)
    Object.assign(this, { code, fields, status })
  }
}
const fail = (code, message, fields = {}, status = 400) => {
  throw new SalesError(code, message, fields, status)
}
export const clean = (value) =>
  String(value ?? '')
    .trim()
    .slice(0, 2000)
export const fold = (value) =>
  clean(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
export const phoneDigits = (value) => clean(value).replace(/\D/g, '').replace(/^84/, '0')

const DAY = 86_400_000
const calendarDays = (from, to) =>
  Math.round((Date.parse(String(to).slice(0, 10)) - Date.parse(String(from).slice(0, 10))) / DAY)
const pad = (n) => String(n).padStart(2, '0')
const addMonths = (key, n) => {
  const date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + n, 1))
  return date.toISOString().slice(0, 7)
}
const monthEnd = (key) =>
  new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10)
const within = (iso, [start, end]) => !!iso && iso.slice(0, 10) >= start && iso.slice(0, 10) <= end
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0)
const inMonthOrQuarter = (date, key) => {
  if (!date) return false
  const quarter = /^(\d{4})-q([1-4])$/i.exec(key)
  if (!quarter) return date.startsWith(key)
  const month = Number(date.slice(5, 7))
  return date.startsWith(quarter[1]) && Math.ceil(month / 3) === Number(quarter[2])
}
/** The calendar quarter of a month (`2026-09`), and its first and last day. */
const quarterOf = (month) => {
  const year = Number(month.slice(0, 4)),
    quarter = Math.ceil(Number(month.slice(5, 7)) / 3)
  return {
    key: `${year}-q${quarter}`,
    range: [`${year}-${pad(quarter * 3 - 2)}-01`, monthEnd(`${year}-${pad(quarter * 3)}`)],
  }
}

/**
 * The reads of the CRM sales screens over one state.
 * - `clock`: now, as local wall time; "today", this month and the reporting periods follow it.
 * - `people`: who may own work (`{ id, name }`); owner filters and the leaderboard only name them.
 * - `access.canRead(actor, row?)` / `access.canWrite(actor, row?)`: without a row, whether the screen opens.
 * - `assigned(state, userId)`: open records a member holds, for the assignment preview.
 * - `defaults`: the record and team a screen shows when the address names none (the demo's sample).
 * - `demo`: the demo may ask for its sample invalid draft (`state=invalid`).
 * @param {{
 *   clock: string,
 *   people: { id: string, name: string }[],
 *   access: { canRead: (actor: any, row?: any) => boolean, canWrite: (actor: any, row?: any) => boolean },
 *   sources?: string[],
 *   intakeSources?: string[],
 *   defaults?: { record?: string, team?: string },
 *   demo?: boolean,
 *   assigned?: (state: any, userId: string) => number,
 * }} options
 */
export const createSalesRead = ({
  clock,
  people,
  access: { canRead, canWrite },
  sources = [],
  intakeSources = [],
  defaults = {},
  demo = false,
  assigned = (state, userId) =>
    state.records.filter((r) => !r.archived && r.terminal === 'open' && r.assignee === userId).length,
}) => {
  const today = clock.slice(0, 10),
    thisMonth = clock.slice(0, 7),
    minute = clock.slice(0, 16)
  // An activity due on a day without a time is late once that day is over.
  const pastDue = (dueAt) => (dueAt.length > 10 ? dueAt < minute : dueAt < today)
  // Business views of the record list. An explicit filter in the address wins over the view's default.
  const views = {
    all: {},
    open: { state: 'open' },
    mine: { state: 'open', owner: 'me' },
    attention: { state: 'open', attention: 'any' },
    closing: { state: 'open', closing: thisMonth },
    won: { state: 'won' },
    lost: { state: 'lost' },
  }
  const salesViews = Object.keys(views)
  const personName = (id) => people.find((p) => p.id === id)?.name ?? ''

  /** What a manager needs to know about one record now: next step, stage age and what needs attention. */
  const salesInsight = (state, row) => {
    const open = row.terminal === 'open',
      stage = state.config.stages.find((s) => s.id === row.stageId),
      planned = state.activities
        .filter((a) => a.caseId === row.id && a.state === 'open')
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      next = planned[0] ?? null,
      stageDays = calendarDays(row.stageAt ?? row.createdAt, clock),
      flags = []
    if (open) {
      if (row.kind === 'opportunity' && !row.closing) flags.push('no-close')
      if (row.kind === 'opportunity' && row.closing && row.closing < today) flags.push('overdue-close')
      if (!next) flags.push('no-next')
      else if (pastDue(next.dueAt)) flags.push('overdue-activity')
      if (stage?.staleDays && stageDays > stage.staleDays) flags.push('stale')
      if (!row.assignee) flags.push('unassigned')
    }
    return {
      next,
      planned: planned.length,
      stageDays,
      idleDays: calendarDays(row.updatedAt ?? row.createdAt, clock),
      weighted: open && row.kind === 'opportunity' ? (row.revenue * row.probability) / 100 : 0,
      flags,
    }
  }
  const visibleRecords = (state, actor) => state.records.filter((r) => !r.archived && canRead(actor, r))
  const visiblePartners = (state, actor) =>
    actor.role === 'manager' || actor.role === 'viewer'
      ? state.partners
      : state.partners.filter(
          (p) => p.linked || visibleRecords(state, actor).some((r) => r.partnerId === p.id),
        )
  const getCase = (state, id, actor) => {
    const row = state.records.find((r) => r.id === id && !r.archived)
    if (!row || !canRead(actor, row))
      fail('E_NOT_FOUND', 'Không tìm thấy hồ sơ trong phạm vi được xem.', {}, 404)
    return row
  }
  const scoreExplanation = (state, row) =>
    state.config.scoreRules
      .filter((r) => r.active)
      .map((r) => {
        const value = {
          email: row.email,
          utmSource: row.source.toLowerCase(),
          expectedRevenue: row.revenue,
        }[r.field]
        const matched =
          r.operator === 'present'
            ? Boolean(value)
            : r.operator === 'gte'
              ? Number(value) >= Number(r.value)
              : r.operator === 'contains'
                ? fold(value).includes(fold(r.value))
                : fold(value) === fold(r.value)
        return { id: r.id, name: r.name, matched, points: matched ? Number(r.points) : 0 }
      })
  const assignmentPreview = (state, row, options = {}) => {
    const rules = state.config.assignmentRules
      .filter(
        (r) =>
          !options.ignoreRules &&
          r.active &&
          r.allowedKinds.includes(row.kind) &&
          (!r.utmSource || fold(r.utmSource) === fold(row.source)) &&
          (r.minimumScore === null || row.score >= Number(r.minimumScore)),
      )
      .sort((a, b) => a.priority - b.priority)
    const rule = rules[0],
      team = state.config.teams.find((t) => t.id === (rule?.teamId ?? row.teamId) && t.active)
    const members = (team?.members ?? [])
      .filter((m) => m.active)
      .map((m) => ({ ...m, assigned: assigned(state, m.userId) }))
    const mode = team?.assignmentMode
    const owner =
      (members.some((m) => m.userId === rule?.assigneeUserId) ? rule.assigneeUserId : '') ||
      (mode === 'manual'
        ? ''
        : mode === 'round_robin'
          ? members.sort((a, b) => a.sequence - b.sequence)[
              (state.assignmentCounts?.[team.id] ?? 0) % Math.max(1, members.length)
            ]?.userId
          : members.sort(
              (a, b) => a.assigned / Math.max(1, a.capacity) - b.assigned / Math.max(1, b.capacity),
            )[0]?.userId) ||
      ''
    return {
      rule: rule?.name ?? 'Không khớp quy tắc',
      teamId: team?.id ?? row.teamId,
      owner,
      reason: owner
        ? `${rule?.name ?? 'Cơ chế đội'} · ${mode}`
        : mode === 'manual'
          ? 'Đội dùng phân công thủ công; giữ hàng đợi chưa phân công.'
          : 'Chưa có thành viên phù hợp; giữ hàng đợi chưa phân công.',
    }
  }
  const duplicateCandidates = (state, row) =>
    state.records.filter(
      (r) =>
        r.id !== row.id &&
        !r.archived &&
        ((phoneDigits(row.phone) && phoneDigits(r.phone) === phoneDigits(row.phone)) ||
          (row.email && fold(r.email) === fold(row.email))),
    )

  const searchSales = (state, input, actor) => {
    if (!canRead(actor)) fail('E_FORBIDDEN', 'Không có quyền xem CRM.', {}, 403)
    const query = {
      q: clean(input.q).slice(0, 100),
      state: ['open', 'won', 'lost'].includes(input.state) ? input.state : '',
      kind: ['lead', 'opportunity'].includes(input.kind) ? input.kind : '',
      owner:
        input.owner === 'me' || input.owner === 'none' || people.some((p) => p.id === input.owner)
          ? input.owner
          : '',
      team: state.config.teams.some((t) => t.id === input.team) ? input.team : '',
      stage: state.config.stages.some((s) => s.id === input.stage) ? input.stage : '',
      source: clean(input.source).slice(0, 40),
      closing: /^(overdue|missing|\d{4}-\d{2})$/.test(input.closing ?? '') ? input.closing : '',
      closed: /^\d{4}-(\d{2}|q[1-4])$/i.test(input.closed ?? '') ? input.closed.toLowerCase() : '',
      created: /^\d{4}-(\d{2}|q[1-4])$/i.test(input.created ?? '') ? input.created.toLowerCase() : '',
      attention: [
        'any',
        'overdue-close',
        'no-close',
        'no-next',
        'overdue-activity',
        'stale',
        'unassigned',
      ].includes(input.attention)
        ? input.attention
        : '',
      sort: [
        'name',
        'title',
        '-title',
        'revenue',
        '-revenue',
        'updated',
        'priority',
        'closing',
        '-closing',
      ].includes(input.sort)
        ? input.sort
        : 'updated',
      page: Math.max(1, Number(input.page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(input.pageSize) || 25)),
    }
    let rows = visibleRecords(state, actor).filter(
      (r) =>
        (!query.kind || r.kind === query.kind) &&
        (!query.owner ||
          r.assignee === (query.owner === 'me' ? actor.id : query.owner === 'none' ? '' : query.owner)) &&
        (!query.team || r.teamId === query.team) &&
        (!query.stage || r.stageId === query.stage) &&
        (!query.source || r.source === query.source) &&
        (!query.closing ||
          (query.closing === 'missing'
            ? r.kind === 'opportunity' && r.terminal === 'open' && !r.closing
            : query.closing === 'overdue'
              ? r.terminal === 'open' && !!r.closing && r.closing < today
              : r.closing.startsWith(query.closing))) &&
        (!query.closed || inMonthOrQuarter(r.closedAt, query.closed)) &&
        (!query.created || inMonthOrQuarter(r.createdAt, query.created)) &&
        (!query.attention ||
          (query.attention === 'any'
            ? salesInsight(state, r).flags.length > 0
            : salesInsight(state, r).flags.includes(query.attention))) &&
        (!query.q ||
          fold(`${r.id} ${r.name} ${r.partner} ${r.phone}`).includes(fold(query.q)) ||
          (/^[+\d\s().-]+$/.test(query.q) && phoneDigits(r.phone).includes(phoneDigits(query.q)))),
    )
    const counts = Object.fromEntries(
      ['all', 'open', 'won', 'lost'].map((k) => [
        k,
        rows.filter((r) => k === 'all' || r.terminal === k).length,
      ]),
    )
    rows = rows.filter((r) => !query.state || r.terminal === query.state)
    rows.sort((a, b) =>
      ['name', 'title', '-title'].includes(query.sort)
        ? a.name.localeCompare(b.name, 'vi') * (query.sort === '-title' ? -1 : 1)
        : query.sort === 'revenue'
          ? a.revenue - b.revenue
          : query.sort === '-revenue'
            ? b.revenue - a.revenue
            : query.sort === 'priority'
              ? b.priority - a.priority
              : query.sort === 'closing' || query.sort === '-closing'
                ? ((a.closing || '9999') < (b.closing || '9999') ? -1 : a.closing === b.closing ? 0 : 1) *
                  (query.sort === '-closing' ? -1 : 1)
                : b.updatedAt.localeCompare(a.updatedAt) ||
                  (b.updatedRevision ?? 0) - (a.updatedRevision ?? 0),
    )
    const total = rows.length,
      pages = Math.max(1, Math.ceil(total / query.pageSize))
    query.page = Math.min(pages, query.page)
    return {
      query,
      total,
      page: query.page,
      pages,
      rows: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      counts,
      isEmpty: total === 0,
    }
  }

  const allRows = (state, input, actor) => {
    const first = searchSales(state, { ...input, page: 1, pageSize: 100 }, actor),
      rows = [...first.rows]
    for (let page = 2; page <= first.pages; page++)
      rows.push(...searchSales(state, { ...input, page, pageSize: 100 }, actor).rows)
    return rows
  }

  /** One page of the record list, with the counts of every business view under the same filters. */
  const salesRows = (state, input, actor) => {
    const view = views[input.view] ? input.view : views[input.state] ? input.state : 'all'
    const explicit = Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) => value !== '' && value != null && !['view', 'state'].includes(key),
      ),
    )
    const result = searchSales(state, { ...views[view], ...explicit }, actor)
    const lang = input.lang === 'en' ? 'en' : 'vi',
      fmt = createSalesFormat(lang, clock),
      words = salesWords(lang),
      t = fmt.t
    const filtersOnly = Object.fromEntries(
      Object.entries(explicit).filter(([key]) => !['page', 'pageSize', 'sort'].includes(key)),
    )
    const viewCounts = Object.fromEntries(
      salesViews.map((id) => [
        id,
        searchSales(state, { ...views[id], ...filtersOnly, pageSize: 1 }, actor).total,
      ]),
    )
    result.rows = result.rows.map((r) => {
      const insight = salesInsight(state, r),
        stage = state.config.stages.find((s) => s.id === r.stageId),
        open = r.terminal === 'open',
        close = fmt.closing(r.closing, open),
        team = state.config.teams.find((x) => x.id === r.teamId)
      return {
        ...r,
        title: [r.name, `${r.id} · ${r.partner}`],
        kindLabel: words.kind[r.kind],
        stage: [
          stage?.name ?? r.stageId,
          r.terminal === 'won' ? 'positive' : r.terminal === 'lost' ? 'danger' : 'neutral',
        ],
        assigneeLabel: personName(r.assignee) || t('Chưa phân công', 'Unassigned'),
        owner: [personName(r.assignee) || t('Chưa phân công', 'Unassigned'), team?.name ?? ''],
        revenue: { amount: r.revenue, currency: 'VND' },
        closingLabel: !open
          ? [fmt.date(r.closedAt), words.terminal[r.terminal]]
          : r.kind === 'lead'
            ? ['—']
            : r.closing
              ? [fmt.date(r.closing), close.state === 'later' ? null : close.label, close.tone]
              : ['—', close.label, close.tone],
        next: !open
          ? [r.terminal === 'lost' ? r.lostReason || '—' : '—']
          : insight.next
            ? [
                insight.next.title,
                fmt.due(insight.next.dueAt).label,
                fmt.due(insight.next.dueAt).tone === 'neutral' ? null : fmt.due(insight.next.dueAt).tone,
              ]
            : ['—', words.attention['no-next'], 'warning'],
        updated: fmt.relative(r.updatedAt),
        state: [words.terminal[r.terminal], words.terminalTone[r.terminal]],
        flags: insight.flags,
        record: { id: r.id, screen: 'lead-detail' },
      }
    })
    result.isEmpty = visibleRecords(state, actor).length === 0
    result.counts = { view: viewCounts, filters: {} }
    result.query.view = view
    return result
  }

  const project = (state, row) => {
    const insight = salesInsight(state, row)
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      partner: row.partner,
      partnerId: row.partnerId,
      contact: row.contact,
      phone: row.phone,
      email: row.email,
      source: row.source,
      stageId: row.stageId,
      assignee: row.assignee,
      teamId: row.teamId,
      revenue: row.revenue,
      probability: row.probability,
      priority: row.priority,
      terminal: row.terminal,
      score: row.score,
      tags: row.tags ?? [],
      description: row.description ?? '',
      closing: row.closing ?? '',
      lostReason: row.lostReason ?? '',
      createdAt: row.createdAt,
      stageAt: row.stageAt ?? row.createdAt,
      closedAt: row.closedAt ?? null,
      closedFrom: row.closedFrom ?? null,
      updatedAt: row.updatedAt,
      version: row.version,
      consent: !!row.consent,
      utmMedium: row.utmMedium ?? '',
      utmCampaign: row.utmCampaign ?? '',
      weighted: insight.weighted,
      stageDays: insight.stageDays,
      idleDays: insight.idleDays,
      flags: insight.flags,
      planned: insight.planned,
      next: insight.next
        ? {
            id: insight.next.id,
            title: insight.next.title,
            type: insight.next.type,
            dueAt: insight.next.dueAt,
            owner: insight.next.owner,
          }
        : null,
    }
  }

  const lastMonth = addMonths(thisMonth, -1),
    quarter = quarterOf(thisMonth),
    quarterBefore = quarterOf(addMonths(thisMonth, -3))
  const periods = {
    month: {
      start: `${thisMonth}-01`,
      end: monthEnd(thisMonth),
      key: thisMonth,
      previous: [`${lastMonth}-01`, monthEnd(lastMonth)],
    },
    quarter: {
      start: quarter.range[0],
      end: quarter.range[1],
      key: quarter.key,
      previous: quarterBefore.range,
    },
    previous: {
      start: `${lastMonth}-01`,
      end: monthEnd(lastMonth),
      key: lastMonth,
      previous: [`${addMonths(thisMonth, -2)}-01`, monthEnd(addMonths(thisMonth, -2))],
    },
  }

  const insights = (state, actor, params) => {
    const periodId = periods[params.get('period')] ? params.get('period') : 'month',
      period = periods[periodId],
      current = [period.start, period.end],
      previous = period.previous,
      team = state.config.teams.some((x) => x.id === params.get('team')) ? params.get('team') : '',
      owner =
        params.get('owner') === 'me'
          ? actor.id
          : people.some((p) => p.id === params.get('owner'))
            ? params.get('owner')
            : ''
    const scope = visibleRecords(state, actor).filter(
      (r) => (!team || r.teamId === team) && (!owner || r.assignee === owner),
    )
    const closedIn = (range, outcome) =>
      scope.filter((r) => r.terminal === outcome && within(r.closedAt, range))
    const won = closedIn(current, 'won'),
      lost = closedIn(current, 'lost'),
      wonBefore = closedIn(previous, 'won'),
      lostBefore = closedIn(previous, 'lost')
    const rate = (w, l) => (w.length + l.length ? w.length / (w.length + l.length) : null)
    const cycle = (rows) =>
      rows.length
        ? Math.round(sum(rows, (r) => (Date.parse(r.closedAt) - Date.parse(r.createdAt)) / DAY) / rows.length)
        : null
    const open = scope.filter((r) => r.terminal === 'open'),
      openDeals = open.filter((r) => r.kind === 'opportunity')
    const created = (range) => scope.filter((r) => within(r.createdAt, range))
    const months = Array.from({ length: 4 }, (_, i) => addMonths(thisMonth, i))
    const forecast = months.map((month) => {
      const rows = openDeals.filter((r) => r.closing?.startsWith(month) && r.closing >= today),
        closedWon = scope.filter((r) => r.terminal === 'won' && r.closedAt?.startsWith(month))
      return {
        month,
        won: sum(closedWon, (r) => r.revenue),
        gross: sum(rows, (r) => r.revenue),
        weighted: sum(rows, (r) => (r.revenue * r.probability) / 100),
        count: rows.length,
      }
    })
    const late = openDeals.filter((r) => r.closing && r.closing < today),
      undated = openDeals.filter((r) => !r.closing)
    const trend = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i - 5)).map((month) => {
      const range = [`${month}-01`, monthEnd(month)],
        w = closedIn(range, 'won'),
        l = closedIn(range, 'lost')
      return { month, won: sum(w, (r) => r.revenue), wonCount: w.length, lostCount: l.length }
    })
    const funnel = state.config.stages
      .filter((s) => s.active && s.terminalState === 'open')
      .sort((a, b) => a.sequence - b.sequence)
      .map((stage) => {
        const rows = open.filter((r) => r.stageId === stage.id)
        return {
          stageId: stage.id,
          count: rows.length,
          gross: sum(rows, (r) => r.revenue),
          weighted: sum(rows, (r) => (r.revenue * r.probability) / 100),
        }
      })
    const bySource = sources
      .map((source) => {
        const rows = scope.filter((r) => r.source === source),
          w = rows.filter((r) => r.terminal === 'won'),
          l = rows.filter((r) => r.terminal === 'lost')
        return {
          source,
          total: rows.length,
          open: rows.filter((r) => r.terminal === 'open').length,
          won: w.length,
          lost: l.length,
          winRate: rate(w, l),
          wonValue: sum(w, (r) => r.revenue),
        }
      })
      .filter((row) => row.total)
    const leaders = people
      .map((p) => {
        const mine = scope.filter((r) => r.assignee === p.id),
          w = mine.filter((r) => r.terminal === 'won' && within(r.closedAt, current)),
          l = mine.filter((r) => r.terminal === 'lost' && within(r.closedAt, current)),
          o = mine.filter((r) => r.terminal === 'open')
        return {
          userId: p.id,
          won: sum(w, (r) => r.revenue),
          wonCount: w.length,
          winRate: rate(w, l),
          open: o.length,
          gross: sum(
            o.filter((r) => r.kind === 'opportunity'),
            (r) => r.revenue,
          ),
          weighted: sum(o, (r) => (r.kind === 'opportunity' ? (r.revenue * r.probability) / 100 : 0)),
          overdue: state.activities.filter(
            (a) =>
              a.owner === p.id && a.state === 'open' && pastDue(a.dueAt) && o.some((r) => r.id === a.caseId),
          ).length,
        }
      })
      .filter((row) => row.open || row.wonCount || row.won)
      .sort((a, b) => b.won - a.won || b.weighted - a.weighted)
    const risks = openDeals
      .map((r) => project(state, r))
      .filter((r) =>
        r.flags.some((flag) =>
          ['overdue-close', 'no-close', 'no-next', 'overdue-activity', 'stale'].includes(flag),
        ),
      )
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6)
    const riskCount = openDeals.filter((r) => salesInsight(state, r).flags.length).length
    const losses = state.config.lostReasons
      .map((reason) => {
        const rows = lost.filter((r) => r.lostReason === reason.name)
        return { id: reason.id, name: reason.name, count: rows.length, value: sum(rows, (r) => r.revenue) }
      })
      .filter((row) => row.count)
      .sort((a, b) => b.count - a.count)
    return {
      period: { id: periodId, start: period.start, end: period.end, key: period.key, previous },
      filters: { team, owner: params.get('owner') === 'me' ? 'me' : owner },
      kpis: {
        won: {
          value: sum(won, (r) => r.revenue),
          count: won.length,
          previous: sum(wonBefore, (r) => r.revenue),
          previousCount: wonBefore.length,
        },
        winRate: {
          value: rate(won, lost),
          previous: rate(wonBefore, lostBefore),
          won: won.length,
          lost: lost.length,
        },
        pipeline: {
          gross: sum(openDeals, (r) => r.revenue),
          weighted: sum(openDeals, (r) => (r.revenue * r.probability) / 100),
          count: openDeals.length,
        },
        created: { count: created(current).length, previous: created(previous).length },
        avgDeal: {
          value: won.length ? sum(won, (r) => r.revenue) / won.length : null,
          previous: wonBefore.length ? sum(wonBefore, (r) => r.revenue) / wonBefore.length : null,
        },
        cycle: { value: cycle(won), previous: cycle(wonBefore) },
      },
      forecast,
      late: { count: late.length, gross: sum(late, (r) => r.revenue) },
      undated: { count: undated.length, gross: sum(undated, (r) => r.revenue) },
      trend,
      funnel,
      sources: bySource,
      leaders,
      risks,
      riskCount,
      losses,
    }
  }

  const pipeline = (state, actor, params) => {
    const filters = {
      q: (params.get('q') ?? '').slice(0, 100),
      owner:
        params.get('owner') === 'me' ||
        params.get('owner') === 'none' ||
        people.some((p) => p.id === params.get('owner'))
          ? params.get('owner')
          : '',
      team: state.config.teams.some((x) => x.id === params.get('team')) ? params.get('team') : '',
    }
    const rows = allRows(state, { ...filters, state: 'open' }, actor)
    const lanes = state.config.stages
      .filter((s) => s.active && s.terminalState === 'open')
      .sort((a, b) => a.sequence - b.sequence)
      .map((stage) => {
        const cards = rows
          .filter((r) => r.stageId === stage.id)
          .map((r) => ({ ...project(state, r), writable: canWrite(actor, r) }))
          .sort((a, b) => (a.closing || '9999').localeCompare(b.closing || '9999') || b.revenue - a.revenue)
        return {
          stageId: stage.id,
          count: cards.length,
          gross: sum(cards, (r) => r.revenue),
          weighted: sum(cards, (r) => r.weighted),
          cards,
        }
      })
    const closed = allRows(
      state,
      { q: filters.q, owner: filters.owner, team: filters.team, closed: thisMonth },
      actor,
    )
    const outcome = (terminal) => {
      const list = closed.filter((r) => r.terminal === terminal)
      return { count: list.length, value: sum(list, (r) => r.revenue) }
    }
    return {
      filters,
      lanes,
      closed: { won: outcome('won'), lost: outcome('lost'), month: thisMonth },
      totals: {
        count: rows.length,
        gross: sum(
          rows.filter((r) => r.kind === 'opportunity'),
          (r) => r.revenue,
        ),
        weighted: sum(rows, (r) => salesInsight(state, r).weighted),
      },
    }
  }

  const lineDetail = (state, line) => {
    const product = state.products?.find((p) => p.id === line.product),
      net = line.quantity * line.price * (1 - (line.discount ?? 0) / 100)
    return {
      ...line,
      name: product?.name ?? (line.name || line.product),
      net: Math.round(net),
      tax: line.tax ?? 0,
      taxAmount: Math.round((net * (line.tax ?? 0)) / 100),
    }
  }

  const recordBundle = (state, actor, params) => {
    const row = getCase(state, params.get('id') || params.get('case') || defaults.record || '', actor),
      partner = state.partners.find((p) => p.id === row.partnerId),
      stage = state.config.stages.find((s) => s.id === row.stageId)
    const path = state.config.stages
      .filter((s) => s.active && s.terminalState === 'open' && s.allowedKinds.includes(row.kind))
      .sort((a, b) => a.sequence - b.sequence)
    const activities = state.activities
      .filter((a) => a.caseId === row.id)
      .map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        owner: a.owner,
        dueAt: a.dueAt,
        state: a.state,
        version: a.version,
        outcome: a.outcome ?? '',
        completedAt: a.completedAt ?? null,
      }))
    // Commands that already leave a message or a finished activity are shown through that entry.
    const shownElsewhere = new Set([
      'email',
      'email-retry',
      'note',
      'interaction',
      'activity-complete',
      'activity-cancel',
    ])
    const feed = [
      ...state.timeline
        .filter((e) => e.caseId === row.id && !shownElsewhere.has(e.title))
        .map((e) => ({
          id: e.id,
          kind: 'event',
          at: e.at,
          actor: e.actor,
          title: e.title,
          body: e.body ?? '',
          meta: e.meta ?? null,
          outcome: e.outcome ?? null,
        })),
      ...state.messages
        .filter((m) => m.caseId === row.id)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          at: m.at,
          actor: m.actor ?? (m.direction === 'inbound' ? '' : row.assignee),
          from: m.direction === 'inbound' ? row.contact : '',
          subject: m.subject ?? '',
          body: m.body ?? '',
          direction: m.direction ?? 'outbound',
          state: m.state,
          attachment: m.attachment ?? '',
          channel: m.channel ?? '',
        })),
      ...activities
        .filter((a) => a.state !== 'open' && a.completedAt)
        .map((a) => ({
          id: `done-${a.id}`,
          kind: 'activity',
          at: a.completedAt,
          actor: a.owner,
          title: a.title,
          type: a.type,
          state: a.state,
          body: a.outcome,
        })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const quotes = state.quotes
      .filter((q) => q.caseId === row.id)
      .map((q) => {
        const lines = q.lines.map((line) => lineDetail(state, line))
        return {
          id: q.id,
          state: q.state,
          version: q.version,
          // A real quotation's order revision, which its commands send back; the demo's has none.
          ...(q.revision == null ? {} : { revision: q.revision }),
          expires: q.expires,
          sentAt: q.sentAt ?? null,
          // The last sending, whichever screen made it: its channel (`hand` when handed over), address and time.
          lastSend: q.lastSend ?? null,
          orderId: q.orderId ?? '',
          lines,
          subtotal: sum(lines, (l) => l.net),
          taxAmount: sum(lines, (l) => l.taxAmount),
          total: q.total,
        }
      })
    const visible = visibleRecords(state, actor)
    return {
      record: { ...project(state, row), stageName: stage?.name ?? row.stageId },
      partner: partner
        ? {
            id: partner.id,
            name: partner.name,
            kind: partner.kind,
            contactName: partner.contactName,
            phone: partner.phone,
            email: partner.email,
            consent: !!partner.consent,
          }
        : null,
      path: path.map((s) => ({
        id: s.id,
        name: s.name,
        sequence: s.sequence,
        probability: s.probability ?? null,
      })),
      activities,
      feed,
      quotes,
      orders: state.orders.filter((o) => o.caseId === row.id).map((o) => ({ ...o })),
      // How quotations written in Sales meet this record, and the customer's ones it may attach.
      quotePolicy: state.config.quotationPolicy?.saleQuotations ?? 'off',
      attachable:
        row.kind === 'opportunity' && state.config.quotationPolicy?.saleQuotations === 'attach'
          ? (state.saleQuotes ?? [])
              .filter((q) => q.partnerId === row.partnerId && !q.caseId)
              .map((q) => ({
                id: q.id,
                orderRef: q.orderRef ?? q.id,
                state: q.state,
                total: q.total,
                expires: q.expires ?? '',
                date: q.date ?? null,
              }))
          : [],
      related: visible
        .filter((r) => r.partnerId === row.partnerId && r.id !== row.id)
        .map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          terminal: r.terminal,
          stageId: r.stageId,
          revenue: r.revenue,
          closedAt: r.closedAt ?? null,
        })),
      duplicates: duplicateCandidates(state, row)
        .filter((r) => canRead(actor, r))
        .map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          terminal: r.terminal,
          partnerId: r.partnerId,
          partner: r.partner,
          version: r.version,
          description: r.description ?? '',
          teamId: r.teamId,
          assignee: r.assignee,
          contact: r.contact,
          phone: r.phone,
          email: r.email,
        })),
      score: scoreExplanation(state, row),
      assignment: assignmentPreview(state, row),
      editable: canWrite(actor, row) && row.terminal === 'open',
      writable: canWrite(actor, row),
    }
  }

  const planner = (state, actor, params) => {
    const visible = visibleRecords(state, actor),
      ownerParam = params.get('owner') ?? '',
      owner = ownerParam === 'me' ? actor.id : people.some((p) => p.id === ownerParam) ? ownerParam : '',
      type = ['call', 'email', 'meeting', 'task'].includes(params.get('type')) ? params.get('type') : ''
    const rows = state.activities
      .filter(
        (a) =>
          visible.some((r) => r.id === a.caseId) &&
          (!owner || a.owner === owner) &&
          (!type || a.type === type),
      )
      .map((a) => {
        const record = visible.find((r) => r.id === a.caseId)
        return {
          id: a.id,
          title: a.title,
          type: a.type,
          owner: a.owner,
          dueAt: a.dueAt,
          state: a.state,
          completedAt: a.completedAt ?? null,
          outcome: a.outcome ?? '',
          record: {
            id: record.id,
            name: record.name,
            partner: record.partner,
            kind: record.kind,
            stageId: record.stageId,
            revenue: record.revenue,
            terminal: record.terminal,
            version: record.version,
            writable: canWrite(actor, record),
          },
        }
      })
    const start = new Date(`${today}T00:00:00Z`),
      monday = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY)
    const week = Array.from({ length: 7 }, (_, i) =>
      new Date(monday.getTime() + i * DAY).toISOString().slice(0, 10),
    )
    return {
      filters: { owner: ownerParam === 'me' ? 'me' : owner, type },
      open: rows.filter((a) => a.state === 'open').sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      doneToday: rows.filter((a) => a.state === 'done' && a.completedAt?.startsWith(today)).length,
      week,
      owners: [...new Set(rows.filter((a) => a.state === 'open').map((a) => a.owner))],
    }
  }

  const settings = (state, actor) => {
    const records = visibleRecords(state, actor)
    return {
      groups: {
        teams: state.config.teams.map((team) => ({
          id: team.id,
          name: team.name,
          code: team.code,
          leaderUserId: team.leaderUserId,
          assignmentMode: team.assignmentMode,
          active: team.active,
          version: team.version ?? 1,
          members: team.members.filter((m) => m.active).length,
          open: records.filter((r) => r.teamId === team.id && r.terminal === 'open').length,
        })),
        assignmentRules: state.config.assignmentRules.map((rule) => ({
          ...rule,
          version: rule.version ?? 1,
        })),
        stages: [...state.config.stages]
          .sort((a, b) => a.sequence - b.sequence)
          .map((stage) => ({
            ...stage,
            version: stage.version ?? 1,
            open: records.filter(
              (r) => r.stageId === stage.id && (stage.terminalState !== 'open' || r.terminal === 'open'),
            ).length,
          })),
        lostReasons: [...state.config.lostReasons]
          .sort((a, b) => a.sequence - b.sequence)
          .map((reason) => ({
            ...reason,
            version: reason.version ?? 1,
            used: records.filter((r) => r.lostReason === reason.name).length,
          })),
        tags: state.config.tags.map((tag) => ({
          ...tag,
          version: tag.version ?? 1,
          used: records.filter((r) => (r.tags ?? []).includes(tag.id)).length,
        })),
        scoreRules: [...state.config.scoreRules]
          .sort((a, b) => a.sequence - b.sequence)
          .map((rule) => ({ ...rule, version: rule.version ?? 1 })),
      },
      quotationPolicy: {
        saleQuotations: state.config.quotationPolicy?.saleQuotations ?? 'off',
        version: state.config.quotationPolicy?.version ?? 0,
      },
      simulation: records
        .filter((r) => r.terminal === 'open')
        .slice(0, 8)
        .map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          source: r.source,
          assignee: r.assignee,
          preview: assignmentPreview(state, r),
          points: scoreExplanation(state, r),
          score: r.score,
        })),
    }
  }

  const teamPage = (state, actor, params) => {
    const team = state.config.teams.find((x) => x.id === (params.get('team') || defaults.team))
    if (!team) return { team: null }
    const records = visibleRecords(state, actor),
      month = [`${thisMonth}-01`, monthEnd(thisMonth)]
    const members = team.members.map((m) => {
      const open = records.filter((r) => r.assignee === m.userId && r.terminal === 'open'),
        mine = state.activities.filter(
          (a) => a.owner === m.userId && a.state === 'open' && open.some((r) => r.id === a.caseId),
        )
      return {
        ...m,
        version: m.version ?? 1,
        open: open.length,
        inTeam: open.filter((r) => r.teamId === team.id).length,
        gross: sum(
          open.filter((r) => r.kind === 'opportunity'),
          (r) => r.revenue,
        ),
        weighted: sum(open, (r) => (r.kind === 'opportunity' ? (r.revenue * r.probability) / 100 : 0)),
        planned: mine.length,
        overdue: mine.filter((a) => pastDue(a.dueAt)).length,
        won: sum(
          records.filter((r) => r.assignee === m.userId && r.terminal === 'won' && within(r.closedAt, month)),
          (r) => r.revenue,
        ),
      }
    })
    const open = records.filter((r) => r.teamId === team.id && r.terminal === 'open')
    return {
      team: {
        id: team.id,
        name: team.name,
        code: team.code,
        leaderUserId: team.leaderUserId,
        assignmentMode: team.assignmentMode,
        active: team.active,
        version: team.version ?? 1,
        members,
        open: open.length,
        unassigned: open.filter((r) => !r.assignee).length,
        gross: sum(
          open.filter((r) => r.kind === 'opportunity'),
          (r) => r.revenue,
        ),
        won: sum(
          records.filter((r) => r.teamId === team.id && r.terminal === 'won' && within(r.closedAt, month)),
          (r) => r.revenue,
        ),
      },
      rules: state.config.assignmentRules
        .filter((rule) => rule.teamId === team.id)
        .map((rule) => ({ id: rule.id, name: rule.name, active: rule.active, priority: rule.priority })),
    }
  }

  const leadNew = (state, actor, params) => {
    const records = visibleRecords(state, actor)
    const partners = visiblePartners(state, actor)
    // "Create a lead" on a customer's page names the customer and the kind; the form starts from them.
    const asked = partners.find((p) => p.id === params.get('partnerId'))
    return {
      sources,
      prefill: {
        kind: params.get('kind') === 'opportunity' ? 'opportunity' : 'lead',
        ...(asked
          ? {
              partnerId: asked.id,
              contactName: asked.contactName || (asked.kind === 'person' ? asked.name : ''),
              phone: asked.phone ?? '',
              email: asked.email ?? '',
            }
          : // A call from a number no customer has yet: the softphone hands the number over.
            params.get('phone')
            ? { phone: phoneDigits(params.get('phone')) }
            : {}),
      },
      contacts: partners.map((p) => ({
        id: p.id,
        name: p.name,
        contactName: p.contactName ?? '',
        phone: p.phone ?? '',
        email: p.email ?? '',
        open: records
          .filter((r) => r.partnerId === p.id && r.terminal === 'open')
          .map((r) => ({ id: r.id, name: r.name })),
      })),
    }
  }

  const standaloneDialog = (state, actor, params) => {
    const name = params.get('dialog')
    if (name === 'import') {
      const preview = state.importPreviews?.[params.get('preview')]
      return preview
        ? {
            preview: {
              id: params.get('preview'),
              headers: preview.headers,
              diagnostics: preview.diagnostics,
              valid: preview.valid,
              input: preview.input,
            },
          }
        : {}
    }
    if (name === 'bulk') {
      const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, 100)
      return {
        selection: ids
          .map((id) => state.records.find((r) => r.id === id && !r.archived && canRead(actor, r)))
          .filter(Boolean)
          .map((r) => ({
            id: r.id,
            name: r.name,
            terminal: r.terminal,
            teamId: r.teamId,
            assignee: r.assignee,
          })),
      }
    }
    return {}
  }

  /** The whole view model of one screen, scoped to the actor. */
  const readSalesScreen = (state, params, actor) => {
    if (!canRead(actor)) throw new SalesError('E_FORBIDDEN', 'Không có quyền xem CRM.', {}, 403)
    const screen = params.get('screen') || 'overview'
    const lang = params.get('lang') === 'en' ? 'en' : 'vi'
    const sampleInvalid =
      demo && screen === 'lead-new' && params.get('state') === 'invalid'
        ? {
            input: {
              command: 'create',
              requestId: 'sample-invalid',
              name: lang === 'en' ? 'Draft sales need' : 'Nhu cầu đang nhập',
              email: 'invalid@example',
            },
            message:
              lang === 'en'
                ? 'Invalid email. The sample draft is retained for correction.'
                : 'Email không hợp lệ. Dữ liệu mẫu lỗi được giữ để sửa.',
            code: 'E_VALIDATION',
            fields: { email: lang === 'en' ? 'Enter a valid email.' : 'Nhập email hợp lệ.' },
          }
        : null
    const base = {
      screen,
      clock,
      revision: state.revision,
      actor: { id: actor.id, role: actor.role, name: personName(actor.id) },
      can: { write: canWrite(actor), admin: actor.role === 'manager' },
      people: people.map((p) => ({ id: p.id, name: p.name })),
      teams: state.config.teams.map((team) => ({
        id: team.id,
        name: team.name,
        active: team.active,
        assignmentMode: team.assignmentMode,
        members: team.members.filter((m) => m.active).map((m) => m.userId),
      })),
      stages: [...state.config.stages]
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
          sequence: s.sequence,
          allowedKinds: s.allowedKinds,
          teamId: s.teamId,
          terminalState: s.terminalState,
          fold: s.fold,
          active: s.active,
          probability: s.probability ?? null,
          staleDays: s.staleDays ?? 0,
        })),
      lostReasons: state.config.lostReasons
        .filter((r) => r.active)
        .map((r) => ({ id: r.id, name: r.name, requiresNote: !!r.requiresNote })),
      tags: state.config.tags.filter((tag) => tag.active).map((tag) => ({ id: tag.id, name: tag.name })),
      plans: state.plans.map((p) => ({ id: p.id, name: p.name, tasks: p.tasks.length })),
      products: state.products ?? [],
      sources,
      intakeSources,
      notice: params.get('notice') ? { message: state.lastNotice ?? '', bulk: state.lastBulk ?? [] } : null,
      response: state.responses?.[params.get('error')] ?? sampleInvalid,
      dialog: params.get('dialog')
        ? { name: params.get('dialog'), ...standaloneDialog(state, actor, params) }
        : null,
    }
    // A record's dialog may open over the board or the planner; it reads the same bundle as the record page.
    const detail = () => {
      try {
        return recordBundle(state, actor, params)
      } catch (error) {
        if (error instanceof SalesError && error.code === 'E_NOT_FOUND') return null
        throw error
      }
    }
    const over = params.get('id') && params.get('dialog') ? { detail: detail() } : {}
    if (screen === 'overview') return { ...base, insights: insights(state, actor, params) }
    if (screen === 'pipeline') return { ...base, ...over, pipeline: pipeline(state, actor, params) }
    if (screen === 'lead-detail') return { ...base, detail: detail() }
    if (screen === 'activity-planner') return { ...base, ...over, planner: planner(state, actor, params) }
    if (screen === 'crm-settings') return { ...base, settings: settings(state, actor) }
    if (screen === 'crm-team')
      return {
        ...base,
        ...teamPage(state, actor, params),
        // The team page edits the team and its rules in the same dialog as the configuration screen.
        ...(params.get('dialog') === 'config' ? { settings: settings(state, actor) } : {}),
      }
    if (screen === 'lead-new') return { ...base, form: leadNew(state, actor, params) }
    return base
  }

  return {
    views,
    salesViews,
    salesInsight,
    visibleRecords,
    visiblePartners,
    getCase,
    scoreExplanation,
    assignmentPreview,
    duplicateCandidates,
    searchSales,
    salesRows,
    readSalesScreen,
    // Wording that only the server needs (export file names stay technical on purpose).
    salesReadFormat: (lang) => ({ fmt: createSalesFormat(lang, clock), words: salesWords(lang) }),
  }
}
