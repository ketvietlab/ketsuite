import type { FnSpec, JobContext, JobSpec } from '@ketvietlab/ketjs'
import { applyCaseScore, gamificationProfile } from './operations.ts'
import { importWriteEffects } from './import-policy.ts'
import { runImportChunk } from './import-execution.ts'

/**
 * The two derived figures the CRM keeps, kept current without anyone asking.
 *
 * Scoring rules and the leaderboard both existed as functions a user had to
 * invoke by hand, so a pipeline that nobody clicked through showed a score of
 * zero and an empty leaderboard. Both are now enqueued by the writes that
 * invalidate them: saving a case rescores it, and closing one restates its
 * owner's standing. Each job is keyed on the record it touches, so a burst of
 * edits collapses into one run.
 */
export const jobs: Record<string, JobSpec> = {
  importChunk: {
    queue: 'default',
    input: { batchId: 'id', cursor: 'int' },
    effects: importWriteEffects.filter((effect) => effect !== 'read:storage.Attachment'),
    idempotent: true,
    handler: (ctx, args) =>
      runImportChunk(ctx, { batchId: String(args.batchId), cursor: Number(args.cursor) }),
  },
  score: {
    queue: 'default',
    input: { caseId: 'id', reason: 'text' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.SalesDetail',
      'read:crm.ScoreRule',
      'read:crm.ScoreHistory',
      'write:crm.ScoreHistory',
      'read:crm.TeamMember',
      'read:user.User',
    ],
    idempotent: true,
    handler: async (ctx: JobContext, args) => {
      // Worker handlers already run on the transaction-bound adapter used for
      // the claim, so the scoring pass is called without a nested transaction.
      await applyCaseScore(ctx, String(args.caseId), String(args.reason))
    },
  },

  gamification: {
    queue: 'default',
    input: { userId: 'id' },
    effects: [
      'read:user.User',
      'read:crm.Case',
      'read:activity.Activity',
      'read:crm.GamificationProfile',
      'write:crm.GamificationProfile',
    ],
    idempotent: true,
    handler: async (ctx: JobContext, args) => {
      const user = (await ctx.db.select('user.User', { id: args.userId, active: true }))[0]
      if (!user) return
      await gamificationProfile(ctx, user)
    },
  },
}

export const jobFunctions: Record<string, FnSpec> = {}
