import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const PAST = '2000-01-01T00:00:00.000Z'

const bootScheduled = async () => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { worker: true, deployment: 'commerce' })
  await fixture('website.saveDomain', {
    id: 'schedule-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const saved = await fixture('website.saveEntry', {
    id: 'scheduled-post',
    siteId: 'site-a',
    type: 'website.post',
    slug: 'hen-gio',
    path: '/hen-gio',
    title: 'Bài hẹn giờ',
    layout: [],
  })
  const revisionId = saved.revisionId as string
  const schedule = (inHours: number) => {
    const publishAt = new Date(Date.now() + inHours * 3_600_000).toISOString()
    return fixture('website.publishEntry', {
      id: 'scheduled-post',
      expectedRevisionId: revisionId,
      publishAt,
    }).then((value) => ({ status: (value as Row).status, publishAt }))
  }
  const tenant = <T>(
    fn: (adapter: {
      run: (sql: string, params?: unknown[]) => Promise<unknown>
      all: (sql: string, params?: unknown[]) => Promise<Row[]>
    }) => Promise<T>,
  ) => app.fixture.withTenant('', ({ adapter }) => fn(adapter as never))
  // The clock is the one thing a test cannot wait for: the entry's time and the chosen jobs'
  // times move to the past together, as they would have by themselves.
  const arrive = (jobs: string) =>
    tenant(async (adapter) => {
      await adapter.run(`UPDATE website_entry SET "publishAt" = ? WHERE id = 'scheduled-post'`, [PAST])
      await adapter.run(
        `UPDATE ket_job SET scheduled_at = ? WHERE job = 'website.publishScheduled' AND state IN ('scheduled', 'available', 'retryable') AND ${jobs}`,
        [PAST],
      )
    })
  const visible = async () => (await app.client.anonymous().get('/hen-gio')).status
  const entry = () =>
    tenant(
      async (adapter) => (await adapter.all(`SELECT * FROM website_entry WHERE id = 'scheduled-post'`))[0]!,
    )
  return { app, fixture, revisionId, schedule, tenant, arrive, visible, entry }
}

test('Studio schedule: a moved schedule publishes at the new time, not the old one', async (t) => {
  const { app, schedule, tenant, arrive, visible, entry } = await bootScheduled()
  t.after(() => app.close())
  const first = await schedule(1)
  assert.equal(first.status, 'scheduled')
  const moved = await schedule(2)
  assert.equal(moved.status, 'scheduled')
  assert.equal(new Date(String((await entry()).publishAt)).toISOString(), moved.publishAt)

  // A job waits at each time; only the newer one is due.
  const waiting = await tenant((adapter) =>
    adapter.all(
      `SELECT unique_key FROM ket_job WHERE job = 'website.publishScheduled' AND state IN ('scheduled', 'available', 'retryable') ORDER BY scheduled_at`,
    ),
  )
  assert.deepEqual(
    waiting.map((job) => String(job.unique_key).endsWith(':' + moved.publishAt)),
    [false, true],
  )
  await arrive(`unique_key LIKE '%:${moved.publishAt}'`)
  await app.drainJobs()
  assert.equal(await visible(), 200)
  assert.equal((await entry()).status, 'published')

  // The job left at the old time finds nothing to do when it comes.
  await tenant((adapter) =>
    adapter.run(
      `UPDATE ket_job SET scheduled_at = ? WHERE job = 'website.publishScheduled' AND state IN ('scheduled', 'available', 'retryable')`,
      [PAST],
    ),
  )
  await app.drainJobs()
  assert.equal((await entry()).status, 'published')
})

test('Studio schedule: a cancelled schedule stays cancelled when its job runs anyway', async (t) => {
  const { app, fixture, revisionId, schedule, arrive, visible, entry } = await bootScheduled()
  t.after(() => app.close())
  await schedule(1)
  const cancelled = await fixture('website.cancelScheduledEntry', {
    id: 'scheduled-post',
    expectedRevisionId: revisionId,
    expectedScheduledRevisionId: revisionId,
  })
  assert.equal(cancelled.ok, true)
  await arrive('1 = 1')
  await app.drainJobs()
  assert.equal(await visible(), 404)
  assert.deepEqual([(await entry()).status, (await entry()).scheduledRevisionId], ['draft', null])
})

test('Studio schedule: a publication the queue gave up on is published by the overdue sweep', async (t) => {
  const { app, schedule, tenant, arrive, visible, entry } = await bootScheduled()
  t.after(() => app.close())
  await schedule(1)
  await arrive('1 = 1')
  // Every attempt failed, or the worker lost it: the queue no longer holds it.
  await tenant((adapter) =>
    adapter.run(`UPDATE ket_job SET state = 'discarded' WHERE job = 'website.publishScheduled'`),
  )
  await app.drainJobs()
  assert.equal(await visible(), 404)
  assert.equal((await entry()).status, 'scheduled')

  // The sweep's own tick, as the worker's schedule would queue it.
  const sweep = (id: string) =>
    tenant((adapter) =>
      adapter.run(
        `INSERT INTO ket_job (id, job, queue, args, state, priority, max_attempts, scheduled_at, inserted_at, updated_at)
         VALUES (?, 'website.publishOverdue', 'default', '{}', 'available', 0, 3, ?, ?, ?)`,
        [id, PAST, PAST, PAST],
      ),
    )
  await sweep('sweep-1')
  await app.drainJobs()
  assert.equal(await visible(), 200)
  assert.equal((await entry()).status, 'published')

  // Nothing overdue is left, so the next tick queues nothing.
  const before = await tenant((adapter) =>
    adapter.all(`SELECT id FROM ket_job WHERE job = 'website.publishScheduled'`),
  )
  await sweep('sweep-2')
  await app.drainJobs()
  const after = await tenant((adapter) =>
    adapter.all(`SELECT id FROM ket_job WHERE job = 'website.publishScheduled'`),
  )
  assert.equal(after.length, before.length)
})
