import { asc, defineJob, eq, from, lte } from '@ketvietlab/ketjs'
import type { JobSpec } from '@ketvietlab/ketjs'

/** How many overdue schedules one recovery run hands back to the queue. */
const DUE_PER_RUN = 200

const instant = (value: unknown) =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()

/**
 * The queue key of one scheduled publication. The time is part of it: a queue key only
 * coalesces with a job still waiting, so moving a schedule without it left the job at the old
 * time holding the key, and nothing was queued for the new one.
 */
export const scheduleKey = (id: unknown, revisionId: unknown, publishAt: unknown) =>
  `${String(id)}:${String(revisionId)}:${instant(publishAt)}`

export const jobs: Record<string, JobSpec> = {
  publishScheduled: {
    queue: 'default',
    input: { id: 'id', revisionId: 'id' },
    effects: ['read:website.Entry', 'write:website.Entry'],
    idempotent: true,
    handler: async (ctx, args) => {
      const entry = (await ctx.db.select('website.Entry', { id: args.id }))[0]
      if (
        entry?.status !== 'scheduled' ||
        entry.scheduledRevisionId !== args.revisionId ||
        !entry.scheduledRevisionId
      )
        return
      // Early, or moved later since this job was queued: the job for the new time publishes it.
      if (entry.publishAt && new Date(String(entry.publishAt)) > new Date()) return
      // Cancelling, rescheduling or publishing meanwhile changes one of these, and then this
      // write does nothing: whichever lands first wins, and the other never half-applies.
      await ctx.db.compareAndSet(
        'website.Entry',
        { id: args.id },
        { status: 'scheduled', scheduledRevisionId: args.revisionId },
        {
          status: 'published',
          publishedRevisionId: args.revisionId,
          publishedAppearance: entry.scheduledAppearance ?? null,
          scheduledAppearance: null,
          scheduledRevisionId: null,
          publishAt: null,
          publishedAt: new Date().toISOString(),
        },
      )
    },
  },

  /**
   * A schedule whose time has passed and is still waiting.
   *
   * The queue retries a failing publication a few times and then gives up, and a worker that
   * was down when the time came may have lost it. The entry keeps saying "scheduled" either
   * way, so this hands each overdue one back to the queue. Its key coalesces with a job still
   * waiting or retrying; a job the queue gave up on no longer holds it.
   */
  publishOverdue: defineJob({
    input: {},
    idempotent: true,
    crossCompany: true,
    schedule: { every: '5m' },
    effects: ['read:website.Entry', 'enqueue:website.publishScheduled'],
    handler: async (ctx) => {
      const Entry = ctx.table('website.Entry')
      const due = await ctx.db.all(
        from(Entry)
          .select(Entry.id, Entry.companyId, Entry.scheduledRevisionId, Entry.publishAt)
          .where(eq(Entry.status, 'scheduled'), lte(Entry.publishAt, new Date().toISOString()))
          .orderBy(asc(Entry.publishAt), asc(Entry.id))
          .limit(DUE_PER_RUN),
      )
      for (const entry of due) {
        if (!entry.scheduledRevisionId || entry.companyId == null) continue
        await ctx.jobs.enqueue(
          'website.publishScheduled',
          { id: entry.id, revisionId: entry.scheduledRevisionId },
          {
            company: String(entry.companyId),
            uniqueKey: scheduleKey(entry.id, entry.scheduledRevisionId, entry.publishAt),
          },
        )
      }
    },
  }),
}
