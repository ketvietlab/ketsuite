import { auditActorNames } from './audit-actors.ts'
import { desc, defineFn, eq, from } from '@ketvietlab/ketjs'
import { hasPropertyScope, readRecord } from './command.ts'
export const noticeRecordFunctions = {
  getStayNoticeRecord: defineFn({
    input: { id: 'id' },
    output: { record: 'json?' },
    effects: [
      'read:hospitality_core.StayNotice',
      'read:hospitality_core.Property',
      'read:hospitality_core.Stay',
      'read:hospitality_core.OperationalChange',
      'read:user.User',
    ],
    handler: async (ctx, args) => {
      const notice = await readRecord(ctx, 'hospitality_core.StayNotice', args.id)
      const property = notice ? await readRecord(ctx, 'hospitality_core.Property', notice.propertyId) : null
      if (!notice || !property || !hasPropertyScope(ctx, property)) return { record: null }
      const stay = await readRecord(ctx, 'hospitality_core.Stay', notice.stayId)
      const H = ctx.table('hospitality_core.OperationalChange')
      const history = await ctx.db.all(
        from(H)
          .where(eq(H.companyId!, ctx.scope.company), eq(H.entityId!, notice.id))
          .orderBy(desc(H.occurredAt!), desc(H.id))
          .limit(50),
      )
      const actors = await auditActorNames(ctx, history)
      const fields = [
        'id',
        'version',
        'propertyId',
        'stayId',
        'state',
        'reason',
        'guestName',
        'dueAt',
        'documentType',
        'documentLast4',
        'issueCodes',
        'createdAt',
        'preparedAt',
        'submittedAt',
        'submittedBy',
        'receiptRef',
        'confirmedAt',
        'confirmedBy',
        'submissionNote',
      ]
      return {
        record: {
          ...Object.fromEntries(fields.map((key) => [key, notice[key] ?? null])),
          timezone: property.timezone,
          name: notice.guestName,
          stayCode: stay?.code ?? notice.stayId,
          channel: notice.submissionChannel ?? 'online',
          evidenceRef: notice.receiptRef ?? '',
          history: history.map((row) => ({
            action: row.action,
            actorId: row.actorId,
            actorName: actors.get(row.actorId) ?? null,
            occurredAt: row.occurredAt,
          })),
        },
      }
    },
  }),
}
