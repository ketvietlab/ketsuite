import type { Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { sumAmounts } from '../landed-costs/shared.ts'

type Req = Parameters<ServeContext['allows']>[2]

/**
 * K64 on a receipt's page: the way to a new landed cost on it, for who may draft one while it can take one,
 * and the costs on it, cancelled ones aside, with what each posted one added to this receipt. Only a reader
 * of stock value sees the costs.
 */
export async function receiptLandedCosts(ctx: ServeContext, url: URL, req: Req, pickingId: string) {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const query = [...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key))
  const [drafts, reads] = await Promise.all([
    ctx.allows('stock.saveLandedCost', url, req),
    ctx.allows('stock.listLandedCosts', url, req),
  ])
  const landable =
    drafts &&
    (await optionalRead<Row[]>(ctx, 'stock.listLandableReceipts', { pickingId }, url, req, [])).length > 0
  const costs = reads
    ? (await optionalRead<Row[]>(ctx, 'stock.listLandedCosts', {}, url, req, [])).filter(
        (cost) =>
          cost.state !== 'cancel' &&
          ((cost.pickingIds as unknown[] | null) ?? []).map(String).includes(pickingId),
      )
    : []
  const listed = await Promise.all(
    costs.map(async (cost) => {
      const posted =
        cost.state === 'posted'
          ? await optionalRead<Row | null>(ctx, 'stock.getLandedCost', { id: cost.id }, url, req, null)
          : null
      const added = posted
        ? sumAmounts(
            ((posted.allocations as Row[] | undefined) ?? [])
              .filter((row) => row.pickingId === pickingId)
              .map((row) => row.amount),
          )
        : null
      return {
        id: String(cost.id),
        name: String(cost.name),
        stateText: _(`stock_backend.landedCost.state.${String(cost.state)}`),
        amountText: added == null ? null : `+${formatMoney(_, added, cost.currency)}`,
        href: `/admin/stock/landed-costs/${encodeURIComponent(String(cost.id))}${query.length ? `?${new URLSearchParams(query)}` : ''}`,
      }
    }),
  )
  return {
    addHref: landable
      ? `/admin/stock/landed-costs/new?${new URLSearchParams([...query, ['picking', pickingId]])}`
      : null,
    costs: listed,
  }
}
