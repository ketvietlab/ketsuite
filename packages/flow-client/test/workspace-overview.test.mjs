import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString, signal } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import {
  workspaceOverviewModel,
  createWorkspaceOverview,
  HORIZON_DAYS,
} from '@ketvietlab/flow-client/workspace-overview.mjs'
import { statusKind } from '@ketvietlab/flow-client/project-catalogs.mjs'
import { addDays } from '@ketvietlab/flow-client/timeline.mjs'
setFlowLocale('en')
const TODAY = '2026-09-23'
const load = (profile = 'compact') =>
  createOrganizationSession('baseline', 'workspace-overview', { profile }).call('flow.workspace.bootstrap', {
    companyId: 'demo',
    route: 'workspace-overview',
  }).value
// The whole history, before the overview read keeps only the latest entries of each Workspace.
const fullHistory = (profile) =>
  createOrganizationSession('baseline', 'workspace-overview', { profile }).sessions.get('demo').data.history
// Every click handler whose opening tag carries `marker`, in document order.
const handlers = (node, marker, event, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const x of node) handlers(x, marker, event, out)
    return out
  }
  if (node.items && node.render)
    return handlers(
      node.items.map((x, i) => node.render(x, i)),
      marker,
      event,
      out,
    )
  if (!node.strings) return out
  let open = ''
  for (let i = 0; i < node.values.length; i++) {
    open = node.strings[i].includes('<')
      ? node.strings[i].slice(node.strings[i].lastIndexOf('<'))
      : open + node.strings[i]
    if (
      open.includes(marker) &&
      node.strings[i].endsWith(`on:${event}=`) &&
      typeof node.values[i] === 'function'
    )
      out.push(node.values[i])
    else handlers(node.values[i], marker, event, out)
  }
  return out
}
const setup = (profile) => {
  const data = load(profile),
    nav = []
  const ctx = {
    data: signal(data),
    navigate: (key, params) => nav.push([key, params ?? {}]),
    canWrite: () => true,
    busy: () => false,
  }
  const overview = createWorkspaceOverview(ctx),
    ws = data.workspaces.find((w) => w.id === 'product')
  return {
    ctx,
    data,
    nav,
    overview,
    render: () => overview.view({ workspace: ws, empty: null, canCreate: true, today: TODAY }),
  }
}

for (const profile of ['compact', 'realistic'])
  test(`overview numbers reconcile with the tasks they summarise (${profile})`, () => {
    const data = load(profile),
      m = workspaceOverviewModel(data, 'product', TODAY)
    const inWs = new Set(data.projects.filter((p) => p.workspaceId === 'product').map((p) => p.id))
    const tasks = data.tasks.filter((t) => !t.archived && inWs.has(t.projectId)),
      open = tasks.filter((t) => statusKind(data, t) !== 'done')
    assert.equal(m.tasks.length, tasks.length)
    assert.equal(
      Object.values(m.counts).reduce((a, b) => a + b, 0),
      tasks.length,
      'status mix covers every task once',
    )
    assert.equal(
      m.rows.reduce((n, r) => n + r.total, 0),
      tasks.length,
      'project rows add up to the workspace',
    )
    assert.equal(
      m.rows.reduce((n, r) => n + r.overdue, 0),
      m.overdue.length,
    )
    assert.deepEqual(
      m.overdue.map((t) => t.id).sort(),
      open
        .filter((t) => t.dueDate && t.dueDate < TODAY)
        .map((t) => t.id)
        .sort(),
    )
    assert.deepEqual(
      m.overdue.map((t) => t.dueDate),
      [...m.overdue.map((t) => t.dueDate)].sort(),
      'oldest overdue first',
    )
    assert.equal(m.horizon.length, HORIZON_DAYS + 1)
    assert.equal(m.horizon[0].tasks, m.overdue)
    const end = addDays(TODAY, HORIZON_DAYS)
    assert.equal(
      m.horizon.slice(1).reduce((n, x) => n + x.tasks.length, 0),
      open.filter((t) => t.dueDate >= TODAY && t.dueDate < end).length,
      'each upcoming task lands in exactly one day',
    )
    assert.ok(m.goals.every((g) => g.workspaceId === 'product'))
    for (const p of m.people) assert.ok(p.open >= p.overdue && p.open > 0)
    for (const kind of ['todo', 'progress', 'review', 'done'])
      assert.equal(m.counts[kind], tasks.filter((t) => statusKind(data, t) === kind).length, kind)
    const ids = new Set(tasks.map((t) => t.id)),
      latest = (history) =>
        history
          .filter((h) => ids.has(h.taskId))
          .sort((a, b) => b.time.localeCompare(a.time))
          .slice(0, 6)
    // The overview read already carries each Workspace's latest entries; the model must pick the
    // same six from the whole history too.
    const whole = { ...data, history: fullHistory(profile) }
    if (profile === 'realistic') assert.equal(m.activity.length, 6)
    assert.deepEqual(m.activity, latest(whole.history), 'the six latest entries, newest first')
    assert.deepEqual(workspaceOverviewModel(whole, 'product', TODAY).activity, m.activity)
    const reversed = { ...data, history: [...whole.history].reverse() }
    assert.deepEqual(
      workspaceOverviewModel(reversed, 'product', TODAY).activity.map((h) => h.time),
      latest(reversed.history).map((h) => h.time),
      'whatever order the history arrives in',
    )
  })

test('blocked counts only tasks whose blocker is still unfinished', () => {
  const data = load('realistic'),
    m = workspaceOverviewModel(data, 'product', TODAY)
  const target = m.blocked[0]
  assert.ok(target, 'fixture has a blocked task')
  const done = data.columns.find((c) => c.kind === 'done').id
  const cleared = {
    ...data,
    tasks: data.tasks.map((t) => (target.blockedBy.includes(t.id) ? { ...t, status: done } : t)),
  }
  assert.ok(!workspaceOverviewModel(cleared, 'product', TODAY).blocked.some((t) => t.id === target.id))
})

test('native blocked summaries remain blocked when their dependency is outside the loaded window', () => {
  const data = load()
  const target = data.tasks.find((t) => t.projectId === data.projects[0].id)
  const bounded = {
    ...data,
    tasks: [{ ...target, archived: false, blocked: true, blockerCount: 12, blockedBy: ['outside-window'] }],
  }
  assert.deepEqual(
    workspaceOverviewModel(bounded, 'product', TODAY).blocked.map((t) => t.id),
    [target.id],
  )
  assert.equal(
    workspaceOverviewModel({ ...bounded, tasks: [{ ...bounded.tasks[0], blocked: false }] }, 'product', TODAY)
      .blocked.length,
    0,
  )
})

test('overview progress, overdue and review totals use the full authorized scope before paging', () => {
  const data = load()
  const m = workspaceOverviewModel(
    {
      ...data,
      tasks: data.tasks.slice(0, 2),
      counts: {
        projects: 500,
        metrics: { total: 1000000, progress: 300000, review: 200000, done: 400000, overdue: 80000 },
      },
    },
    'product',
    TODAY,
  )
  assert.equal(m.tasks.length, 2)
  assert.equal(m.total, 1000000)
  assert.equal(m.projectTotal, 500)
  assert.equal(m.openTotal, 600000)
  assert.equal(m.overdueTotal, 80000)
  assert.equal(m.reviewTotal, 200000)
  assert.deepEqual(m.counts, { todo: 100000, progress: 300000, review: 200000, done: 400000 })
  const ownProject = data.projects.find((p) => p.workspaceId === 'product')
  const perProject = workspaceOverviewModel(
    {
      ...data,
      tasks: [],
      projectMetrics: {
        [ownProject.id]: {
          total: 80000,
          todo: 10000,
          progress: 20000,
          review: 10000,
          done: 40000,
          overdue: 1000,
        },
      },
    },
    'product',
    TODAY,
  ).rows.find((r) => r.project.id === ownProject.id)
  assert.equal(perProject.total, 80000)
  assert.equal(perProject.counts.done, 40000)
  assert.equal(perProject.overdue, 1000)
})

test('overview page leads with clickable totals and a deadline chart whose days open their tasks', () => {
  const { nav, render } = setup('realistic'),
    m = workspaceOverviewModel(load('realistic'), 'product', TODAY)
  let html = renderToStaticString(render())
  assert.equal((html.match(/data-flow="stat"/g) ?? []).length, 4)
  assert.doesNotMatch(
    html.slice(html.indexOf('stat-grid'), html.indexOf('column-chart')),
    /aria-pressed/,
    'tiles navigate, they are not toggles',
  )
  assert.equal((html.match(/data-flow="column" /g) ?? []).length, HORIZON_DAYS + 1)
  // The overdue backlog stays off the shared scale, so it is drawn clipped exactly when it
  // outgrows the busiest upcoming day instead of flattening them.
  const late = m.horizon[0].tasks.length,
    peak = Math.max(...m.horizon.slice(1).map((x) => x.tasks.length))
  assert.ok(late > 0 && peak > 0)
  assert.equal(
    /data-clipped="true"/.test(html),
    late > peak,
    'overdue backlog does not flatten the upcoming days',
  )
  assert.match(html, /<th scope="col" data-size="wide">Overdue tasks<\/th>/)
  assert.match(html, /aria-current="date"/)
  const day = m.horizon.findIndex((x, i) => i > 0 && x.tasks.length)
  handlers(render(), 'data-flow="column"', 'click')[day]()
  html = renderToStaticString(render())
  assert.match(
    html,
    new RegExp(
      `Due ${new Date(m.horizon[day].date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</th>`,
    ),
  )
  for (const t of m.horizon[day].tasks.slice(0, 8)) assert.match(html, new RegExp(t.id))
  handlers(render(), 'data-flow="stat"', 'click')[1]()
  assert.deepEqual(nav.at(-1), ['dashboard', { risk: 'overdue' }])
})

test('the overview totals follow new data after a first render', () => {
  const { ctx, data, render } = setup(),
    progress = (html) => html.match(/data-flow="stat"[\s\S]*?(\d+ \/ \d+)/)?.[1]
  const before = workspaceOverviewModel(data, 'product', TODAY)
  assert.equal(progress(renderToStaticString(render())), `${before.counts.done} / ${before.tasks.length}`)
  const gone = before.tasks[0].id,
    next = { ...data, tasks: data.tasks.filter((t) => t.id !== gone) },
    after = workspaceOverviewModel(next, 'product', TODAY)
  ctx.data.set(next)
  assert.equal(progress(renderToStaticString(render())), `${after.counts.done} / ${after.tasks.length}`)
  assert.equal(after.tasks.length, before.tasks.length - 1)
})

test('each project row shows its status mix, risk and running sprint in one line', () => {
  const { render } = setup(),
    html = renderToStaticString(render())
  const table = html.slice(html.indexOf('aria-label="Projects"'))
  assert.match(
    table,
    /data-flow="segment-track" role="img" aria-label="KetSuite Core: Done \d+ · Confirming \d+ · In progress \d+ · To do \d+"/,
  )
  assert.match(table, /\d+% <\/span>|\d+%<\/span>/)
  assert.match(table, /Actions for KetSuite Core/)
  assert.doesNotMatch(table, /data-flow="evidence-value" data-tone/)
})

test('status names follow the current language and the project catalogue, even after a language switch', (t) => {
  const { render } = setup('realistic')
  t.after(() => setFlowLocale('en'))
  setFlowLocale('vi')
  const html = renderToStaticString(render()),
    table = html.slice(html.indexOf('data-flow="evidence-table"'))
  assert.match(table, /data-flow="tag" data-tone="neutral">(Chờ nhận|Đang thực hiện)</)
  assert.doesNotMatch(table, />(To do|In progress|Awaiting acceptance)</)
})

test('deadline counts remain exact with an empty task preview and keep fourteen business dates', () => {
  const data = load(),
    days = Object.fromEntries(
      Array.from({ length: HORIZON_DAYS }, (_, i) => [
        new Date(Date.parse(TODAY + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10),
        i + 1,
      ]),
    )
  const model = workspaceOverviewModel(
    { ...data, tasks: [], deadlineCounts: { today: TODAY, overdue: 1234, dueSoon: 28, days } },
    'product',
    TODAY,
  )
  assert.equal(model.dueSoonTotal, 28)
  assert.equal(model.horizon[0].total, 1234)
  assert.equal(model.horizon[0].tasks.length, 0)
  assert.deepEqual(
    model.horizon.slice(1).map((day) => day.total),
    Array.from({ length: 14 }, (_, i) => i + 1),
  )
})

test('active sprint progress uses full-scope totals even when its tasks are outside the preview', () => {
  const data = load(),
    sprint = data.sprints.find(
      (s) =>
        s.state === 'active' &&
        data.projects.some((p) => p.id === s.projectId && p.workspaceId === 'product'),
    )
  assert.ok(sprint)
  const model = workspaceOverviewModel(
    { ...data, tasks: [], sprints: [{ ...sprint, taskTotals: { total: 800, done: 299 } }] },
    'product',
    TODAY,
  )
  assert.equal(model.sprints[0].total, 800)
  assert.equal(model.sprints[0].done, 299)
  assert.equal(model.rows.find((r) => r.project.id === sprint.projectId).sprint.total, 800)
})

test('workload summaries include server-resolved people outside directory and task windows', () => {
  const data = load(),
    people = [{ member: { id: 'outside-directory', name: 'Remote person' }, open: 800, overdue: 200 }]
  const model = workspaceOverviewModel(
    { ...data, tasks: [], members: [], peopleMetrics: people },
    'product',
    TODAY,
  )
  assert.deepEqual(model.people, people)
  assert.deepEqual(workspaceOverviewModel({ ...data, peopleMetrics: [] }, 'product', TODAY).people, [])
})

test('blocked metrics use unique scoped target counts independently of the task preview', () => {
  const data = load(),
    project = data.projects[0]
  const m = workspaceOverviewModel(
    { ...data, tasks: [], blockedCounts: { total: 71, projects: { [project.id]: 71 } } },
    'product',
    TODAY,
  )
  assert.equal(m.blocked.length, 0)
  assert.equal(m.blockedTotal, 71)
  assert.equal(m.rows.find((r) => r.project.id === project.id).blocked, 71)
})
