import { asc, defineFn, deleteFrom, desc, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { rescheduleCaseActivity } from '../crm/index.ts'
import { activityEffects } from '../crm/functions/shared.ts'
import {
  retryCaseEmail,
  retryEmailEffects,
  sendCaseEmail,
  sendCaseQuotation,
  sendEmailEffects,
  sendQuotationEffects,
} from './sales/mail.ts'
import { createSalesRead, SalesError } from './sales/read.mjs'
import {
  type LoadedSales,
  loadSalesState,
  SALES_INTAKE_SOURCES,
  SALES_SOURCES,
  salesStateEffects,
  withLinkedPartner,
} from './sales/state.ts'

/** The reads of the sales screens over a loaded state: every row in it is one the user may see. */
export const salesReadOf = ({ clock, people, state }: LoadedSales) =>
  createSalesRead({
    clock,
    people,
    access: {
      canRead: (actor: { role: string }, row?: { archived?: boolean }) =>
        actor.role !== 'none' && row?.archived !== true,
      canWrite: (actor: { role: string }, row?: { writable?: boolean }) =>
        (actor.role === 'manager' || actor.role === 'agent') && (!row || row.writable === true),
    },
    // The standard channels first, then any other source the records carry.
    sources: [
      ...SALES_SOURCES,
      ...[...new Set(state.records.map((row) => String(row.source ?? '')))]
        .filter((source) => source && !SALES_SOURCES.includes(source))
        .sort((a, b) => a.localeCompare(b, 'vi')),
    ],
    intakeSources: SALES_INTAKE_SOURCES,
    assigned: (loaded: { load?: Record<string, number> }, userId: string) => loaded.load?.[userId] ?? 0,
  })

/**
 * The islands other modules fill `crm_backend:record.related` with, each started on a record's page
 * with that record's id.
 */
const relatedIslands = (ctx: Pick<Ctx, 'manifest'>): string[] =>
  ctx.manifest.fills
    .filter((fill) => fill.joint === 'crm_backend:record.related')
    .flatMap((fill) =>
      [...fill.template.matchAll(/\{%\s*island\s+"([^"]+)"\s*%\}/gu)].map((match) => match[1]!),
    )

const listInput = (value: unknown, lang: unknown): Record<string, unknown> => ({
  ...(value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}),
  lang: lang === 'en' ? 'en' : 'vi',
})

export const functions: Record<string, FnSpec> = {
  /**
   * The view model of one sales screen (`screen=…&…`), scoped to the caller. Internal: the sales read
   * route checks the screen's permission first, the same one its page shell needs, then calls this.
   */
  'sales.read': defineFn({
    // `partner`: the customer a "Create a lead" link names, already read by the route as the caller.
    input: { query: 'text', partner: 'json?' },
    output: { model: 'json?', status: 'int?' },
    effects: [...salesStateEffects],
    exposure: 'internal',
    handler: async (ctx, args) => {
      const params = new URLSearchParams(String(args.query ?? ''))
      const loaded = await loadSalesState(ctx, {
        detail: params.get('id') || params.get('case') || null,
        lang: params.get('lang') === 'en' ? 'en' : 'vi',
        preview: params.get('dialog') === 'import' ? params.get('preview') : null,
      })
      try {
        const state = withLinkedPartner(loaded.state, args.partner)
        const model = salesReadOf(loaded).readSalesScreen(state, params, loaded.actor)
        // Only a record's page has a record for other modules to show something about.
        return {
          model:
            model && 'detail' in model && model.detail ? { ...model, related: relatedIslands(ctx) } : model,
        }
      } catch (error) {
        if (error instanceof SalesError)
          return { model: null, status: (error as SalesError & { status: number }).status }
        throw error
      }
    },
  }),
  /** One page of the record list under a view, filters and sort, with the count of every view. Internal. */
  'sales.search': defineFn({
    input: { input: 'json?', lang: 'text?' },
    output: { result: 'json?', status: 'int?' },
    effects: [...salesStateEffects],
    exposure: 'internal',
    handler: async (ctx, args) => {
      const loaded = await loadSalesState(ctx, { lang: args.lang === 'en' ? 'en' : 'vi' })
      try {
        return {
          result: salesReadOf(loaded).salesRows(loaded.state, listInput(args.input, args.lang), loaded.actor),
        }
      } catch (error) {
        if (error instanceof SalesError)
          return { result: null, status: (error as SalesError & { status: number }).status }
        throw error
      }
    },
  }),
  /** Every record the list shows under an address's view and filters, for export. Internal. */
  'sales.export': defineFn({
    input: { query: 'text', lang: 'text?' },
    output: { scope: 'json?', total: 'int?', rows: 'json?', status: 'int?' },
    effects: [...salesStateEffects],
    exposure: 'internal',
    handler: async (ctx, args) => {
      const loaded = await loadSalesState(ctx, { lang: args.lang === 'en' ? 'en' : 'vi' })
      const read = salesReadOf(loaded)
      const input = listInput(Object.fromEntries(new URLSearchParams(String(args.query ?? ''))), args.lang)
      try {
        const first = read.salesRows(loaded.state, { ...input, page: 1, pageSize: 100 }, loaded.actor)
        const rows = [...first.rows]
        for (let page = 2; page <= first.pages; page++)
          rows.push(...read.salesRows(loaded.state, { ...input, page, pageSize: 100 }, loaded.actor).rows)
        const { page: _page, pageSize: _size, ...scope } = first.query
        return { scope, total: first.total, rows }
      } catch (error) {
        if (error instanceof SalesError) return { status: (error as SalesError & { status: number }).status }
        throw error
      }
    },
  }),

  // Rescheduling is how an activity's owner keeps it, the same right as completing or cancelling it: the sales
  // command checks `crm.activity.cancel` first, and this checks the record is the user's to change.
  'sales.rescheduleActivity': defineFn({
    input: { id: 'id', dueDate: 'date', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', activity: 'json?', errors: 'json?' },
    effects: [...activityEffects],
    exposure: 'internal',
    idempotent: true,
    handler: (ctx, args) =>
      rescheduleCaseActivity(ctx, {
        id: String(args.id),
        dueDate: String(args.dueDate),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),
  // An email to the record's contact, behind the command route that checks `crm.case.addMessage` first; the
  // function checks the record is the user's to change and that the customer agreed to be contacted.
  'sales.sendEmail': defineFn({
    input: { id: 'id', caseId: 'id', subject: 'text?', body: 'text', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...sendEmailEffects],
    exposure: 'internal',
    idempotent: true,
    handler: (ctx, args) =>
      sendCaseEmail(ctx, {
        id: String(args.id),
        caseId: String(args.caseId),
        subject: String(args.subject ?? ''),
        body: String(args.body),
      }),
  }),
  // A record's quotation sent to its customer, behind the command route that checks `sale.sendQuotation` first (and
  // `crm.case.addMessage` for an email); the function checks the record is the user's to change, the quotation is
  // the record's and, on a channel, that the contact agreed to be contacted. The sale's own rule decides the rest.
  'sales.sendQuotation': defineFn({
    input: {
      caseId: 'id',
      orderId: 'id',
      channel: 'text?',
      recipient: 'text?',
      subject: 'text?',
      message: 'text?',
      messageId: 'id',
      expectedRevision: 'int',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', sendId: 'text?', errors: 'json?' },
    effects: [...sendQuotationEffects],
    exposure: 'internal',
    idempotent: true,
    handler: (ctx, args) => sendCaseQuotation(ctx, args as never),
  }),
  // An import preview, the caller's own: written by the command route that checks the manager's right first, read
  // back by the import it confirms. A caller keeps sixteen at most, none older than a day.
  'sales.saveImportPreview': defineFn({
    input: { id: 'id', input: 'json', headers: 'json', rows: 'json', diagnostics: 'json', valid: 'bool' },
    output: { ok: 'bool', id: 'id?' },
    effects: ['read:crm_backend.SalesImportPreview', 'write:crm_backend.SalesImportPreview'],
    exposure: 'internal',
    idempotent: true,
    handler: async (ctx, args) => {
      if (!ctx.actor) return { ok: false }
      const P = ctx.table('crm_backend.SalesImportPreview')
      if (!(await ctx.db.select('crm_backend.SalesImportPreview', { id: args.id }))[0])
        await ctx.db.insert('crm_backend.SalesImportPreview', {
          id: args.id,
          actorUserId: ctx.actor,
          input: args.input,
          headers: args.headers,
          rows: args.rows,
          diagnostics: args.diagnostics,
          valid: args.valid === true,
          createdAt: new Date().toISOString(),
        })
      const kept = await ctx.db.all(
        from(P).where(eq(P.actorUserId, ctx.actor)).orderBy(desc(P.createdAt), asc(P.id)),
      )
      const day = Date.now() - 86_400_000
      for (const [index, row] of kept.entries())
        if (index >= 16 || Date.parse(String(row.createdAt)) < day)
          await ctx.db.del(deleteFrom(P).where(eq(P.id, row.id)))
      return { ok: true, id: args.id }
    },
  }),
  // The caller's preview; given a result, the import it confirmed is recorded on it.
  'sales.importPreview': defineFn({
    input: { id: 'id', result: 'json?' },
    output: { preview: 'json?' },
    effects: ['read:crm_backend.SalesImportPreview', 'write:crm_backend.SalesImportPreview'],
    exposure: 'internal',
    handler: async (ctx, args) => {
      const row = (
        await ctx.db.select('crm_backend.SalesImportPreview', { id: args.id, actorUserId: ctx.actor })
      )[0]
      if (row && args.result != null) {
        await ctx.db.update('crm_backend.SalesImportPreview', { id: row.id }, { result: args.result })
        return { preview: { ...row, result: args.result } }
      }
      return { preview: (row as Row | undefined) ?? null }
    },
  }),
  'sales.retryEmail': defineFn({
    input: { caseId: 'id', messageId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...retryEmailEffects],
    exposure: 'internal',
    idempotent: true,
    handler: (ctx, args) =>
      retryCaseEmail(ctx, { caseId: String(args.caseId), messageId: String(args.messageId) }),
  }),
}
