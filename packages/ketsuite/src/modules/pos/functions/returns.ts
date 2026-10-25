import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { toProductUnit } from '../../stock/units.ts'
import {
  appendAudit,
  atomic,
  claimOrderRevision,
  createOrderEffects,
  decimal,
  invalid,
  n,
  nextOrderNumber,
  now,
  recompute,
} from './helpers.ts'
import { createPosOrder } from './orders.ts'

const scaledTaxEvidence = (evidence: unknown, factor: number): Row | null => {
  if (!evidence || typeof evidence !== 'object' || !Array.isArray((evidence as Row).taxes)) return null
  const source = evidence as Row
  return {
    ...source,
    taxes: (source.taxes as Row[]).map((tax) => ({
      ...tax,
      share: decimal(n(tax.share) * factor),
    })),
  }
}

const returnTaxEvidence = (
  evidence: unknown,
  previousLines: Row[],
  ratio: number,
  exhaustsLine: boolean,
): Row | null => {
  if (!exhaustsLine) return scaledTaxEvidence(evidence, ratio * -1)
  if (!evidence || typeof evidence !== 'object' || !Array.isArray((evidence as Row).taxes)) return null
  const source = evidence as Row
  const previousTaxes = previousLines.flatMap((line) => {
    const held = line.taxEvidence
    return held && typeof held === 'object' && Array.isArray((held as Row).taxes)
      ? ((held as Row).taxes as Row[])
      : []
  })
  return {
    ...source,
    taxes: (source.taxes as Row[]).map((tax) => ({
      ...tax,
      share: decimal(
        -(
          n(tax.share) +
          previousTaxes
            .filter((previous) => String(previous.taxId ?? '') === String(tax.taxId ?? ''))
            .reduce((sum, previous) => sum + n(previous.share), 0)
        ),
      ),
    })),
  }
}

const taxGroupKey = (line: Row): string =>
  JSON.stringify(
    (Array.isArray(line.taxIds) ? line.taxIds : line.taxId ? [line.taxId] : []).map(String).sort(),
  )

type ReturnableLine = {
  line: Row
  purchasedQuantity: number
  refundedQuantity: number
  remainingQuantity: number
}

async function returnableLines(ctx: Ctx, original: Row): Promise<ReturnableLine[]> {
  const originalLines = await ctx.db.select('pos.OrderLine', { orderId: original.id })
  const refunds = (await ctx.db.select('pos.Order', { refundedOrderId: original.id })).filter(
    (order) => order.state !== 'cancel',
  )
  const returned = new Map<string, number>()
  for (const refund of refunds)
    for (const line of await ctx.db.select('pos.OrderLine', { orderId: refund.id })) {
      if (!line.refundedOrderlineId) continue
      const key = String(line.refundedOrderlineId)
      returned.set(key, (returned.get(key) ?? 0) + Math.abs(n(line.qty)))
    }
  return originalLines
    .filter((line) => String(line.lineKind ?? 'product') !== 'reward')
    .map((line) => {
      const purchasedQuantity = Math.abs(n(line.qty))
      const refundedQuantity = Math.min(purchasedQuantity, returned.get(String(line.id)) ?? 0)
      return {
        line,
        purchasedQuantity,
        refundedQuantity,
        remainingQuantity: Math.max(0, purchasedQuantity - refundedQuantity),
      }
    })
}

async function completedLotSelections(
  ctx: Ctx,
  originalLine: Row,
  requestedQuantity: number,
): Promise<Row[] | ReturnType<typeof invalid>> {
  if (String(originalLine.tracking ?? 'none') === 'none') return []
  const based = await toProductUnit(ctx, originalLine.productId, originalLine.productUomId, requestedQuantity)
  if (!based) return invalid('quantity', 'return quantity uses an incompatible product unit')
  const move = (await ctx.db.select('stock.Move', { posLineId: originalLine.id }))[0]
  const moveLines = move ? await ctx.db.select('stock.MoveLine', { moveId: move.id }) : []
  const delivered = new Map<string, number>()
  for (const line of moveLines) {
    if (!line.lotId || line.picked === false || !(n(line.quantity) > 0)) continue
    const lotId = String(line.lotId)
    delivered.set(lotId, (delivered.get(lotId) ?? 0) + n(line.quantity))
  }
  if (!delivered.size)
    return invalid('originalOrderId', `tracked line ${String(originalLine.id)} has no completed lot evidence`)

  const previous = new Map<string, number>()
  const refunds = await ctx.db.select('pos.Order', { refundedOrderId: originalLine.orderId })
  for (const refund of refunds.filter((order) => order.state !== 'cancel'))
    for (const line of await ctx.db.select('pos.OrderLine', { orderId: refund.id })) {
      if (String(line.refundedOrderlineId ?? '') !== String(originalLine.id)) continue
      for (const selection of (Array.isArray(line.lotSelections) ? line.lotSelections : []) as Row[]) {
        const lotId = String(selection.lotId)
        previous.set(lotId, (previous.get(lotId) ?? 0) + n(selection.quantity))
      }
    }

  let remaining = based.quantity
  const selections: Row[] = []
  for (const [lotId, deliveredQuantity] of [...delivered.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const available = Math.max(0, deliveredQuantity - (previous.get(lotId) ?? 0))
    const quantity = Math.min(available, remaining)
    if (quantity > 0) selections.push({ lotId, quantity: decimal(quantity), stockRevision: null })
    remaining -= quantity
    if (remaining <= 0.000001) break
  }
  if (remaining > 0.000001)
    return invalid(
      'quantity',
      `return quantity exceeds delivered lot/serial evidence for ${String(originalLine.id)}`,
    )
  if (
    String(originalLine.tracking) === 'serial' &&
    selections.some((selection) => Math.abs(n(selection.quantity) - 1) > 0.000001)
  )
    return invalid('quantity', 'serial returns must select complete serial numbers')
  return selections
}

const refundOrderEffects = [
  'read:pos.Order',
  'read:pos.OrderLine',
  'write:pos.Order',
  'write:pos.OrderLine',
  'read:pos.Payment',
  'read:pos.Sequence',
  'write:pos.Sequence',
  'read:pos.Session',
  'read:pos.Config',
  'read:partner.Partner',
  'read:company.Company',
  'read:stock.Move',
  'read:stock.MoveLine',
  'read:product.Product',
  'read:product.Template',
  'read:product.TemplateUom',
  'read:product.ProductUom',
  'read:uom.Unit',
  'write:pos.AuditEvent',
] as const

export async function getReturnEligibilityHandler(ctx: Ctx, args: Row) {
  const original = (await ctx.db.select('pos.Order', { id: args.id }))[0]
  if (!original || !['paid', 'done'].includes(String(original.state)) || original.isRefund)
    return invalid('id', 'only a paid sale can be returned')
  const lines = await returnableLines(ctx, original)
  const allLines = await ctx.db.select('pos.OrderLine', { orderId: original.id })
  const requiresFullReturn = allLines.some(
    (line) => line.lineKind === 'reward' && line.affectsStock !== false,
  )
  return {
    ok: true,
    originalOrderId: String(original.id),
    revision: n(original.revision),
    refundable: lines.some((entry) => entry.remainingQuantity > 0.000001),
    requiresFullReturn,
    standaloneAllowed: false,
    lines: lines.map((entry) => ({
      lineId: String(entry.line.id),
      productId: String(entry.line.productId),
      name: String(entry.line.name),
      uomId: String(entry.line.productUomId),
      purchasedQuantity: decimal(entry.purchasedQuantity),
      refundedQuantity: decimal(entry.refundedQuantity),
      remainingQuantity: decimal(entry.remainingQuantity),
      unitPrice: String(entry.line.priceUnit),
      amountTotal: String(entry.line.priceSubtotalIncl),
      tracking: String(entry.line.tracking ?? 'none'),
    })),
  }
}

/** Refunds lines of a paid POS order. createExchange runs it inside the exchange transaction. */
export function refundPosOrder(ctx: Ctx, args: Row) {
  return atomic(ctx, async (tx) => {
    const existing = (await tx.db.select('pos.Order', { id: args.id }))[0]
    if (existing) {
      if (
        !existing.isRefund ||
        String(existing.refundedOrderId ?? '') !== String(args.originalOrderId) ||
        String(existing.sessionId) !== String(args.sessionId) ||
        (args.uuid !== undefined && String(existing.uuid) !== String(args.uuid)) ||
        (args.reason !== undefined && String(existing.note ?? '') !== String(args.reason).trim())
      )
        return invalid('id', 'return id is already used by a different command')
      if (Array.isArray(args.lines)) {
        const requested = new Map(
          (args.lines as Row[]).map((line) => [String(line.lineId), n(line.quantity)] as const),
        )
        const held = (await tx.db.select('pos.OrderLine', { orderId: existing.id })).filter(
          (line) => line.refundedOrderlineId && line.lineKind !== 'reward',
        )
        if (
          held.length !== requested.size ||
          held.some(
            (line) =>
              Math.abs(Math.abs(n(line.qty)) - (requested.get(String(line.refundedOrderlineId)) ?? -1)) >
              0.000001,
          )
        )
          return invalid('id', 'return id is already used by a different selection')
      }
      return { ok: true, id: args.id, name: existing.name, revision: n(existing.revision) }
    }
    if (args.uuid) {
      const duplicate = (await tx.db.select('pos.Order', { uuid: args.uuid }))[0]
      if (duplicate) return invalid('uuid', 'return uuid is already used by a different command')
    }

    const original = (await tx.db.select('pos.Order', { id: args.originalOrderId }))[0]
    if (!original || !['paid', 'done'].includes(String(original.state)) || original.isRefund)
      return invalid('originalOrderId', 'only a paid sale can be returned')
    if (args.expectedRevision !== undefined && n(args.expectedRevision) !== n(original.revision))
      return invalid('expectedRevision', 'the order changed; reload it before continuing')
    const session = (await tx.db.select('pos.Session', { id: args.sessionId }))[0]
    if (session?.state !== 'opened') return invalid('sessionId', 'return requires an open session')
    if (String(session.configId) !== String(original.configId))
      return invalid('sessionId', 'return shift must use the original POS configuration and warehouse')
    const claim = await claimOrderRevision(tx, original.id, args.expectedRevision)
    if (claim.ok !== true) return claim

    const eligibility = await returnableLines(tx, original)
    const eligible = new Map(eligibility.map((entry) => [String(entry.line.id), entry] as const))
    const rawLines =
      args.lines === undefined
        ? eligibility
            .filter((entry) => entry.remainingQuantity > 0.000001)
            .map((entry) => ({ lineId: String(entry.line.id), quantity: entry.remainingQuantity }))
        : Array.isArray(args.lines)
          ? (args.lines as Row[])
          : null
    if (!rawLines?.length) return invalid('lines', 'return needs at least one refundable line')
    const requested = rawLines.map((selection) => ({
      lineId: String(selection.lineId ?? ''),
      quantity: n(selection.quantity),
    }))
    if (
      requested.some((selection) => !selection.lineId || !(selection.quantity > 0)) ||
      new Set(requested.map((selection) => selection.lineId)).size !== requested.length
    )
      return invalid('lines', 'return lines must be unique with positive quantities')
    for (const selection of requested) {
      const line = eligible.get(selection.lineId)
      if (!line) return invalid('lineId', `line ${selection.lineId} is not refundable merchandise`)
      if (selection.quantity > line.remainingQuantity + 0.000001)
        return invalid('quantity', `return quantity exceeds the remaining quantity for ${selection.lineId}`)
    }

    const originalLines = await tx.db.select('pos.OrderLine', { orderId: original.id })
    const linkedRefunds = (await tx.db.select('pos.Order', { refundedOrderId: original.id })).filter(
      (order) => order.state !== 'cancel',
    )
    const previousRefundLines: Row[] = []
    for (const refund of linkedRefunds)
      previousRefundLines.push(...(await tx.db.select('pos.OrderLine', { orderId: refund.id })))
    const completesReturn = eligibility.every((entry) => {
      const selected = requested.find((selection) => selection.lineId === String(entry.line.id))
      return (
        entry.remainingQuantity <= 0.000001 || (selected?.quantity ?? 0) + 0.000001 >= entry.remainingQuantity
      )
    })
    const productReward = originalLines.some(
      (line) => line.lineKind === 'reward' && line.affectsStock !== false,
    )
    if (productReward && (!completesReturn || linkedRefunds.length))
      return invalid('lines', 'orders with a product reward require one complete return')

    const merchandiseTotal = eligibility.reduce(
      (sum, entry) => sum + Math.abs(n(entry.line.priceSubtotalIncl)),
      0,
    )
    const returnedMerchandiseTotal = requested.reduce((sum, selection) => {
      const entry = eligible.get(selection.lineId)!
      return sum + Math.abs(n(entry.line.priceSubtotalIncl)) * (selection.quantity / entry.purchasedQuantity)
    }, 0)
    const quantityBasis = eligibility.reduce((sum, entry) => sum + entry.purchasedQuantity, 0)
    const returnedQuantity = requested.reduce((sum, selection) => sum + selection.quantity, 0)
    const returnPortion = Math.min(
      1,
      merchandiseTotal > 0
        ? returnedMerchandiseTotal / merchandiseTotal
        : returnedQuantity / Math.max(quantityBasis, returnedQuantity),
    )

    const materialized: Array<{
      source: Row
      quantity: number
      ratio: number
      exhausts: boolean
      selections: Row[]
    }> = []
    for (const selection of requested) {
      const entry = eligible.get(selection.lineId)!
      const lotSelections = await completedLotSelections(tx, entry.line, selection.quantity)
      if (!Array.isArray(lotSelections)) return lotSelections
      materialized.push({
        source: entry.line,
        quantity: selection.quantity,
        ratio: selection.quantity / entry.purchasedQuantity,
        exhausts: selection.quantity + 0.000001 >= entry.remainingQuantity,
        selections: lotSelections,
      })
    }
    for (const reward of originalLines.filter((line) => line.lineKind === 'reward')) {
      const group = eligibility.filter((entry) => taxGroupKey(entry.line) === taxGroupKey(reward))
      const basis = group.length ? group : eligibility
      const groupTotal = basis.reduce((sum, entry) => sum + Math.abs(n(entry.line.priceSubtotalIncl)), 0)
      const groupReturned = requested.reduce((sum, selection) => {
        const entry = eligible.get(selection.lineId)!
        if (!basis.includes(entry)) return sum
        return (
          sum + Math.abs(n(entry.line.priceSubtotalIncl)) * (selection.quantity / entry.purchasedQuantity)
        )
      }, 0)
      const groupComplete = basis.every((entry) => {
        const selected = requested.find((selection) => selection.lineId === String(entry.line.id))
        return (
          entry.remainingQuantity <= 0.000001 ||
          (selected?.quantity ?? 0) + 0.000001 >= entry.remainingQuantity
        )
      })
      const ratio = productReward
        ? 1
        : Math.min(1, groupTotal > 0 ? groupReturned / groupTotal : returnPortion)
      if (ratio <= 0.000001) continue
      const lotSelections = await completedLotSelections(tx, reward, Math.abs(n(reward.qty)) * ratio)
      if (!Array.isArray(lotSelections)) return lotSelections
      materialized.push({
        source: reward,
        quantity: Math.abs(n(reward.qty)) * ratio,
        ratio,
        exhausts: productReward || groupComplete,
        selections: lotSelections,
      })
    }

    const sequenceNumber = await nextOrderNumber(tx, args.sessionId)
    const name = `Order ${String(sequenceNumber).padStart(5, '0')}`
    await tx.db.insert('pos.Order', {
      id: args.id,
      uuid: args.uuid ?? args.id,
      name,
      posReference: `POS/${String(sequenceNumber).padStart(5, '0')}`,
      sequenceNumber,
      sessionId: args.sessionId,
      configId: session.configId,
      partnerId: original.partnerId,
      state: 'draft',
      invoiceStatus: 'to_invoice',
      isRefund: true,
      refundedOrderId: original.id,
      returnPortion: decimal(returnPortion),
      returnComplete: completesReturn,
      dateOrder: now(),
      currency: original.currency,
      amountUntaxed: '0',
      amountTax: '0',
      amountExact: '0',
      amountRounding: '0',
      amountTotal: '0',
      amountPaid: '0',
      amountReturn: '0',
      toInvoice: true,
      accountMoveId: null,
      pickingId: null,
      note: args.reason ? String(args.reason).trim() : `Return ${String(original.posReference)}`,
      revision: 0,
      operatorId: args.operatorId ?? null,
      deviceId: args.deviceId ?? session.deviceId ?? null,
      priceBookRevision: original.priceBookRevision ?? null,
    })
    let sequence = 10
    for (const item of materialized) {
      const line = item.source
      const previous = previousRefundLines.filter(
        (entry) => String(entry.refundedOrderlineId ?? '') === String(line.id),
      )
      const exhaustsLine = item.exhausts
      const subtotal = exhaustsLine
        ? -(n(line.priceSubtotal) + previous.reduce((sum, entry) => sum + n(entry.priceSubtotal), 0))
        : -n(line.priceSubtotal) * item.ratio
      const total = exhaustsLine
        ? -(n(line.priceSubtotalIncl) + previous.reduce((sum, entry) => sum + n(entry.priceSubtotalIncl), 0))
        : -n(line.priceSubtotalIncl) * item.ratio
      await tx.db.insert('pos.OrderLine', {
        id: `${String(args.id)}:${String(line.id)}`,
        orderId: args.id,
        productId: line.productId,
        productUomId: line.productUomId,
        name: line.name,
        qty: decimal(-item.quantity),
        priceUnit: line.priceUnit,
        discount: line.discount,
        taxId: line.taxId,
        taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : []),
        taxEvidence: returnTaxEvidence(line.taxEvidence, previous, item.ratio, exhaustsLine),
        quoteRevision: line.quoteRevision ?? null,
        tracking: line.tracking ?? 'none',
        lotSelections: item.selections,
        affectsStock: line.affectsStock ?? null,
        priceSubtotal: decimal(subtotal),
        priceSubtotalIncl: decimal(total),
        refundedOrderlineId: line.id,
        sequence,
        ...(line.lineKind
          ? {
              lineKind: line.lineKind,
              loyaltyApplicationId: line.loyaltyApplicationId ?? null,
              loyaltyRewardId: line.loyaltyRewardId ?? null,
              loyaltyPointsCost: line.loyaltyPointsCost ?? null,
            }
          : {}),
      })
      sequence += 10
    }
    await recompute(tx, args.id)
    await appendAudit(tx, {
      id: `order:${String(args.id)}:refund-created`,
      subjectType: 'order',
      subjectId: String(args.id),
      configId: session.configId,
      sessionId: args.sessionId,
      action: 'order.refund_created',
      actorId: args.operatorId,
      deviceId: args.deviceId ?? session.deviceId,
      reason: args.reason,
      relatedId: original.id,
      details: {
        sessionId: args.sessionId,
        returnComplete: completesReturn,
        returnPortion: decimal(returnPortion),
        originalRevision: claim.revision,
      },
    })
    return {
      ok: true,
      id: args.id,
      name,
      revision: 0,
      originalRevision: claim.revision,
    }
  })
}

export function createExchangeHandler(ctx: Ctx, args: Row) {
  return atomic(ctx, async (tx) => {
    const reason = String(args.reason ?? '').trim()
    if (!reason) return invalid('reason', 'exchange reason is required')
    const uuid = String(args.uuid ?? args.id)
    const byId = (await tx.db.select('pos.Exchange', { id: args.id }))[0]
    const byUuid = (await tx.db.select('pos.Exchange', { uuid }))[0]
    if (byId && byUuid && byId.id !== byUuid.id)
      return invalid('uuid', 'exchange uuid is already used by a different command')
    const existing = byId ?? byUuid
    if (existing) {
      const returned = (await tx.db.select('pos.Order', { id: existing.returnOrderId }))[0]
      const replacement = (await tx.db.select('pos.Order', { id: existing.replacementOrderId }))[0]
      if (
        !returned ||
        !replacement ||
        String(existing.originalOrderId) !== String(args.originalOrderId) ||
        String(existing.uuid) !== uuid ||
        String(existing.reason ?? '') !== reason ||
        String(returned.sessionId) !== String(args.sessionId) ||
        String(replacement.sessionId) !== String(args.sessionId) ||
        returned.exchangeRole !== 'return' ||
        replacement.exchangeRole !== 'replacement' ||
        returned.exchangeId !== existing.id ||
        replacement.exchangeId !== existing.id ||
        String(replacement.priceBookRevision ?? '') !== String(args.replacementPriceBookRevision) ||
        (args.replacementNote !== undefined &&
          String(replacement.note ?? '') !== String(args.replacementNote))
      )
        return invalid('id', 'exchange id is already used by a different command')
      const replayedReturn = (await refundPosOrder(tx, {
        id: returned.id,
        uuid: returned.uuid,
        originalOrderId: args.originalOrderId,
        sessionId: args.sessionId,
        expectedRevision: args.expectedRevision,
        lines: args.lines,
        reason,
        operatorId: args.operatorId,
        deviceId: args.deviceId,
      })) as Row
      if (replayedReturn.ok !== true) return replayedReturn
      return {
        ok: true,
        id: existing.id,
        uuid: existing.uuid,
        originalOrderId: existing.originalOrderId,
        returnOrderId: existing.returnOrderId,
        replacementOrderId: existing.replacementOrderId,
        originalRevision: n(existing.originalRevision),
        returnRevision: n(returned.revision),
        replacementRevision: n(replacement.revision),
        reason: existing.reason,
        createdAt: existing.createdAt,
      }
    }

    const returnOrderId = `${String(args.id)}:return`
    const replacementOrderId = `${String(args.id)}:replacement`
    if (
      (await tx.db.select('pos.Order', { id: returnOrderId }))[0] ||
      (await tx.db.select('pos.Order', { id: replacementOrderId }))[0]
    )
      return invalid('id', 'an exchange child order id is already in use')
    const original = (await tx.db.select('pos.Order', { id: args.originalOrderId }))[0]
    if (!original || original.isRefund || !['paid', 'done'].includes(String(original.state)))
      return invalid('originalOrderId', 'only a paid sale can be exchanged')

    const returned = (await refundPosOrder(tx, {
      id: returnOrderId,
      uuid: `${uuid}:return`,
      originalOrderId: args.originalOrderId,
      sessionId: args.sessionId,
      expectedRevision: args.expectedRevision,
      lines: args.lines,
      reason,
      operatorId: args.operatorId,
      deviceId: args.deviceId,
    })) as Row
    if (returned.ok !== true) return returned
    const replacement = (await createPosOrder(tx, {
      id: replacementOrderId,
      uuid: `${uuid}:replacement`,
      sessionId: args.sessionId,
      partnerId: original.partnerId ?? undefined,
      note: args.replacementNote ?? `Exchange replacement for ${String(original.posReference)}`,
      operatorId: args.operatorId,
      deviceId: args.deviceId,
      priceBookRevision: args.replacementPriceBookRevision,
    })) as Row
    if (replacement.ok !== true) return replacement

    const createdAt = now()
    await tx.db.insert('pos.Exchange', {
      id: args.id,
      uuid,
      originalOrderId: original.id,
      returnOrderId,
      replacementOrderId,
      originalRevision: returned.originalRevision,
      reason,
      createdAt,
    })
    await tx.db.update('pos.Order', { id: returnOrderId }, { exchangeId: args.id, exchangeRole: 'return' })
    await tx.db.update(
      'pos.Order',
      { id: replacementOrderId },
      { exchangeId: args.id, exchangeRole: 'replacement' },
    )
    await appendAudit(tx, {
      id: `exchange:${String(args.id)}:created`,
      subjectType: 'exchange',
      subjectId: String(args.id),
      configId: original.configId,
      sessionId: args.sessionId,
      action: 'exchange.created',
      actorId: args.operatorId,
      deviceId: args.deviceId,
      reason,
      relatedId: original.id,
      details: { returnOrderId, replacementOrderId, originalRevision: returned.originalRevision },
      occurredAt: createdAt,
    })
    return {
      ok: true,
      id: args.id,
      uuid,
      originalOrderId: original.id,
      returnOrderId,
      replacementOrderId,
      originalRevision: n(returned.originalRevision),
      returnRevision: n(returned.revision),
      replacementRevision: n(replacement.revision),
      reason,
      createdAt,
    }
  })
}

export const returnsFunctions: Record<string, FnSpec> = {
  getReturnEligibility: defineFn({
    input: { id: 'id' },
    output: {
      ok: 'bool',
      originalOrderId: 'id?',
      revision: 'int?',
      refundable: 'bool?',
      requiresFullReturn: 'bool?',
      standaloneAllowed: 'bool?',
      lines: 'json?',
      errors: 'json?',
    },
    effects: ['read:pos.Order', 'read:pos.OrderLine'],
    agent: true,
    handler: getReturnEligibilityHandler,
  }),
  refundOrder: defineFn({
    input: {
      id: 'id',
      uuid: 'text?',
      originalOrderId: 'id',
      sessionId: 'id',
      expectedRevision: 'int?',
      lines: 'json?',
      reason: 'text?',
      operatorId: 'text?',
      deviceId: 'text?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      name: 'text?',
      revision: 'int?',
      originalRevision: 'int?',
      errors: 'json?',
    },
    effects: [...refundOrderEffects],
    idempotent: true,
    agent: true,
    handler: refundPosOrder,
  }),
  createExchange: defineFn({
    input: {
      id: 'id',
      uuid: 'text?',
      originalOrderId: 'id',
      sessionId: 'id',
      expectedRevision: 'int',
      lines: 'json',
      reason: 'text',
      replacementPriceBookRevision: 'text',
      replacementNote: 'text?',
      operatorId: 'text?',
      deviceId: 'text?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      uuid: 'text?',
      originalOrderId: 'id?',
      returnOrderId: 'id?',
      replacementOrderId: 'id?',
      originalRevision: 'int?',
      returnRevision: 'int?',
      replacementRevision: 'int?',
      reason: 'text?',
      createdAt: 'datetime?',
      errors: 'json?',
    },
    effects: [...refundOrderEffects, ...createOrderEffects, 'read:pos.Exchange', 'write:pos.Exchange'],
    idempotent: true,
    agent: true,
    handler: createExchangeHandler,
  }),
}
