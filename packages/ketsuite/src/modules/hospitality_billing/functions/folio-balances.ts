import { asc, eq, from, gt, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { addDecimals, canonicalDecimalText, compareDecimals, subtractDecimals } from '../../account/money.ts'

export function folioBalanceEvidence(
  folio: Row,
  bill: Row | null,
  invoice: Row | null,
  line: Row | null,
  paid: string,
) {
  const balanceKnown = !bill || (!!line && invoice?.state === 'posted' && !invoice.reversedById)
  const balance = bill
    ? String(line?.amountResidual ?? '0')
    : subtractDecimals(String(folio.amountTotal), paid)
  return { balanceKnown, due: compareDecimals(balance, '0') > 0 ? canonicalDecimalText(balance) : '0' }
}

/** At most 100 folios; payment evidence is read in bounded keyset batches, without journal/PII enrichment. */
export async function folioBalances(ctx: Ctx, folios: Row[]) {
  if (folios.length > 100) throw new RangeError('folio balance batch exceeds 100')
  if (!folios.length) return new Map<string, { due: string; paid: string; balanceKnown: boolean }>()
  const B = ctx.table('hospitality_billing.FolioBill'),
    L = ctx.table('hospitality_billing.FolioPayment'),
    P = ctx.table('account.Payment'),
    M = ctx.table('account.Move'),
    ML = ctx.table('account.MoveLine')
  const ids = folios.map((folio) => folio.id)
  const bills = await ctx.db.all(
    from(B).where(eq(B.companyId!, ctx.scope.company), inArray(B.folioId, ids)).limit(100),
  )
  const moveIds = bills.map((bill) => bill.moveId)
  const invoices = moveIds.length
    ? await ctx.db.all(from(M).where(eq(M.companyId!, ctx.scope.company), inArray(M.id, moveIds)).limit(100))
    : []
  const lines = moveIds.length
    ? await ctx.db.all(
        from(ML)
          .where(
            eq(ML.companyId!, ctx.scope.company),
            inArray(
              ML.id,
              moveIds.map((id) => `${id}:counterpart`),
            ),
          )
          .limit(100),
      )
    : []
  const byBill = new Map(bills.map((bill) => [bill.folioId, bill])),
    byInvoice = new Map(invoices.map((invoice) => [invoice.id, invoice])),
    byLine = new Map(lines.map((line) => [line.moveId, line]))
  const paid = new Map<string, string>()
  const links = from(L).where(eq(L.companyId!, ctx.scope.company), inArray(L.folioId, ids))
  let after: unknown = null
  while (true) {
    const query = after ? links.where(gt(L.id, after)) : links
    const batch = await ctx.db.all(query.orderBy(asc(L.id)).limit(100))
    if (!batch.length) break
    const payments = await ctx.db.all(
      from(P)
        .where(
          eq(P.companyId!, ctx.scope.company),
          inArray(
            P.id,
            batch.map((link) => link.paymentId),
          ),
        )
        .limit(100),
    )
    const paymentMoves = payments.map((payment) => payment.moveId).filter(Boolean)
    const moves = paymentMoves.length
      ? await ctx.db.all(
          from(M).where(eq(M.companyId!, ctx.scope.company), inArray(M.id, paymentMoves)).limit(100),
        )
      : []
    const byPayment = new Map(payments.map((payment) => [payment.id, payment])),
      byMove = new Map(moves.map((move) => [move.id, move]))
    for (const link of batch) {
      const payment = byPayment.get(link.paymentId),
        move = payment ? byMove.get(payment.moveId) : null
      if (
        link.active === false ||
        !payment ||
        !['in_process', 'paid'].includes(String(payment.state)) ||
        move?.state !== 'posted' ||
        move.reversedById
      )
        continue
      const key = String(link.folioId),
        previous = paid.get(key) ?? '0'
      paid.set(
        key,
        link.kind === 'refund'
          ? subtractDecimals(previous, String(link.amount))
          : addDecimals(previous, String(link.amount)),
      )
    }
    if (batch.length < 100) break
    after = batch.at(-1)!.id
  }
  return new Map(
    folios.map((folio) => {
      const bill = byBill.get(folio.id) ?? null,
        invoice = bill ? (byInvoice.get(bill.moveId) ?? null) : null,
        line = bill ? (byLine.get(bill.moveId) ?? null) : null
      return [
        String(folio.id),
        {
          ...folioBalanceEvidence(folio, bill, invoice, line, paid.get(String(folio.id)) ?? '0'),
          paid: paid.get(String(folio.id)) ?? '0',
        },
      ]
    }),
  )
}
