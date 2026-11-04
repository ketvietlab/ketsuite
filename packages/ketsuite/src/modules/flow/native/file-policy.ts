import { eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { refuse } from './policy.ts'

/** Technical storage ceiling, independent of commercial plan entitlements. */
export const DEFAULT_FLOW_UPLOAD_QUOTA_BYTES = 1024 * 1024 * 1024

export function flowFilename(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Explicitly remove filename controls and bidi overrides.
  const unsafe = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g
  const name = Array.from((value.normalize('NFKC').split(/[\\/]/).at(-1) ?? '').replace(unsafe, '').trim())
    .slice(0, 255)
    .join('')
  return !name || name === '.' || name === '..' ? 'upload' : name
}

/** Called inside the Company's organization mutation lock. Pending leases and
 * archived files still occupy quota; expiry/purge release their metadata. */
export async function reserveFileQuota(ctx: Ctx, size: number, limit: number) {
  const A = ctx.table('storage.Attachment')
  const groups = await ctx.db.group(
    from(A)
      .where(
        eq(A.companyId, ctx.scope.company),
        eq(A.resField, 'attachment'),
        inArray(A.resModel, ['flow.Task', 'flow.Document', 'flow.ProjectRecord', 'flow.EpicRecord']),
      )
      .groupBy({ col: A.companyId })
      .aggregate({ fn: 'sum', col: A.size, as: 'bytes' }),
  )
  const used = Number(groups[0]?.aggregates.bytes ?? 0)
  if (!Number.isSafeInteger(used) || used < 0 || used > limit - size)
    return refuse('upload_quota', { files: 'quota_exceeded' })
}
