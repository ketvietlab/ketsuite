import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FIXTURE_ANCHOR,
  fixturePhase,
  fixtureShiftDays,
  rebaseFixtureDates,
} from '../atlas/fixture-clock.mjs'
import { addDays } from '@ketvietlab/flow-client/timeline.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

const weekday = (day) => new Date(day + 'T00:00:00Z').getUTCDay()

test('the fixture clock moves by whole weeks and lands today inside the fixture week', () => {
  assert.equal(fixtureShiftDays(FIXTURE_ANCHOR), 0)
  assert.equal(fixtureShiftDays('2026-09-28'), 0, 'six days later is still the fixture week')
  assert.equal(fixtureShiftDays('2026-09-29'), 7)
  assert.equal(fixtureShiftDays('2026-10-11'), 14)
  assert.equal(fixtureShiftDays('2026-09-15'), -7, 'an earlier day moves the fixture back')
  assert.equal(fixtureShiftDays('not a day'), 0)
  assert.deepEqual(
    ['2026-09-22', '2026-09-28', '2026-10-06', '2026-10-11', '2026-09-15', 'not a day'].map(fixturePhase),
    [0, 6, 0, 5, 0, 0],
  )
})

test('dates, timestamps and periods move; skipped collections and other strings stay', () => {
  const data = {
    tasks: [{ id: 'A-1', title: 'Ship 2026-09-22 notes', dueDate: '2026-09-24', due: '24/09' }],
    events: [{ at: '2026-09-22T08:30:00Z', label: '2026-09-22 · 14:30' }],
    reports: [{ period: '2026-09' }, { period: '2026-12' }],
    goals: [{ start: '2026-07-01', period: '2026-09' }],
    note: '2026-09-22x',
  }
  assert.equal(rebaseFixtureDates(data, '2027-01-06', { skip: ['goals'] }), 105)
  assert.deepEqual(data.fixtureClock, { anchor: FIXTURE_ANCHOR, today: '2027-01-06', days: 105, months: 4 })
  assert.equal(data.tasks[0].dueDate, '2027-01-07')
  assert.equal(data.tasks[0].due, '07/01', 'the board label follows the moved due date')
  assert.equal(data.tasks[0].title, 'Ship 2026-09-22 notes', 'a date inside prose is not a calendar value')
  assert.equal(data.events[0].at, '2027-01-05T08:30:00Z')
  assert.equal(data.events[0].label, '2027-01-05 · 14:30')
  assert.deepEqual(
    data.reports.map((r) => r.period),
    ['2027-01', '2027-04'],
    'periods cross the year boundary',
  )
  assert.deepEqual(data.goals[0], { start: '2026-07-01', period: '2026-09' })
  assert.equal(data.note, '2026-09-22x')
  assert.equal(weekday(data.tasks[0].dueDate), weekday('2026-09-24'), 'weekdays are preserved')
})

test('an invalid or unchanged day leaves the data as authored', () => {
  const data = { tasks: [{ dueDate: '2026-09-24' }] }
  assert.equal(rebaseFixtureDates(data, ''), 0)
  assert.equal(data.fixtureClock, undefined)
  assert.equal(rebaseFixtureDates(data, '2026-09-25'), 0)
  assert.equal(data.tasks[0].dueDate, '2026-09-24')
  assert.deepEqual(data.fixtureClock, { anchor: FIXTURE_ANCHOR, today: '2026-09-25', days: 0, months: 0 })
})

test('a live organization keeps its active sprint around today', () => {
  const today = '2026-10-11'
  const authored = createOrganizationSession('baseline', 'my-work', { profile: 'realistic' }).sessions.get(
    'demo',
  ).data
  const live = createOrganizationSession('baseline', 'my-work', { profile: 'realistic', today }).sessions.get(
    'demo',
  ).data
  const active = live.sprints.filter((s) => s.state === 'active')
  assert.ok(active.length > 0)
  for (const sprint of active) assert.ok(sprint.start <= today && today <= sprint.end, sprint.id)
  assert.deepEqual(
    live.tasks.map((t) => [t.id, t.status]),
    authored.tasks.map((t) => [t.id, t.status]),
    'moving the clock changes no task',
  )
  assert.ok(
    live.tasks.every((t) => !t.dueDate || t.due === `${t.dueDate.slice(8, 10)}/${t.dueDate.slice(5, 7)}`),
  )
  const blank = createOrganizationSession('blank', 'my-work', { today })
  for (const session of blank.sessions.values())
    assert.equal(session.data.fixtureClock, undefined, 'an empty organization has nothing to move')
})

test('open work is late in the same measure whichever weekday the clock lands on', () => {
  const late = []
  for (let n = 0; n < 7; n++) {
    const today = addDays('2026-10-06', n),
      data = createOrganizationSession('baseline', 'my-work', { profile: 'realistic', today }).sessions.get(
        'demo',
      ).data
    const open = data.tasks.filter((t) => /-2\d\d$/.test(t.id) && t.status !== 'done' && t.dueDate)
    const overdue = open.filter((t) => t.dueDate < today)
    assert.ok(
      overdue.length > 0 && overdue.length / open.length < 0.15,
      `${today}: ${overdue.length}/${open.length}`,
    )
    assert.ok(
      open.every((t) => weekday(t.dueDate) % 6 !== 0),
      `${today}: deadlines fall on working days`,
    )
    assert.ok(
      open.some((t) => t.dueDate > today && t.dueDate <= addDays(today, 3)),
      `${today}: work is due in the next days`,
    )
    late.push(overdue.length)
  }
  assert.equal(new Set(late).size, 1, `late counts ${late}`)
})
