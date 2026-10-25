import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { createHash } from 'node:crypto'
import { functions as accountFunctions, insertDraftMove } from '../../account/functions.ts'
import { absDecimalText, minorText, moneyMinor, scaleOf } from '../../account/money.ts'
import { functions as stockFunctions } from '../../stock/functions.ts'
import { toProductUnit } from '../../stock/units.ts'
import {
  accountEffects,
  appendAudit,
  atomic,
  claimDraftRevision,
  decimal,
  invalid,
  n,
  now,
  trackingAvailability,
} from './helpers.ts'

type ProviderFinalizationClaim =
  | { ok: true; order: Row; revision: number; leases: Array<{ id: string; token: string }> }
  | ReturnType<typeof invalid>

const PROVIDER_FINALIZATION_LEASE_MS = 5 * 60_000

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, held]) => `${JSON.stringify(key)}:${stableJson(held)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

const receiptHash = (document: Row): string => createHash('sha256').update(stableJson(document)).digest('hex')

const receiptDocumentFor = async (
  ctx: Ctx,
  order: Row,
  config: Row,
  session: Row,
  customer: Row,
  lines: Row[],
  payments: Row[],
  accountMoveId: string,
  issuedAt: string,
): Promise<Row> => {
  const methodIds = [...new Set(payments.map((payment) => String(payment.paymentMethodId)))]
  const methods = new Map(
    (
      await Promise.all(
        methodIds.map(async (id) => (await ctx.db.select('pos.PaymentMethod', { id }))[0] ?? null),
      )
    )
      .filter(Boolean)
      .map((method) => [String(method!.id), method!] as const),
  )
  return {
    schema: 'ketviet.pos.receipt.v1',
    company: { id: String(ctx.scope.company ?? '') },
    config: { id: String(config.id), name: String(config.name) },
    shift: { id: String(session.id), name: String(session.name) },
    cashier: { id: String(order.operatorId ?? session.userId) },
    customer: { id: String(customer.id), name: String(customer.name) },
    order: {
      id: String(order.id),
      name: String(order.name),
      reference: String(order.posReference),
      orderedAt: String(order.dateOrder),
      isReturn: order.isRefund === true,
      originalOrderId: order.refundedOrderId == null ? null : String(order.refundedOrderId),
    },
    currency: String(order.currency),
    lines: [...lines]
      .sort(
        (left, right) =>
          n(left.sequence) - n(right.sequence) || String(left.id).localeCompare(String(right.id)),
      )
      .map((line) => {
        const evidence =
          line.taxEvidence && typeof line.taxEvidence === 'object' ? (line.taxEvidence as Row) : null
        return {
          id: String(line.id),
          productId: String(line.productId),
          uomId: String(line.productUomId),
          name: String(line.name),
          quantity: String(line.qty),
          unitPrice: String(line.priceUnit),
          discount: String(line.discount),
          amountUntaxed: String(line.priceSubtotal),
          amountTax: decimal(n(line.priceSubtotalIncl) - n(line.priceSubtotal)),
          amountTotal: String(line.priceSubtotalIncl),
          taxes: (Array.isArray(evidence?.taxes) ? (evidence!.taxes as Row[]) : []).map((tax) => ({
            id: String(tax.taxId ?? ''),
            name: String(tax.name ?? tax.taxId ?? ''),
            amount: String(tax.share ?? '0'),
          })),
        }
      }),
    tenders: payments
      .filter((payment) => (payment.state ?? 'captured') === 'captured')
      .sort(
        (left, right) =>
          String(left.paymentDate).localeCompare(String(right.paymentDate)) ||
          String(left.id).localeCompare(String(right.id)),
      )
      .map((payment) => ({
        paymentMethodId: String(payment.paymentMethodId),
        paymentMethodName: String(methods.get(String(payment.paymentMethodId))?.name ?? ''),
        tenderedAmount: String(payment.tenderedAmount ?? payment.amount),
        appliedAmount: String(payment.appliedAmount ?? payment.amount),
        change: decimal(
          n(payment.tenderedAmount ?? payment.amount) - n(payment.appliedAmount ?? payment.amount),
        ),
        paidAt: String(payment.paymentDate),
      })),
    totals: {
      untaxed: String(order.amountUntaxed),
      tax: String(order.amountTax),
      exact: String(order.amountExact),
      rounding: String(order.amountRounding),
      total: String(order.amountTotal),
      paid: String(order.amountPaid),
      change: String(order.amountReturn),
    },
    invoice: { id: accountMoveId },
    issuedAt,
  }
}

async function providerFinalizationLocks(
  ctx: Ctx,
  order: Row,
): Promise<{ ok: true; locks: Row[] } | ReturnType<typeof invalid>> {
  const [locks, payments] = await Promise.all([
    ctx.db.select('pos.ProviderPaymentLock', { orderId: order.id }),
    ctx.db.select('pos.Payment', { orderId: order.id }),
  ])
  const captured = payments.filter(
    (payment) =>
      payment.kind === 'provider' &&
      (payment.state ?? 'captured') === 'captured' &&
      payment.reversalOfId == null,
  )
  const active = locks
    .filter((lock) => !['released', 'reversed'].includes(String(lock.state)))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  if (active.some((lock) => !['settled', 'finalizing'].includes(String(lock.state))))
    return invalid('paymentLockId', 'external payment is still pending reconciliation')
  if (captured.length !== active.length)
    return invalid('paymentLockId', 'external payment membership is incomplete')
  for (const lock of active) {
    const payment = captured.find(
      (candidate) => String(candidate.providerAttemptId ?? '') === String(lock.id),
    )
    if (
      !payment ||
      lock.orderId !== order.id ||
      lock.paymentMethodId !== payment.paymentMethodId ||
      n(lock.amount) !== n(payment.appliedAmount ?? payment.amount) ||
      lock.currency !== order.currency ||
      lock.settledPaymentId !== payment.id
    )
      return invalid('paymentLockId', 'external payment membership is inconsistent')
  }
  return { ok: true, locks: active }
}

async function claimProviderFinalization(
  ctx: Ctx,
  id: unknown,
  expectedRevision?: unknown,
): Promise<ProviderFinalizationClaim> {
  return (await atomic(ctx, async (tx) => {
    const order = (await tx.db.select('pos.Order', { id }))[0]
    if (!order) return invalid('orderId', 'order does not exist')
    if (order.state !== 'draft') return invalid('state', 'only a draft order can be finalized')
    const current = n(order.revision)
    const membership = await providerFinalizationLocks(tx, order)
    if (membership.ok !== true) return membership
    if (!membership.locks.length) return invalid('paymentLockId', 'provider payment lock is missing')
    const finalizing = membership.locks.filter((lock) => lock.state === 'finalizing')
    if (finalizing.length) {
      if (finalizing.length !== membership.locks.length)
        return invalid('paymentLockId', 'external payment finalization membership is inconsistent')
      const previousToken = String(finalizing[0]!.updatedAt ?? '')
      if (finalizing.some((lock) => String(lock.updatedAt ?? '') !== previousToken))
        return invalid('paymentLockId', 'external payment finalization membership is inconsistent')
      const leaseAge = Date.now() - Date.parse(previousToken)
      if (!Number.isFinite(leaseAge) || leaseAge < PROVIDER_FINALIZATION_LEASE_MS)
        return invalid('paymentLockId', 'external payment finalization is already in progress')
      if (
        expectedRevision !== undefined &&
        ![current, Math.max(0, current - 1)].includes(n(expectedRevision))
      )
        return invalid('expectedRevision', 'the order changed; reload it before continuing')
      const token = now()
      for (const lock of finalizing) {
        const resumed = await tx.db.compareAndSet(
          'pos.ProviderPaymentLock',
          { id: lock.id },
          { state: 'finalizing', updatedAt: previousToken },
          { updatedAt: token },
        )
        if (!('dryRun' in resumed) && !resumed.matched)
          return invalid('paymentLockId', 'external payment finalization recovery was already claimed')
      }
      return {
        ok: true,
        order,
        revision: current,
        leases: finalizing.map((lock) => ({ id: String(lock.id), token })),
      }
    }
    if (expectedRevision !== undefined && n(expectedRevision) !== current)
      return invalid('expectedRevision', 'the order changed; reload it before continuing')
    const token = now()
    for (const lock of membership.locks) {
      const lockChanged = await tx.db.compareAndSet(
        'pos.ProviderPaymentLock',
        { id: lock.id },
        { state: 'settled' },
        { state: 'finalizing', updatedAt: token },
      )
      if (!('dryRun' in lockChanged) && !lockChanged.matched)
        return invalid('paymentLockId', 'external payment reconciliation changed before finalization')
    }
    const orderChanged = await tx.db.compareAndSet(
      'pos.Order',
      { id: order.id },
      { revision: order.revision ?? null },
      { revision: current + 1 },
    )
    if (!('dryRun' in orderChanged) && !orderChanged.matched)
      return invalid('expectedRevision', 'the order changed; reload it before continuing')
    return {
      ok: true,
      order,
      revision: current + 1,
      leases: membership.locks.map((lock) => ({ id: String(lock.id), token })),
    }
  })) as ProviderFinalizationClaim
}

async function productOf(ctx: Ctx, id: unknown) {
  const product = (await ctx.db.select('product.Product', { id }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return product && template ? { product, template } : null
}

async function consumerPartner(ctx: Ctx): Promise<Row> {
  const name = 'Bán cho người tiêu dùng'
  const existing = (await ctx.db.select('partner.Partner', { name })).find((row) => row.active !== false)
  if (existing) return existing
  const id = `pos-consumer-${String(ctx.scope.company)}`
  await ctx.db.insertIfAbsent('partner.Partner', {
    id,
    kind: 'person',
    name,
    parentId: null,
    vat: null,
    ref: null,
    email: null,
    phone: null,
    lang: 'vi',
    active: true,
  })
  return (await ctx.db.select('partner.Partner', { id }))[0]!
}

async function createAccounting(ctx: Ctx, order: Row, config: Row, lines: Row[], payments: Row[]) {
  const id = `${String(order.id)}:account`,
    existing = (await ctx.db.select('account.Move', { id }))[0]
  if (existing) return id
  const invoice = Boolean(order.toInvoice)
  const date = String(order.dateOrder)
  const scale = scaleOf(order.currency)
  const signedTotal = moneyMinor(order.amountTotal, scale)
  const refund = signedTotal < 0n
  const total = refund ? -signedTotal : signedTotal
  const signedUntaxed = moneyMinor(order.amountUntaxed, scale)
  const untaxed = signedUntaxed < 0n ? -signedUntaxed : signedUntaxed
  const signedTax = moneyMinor(order.amountTax, scale)
  const tax = signedTax < 0n ? -signedTax : signedTax
  if (invoice && !order.partnerId) throw new Error('a customer is required to invoice a POS order')
  if (tax > 0n && !config.taxAccountId) throw new Error('a tax account is required for taxed POS orders')
  await ctx.tx(async (tx) => {
    const zero = minorText(0n, scale)
    const totalText = minorText(total, scale)
    const move: Row = {
      id,
      name: id,
      ref: order.posReference,
      date,
      moveType: invoice ? (refund ? 'out_refund' : 'out_invoice') : 'entry',
      state: 'draft',
      journalId: config.salesJournalId,
      partnerId: order.partnerId ?? null,
      invoiceDate: invoice ? date : null,
      invoiceDateDue: invoice ? date : null,
      paymentTermId: null,
      paymentState: invoice ? 'not_paid' : 'paid',
      currency: order.currency,
      amountUntaxed: minorText(untaxed, scale),
      amountTax: minorText(tax, scale),
      amountTotal: totalText,
      postedAt: null,
      revision: 0,
    }
    const moveLines: Row[] = []
    let sequence = 10
    for (const line of lines) {
      // Revenue follows the signed line subtotal. A negative Loyalty line is a
      // contra-revenue debit on a sale, and becomes a credit when a refund
      // reverses it. Looking only at the order direction would overstate revenue.
      const subtotal = moneyMinor(line.priceSubtotal, scale)
      const balance = -subtotal
      const debit = balance > 0n ? balance : 0n
      const credit = balance < 0n ? -balance : 0n
      moveLines.push({
        id: `${id}:line:${String(line.id)}`,
        moveId: id,
        name: line.name,
        accountId: config.revenueAccountId,
        partnerId: order.partnerId ?? null,
        productId: line.productId,
        productUomId: line.productUomId,
        quantity: absDecimalText(line.qty),
        priceUnit: line.priceUnit,
        discount: line.discount,
        taxId: line.taxId,
        debit: minorText(debit, scale),
        credit: minorText(credit, scale),
        balance: minorText(balance, scale),
        dateMaturity: null,
        displayType: null,
        reconciled: false,
        amountResidual: zero,
        sequence,
        posLineId: line.id,
      })
      sequence += 10
    }
    if (tax > 0n)
      moveLines.push({
        id: `${id}:tax`,
        moveId: id,
        name: 'Tax',
        accountId: config.taxAccountId,
        partnerId: order.partnerId ?? null,
        productId: null,
        productUomId: null,
        quantity: '1',
        priceUnit: minorText(tax, scale),
        discount: '0',
        taxId: null,
        debit: refund ? minorText(tax, scale) : zero,
        credit: refund ? zero : minorText(tax, scale),
        balance: minorText(refund ? tax : -tax, scale),
        dateMaturity: null,
        displayType: null,
        reconciled: false,
        amountResidual: zero,
        sequence: 900,
      })
    if (invoice) {
      moveLines.push({
        id: `${id}:counterpart`,
        moveId: id,
        name: order.posReference,
        accountId: config.receivableAccountId,
        partnerId: order.partnerId,
        productId: null,
        productUomId: null,
        quantity: '1',
        priceUnit: totalText,
        discount: '0',
        taxId: null,
        debit: refund ? zero : totalText,
        credit: refund ? totalText : zero,
        balance: minorText(refund ? -total : total, scale),
        dateMaturity: date,
        displayType: null,
        reconciled: false,
        amountResidual: totalText,
        sequence: 1000,
      })
    } else {
      let paymentSequence = 1000
      for (const payment of payments) {
        const method = (await tx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]!,
          journal = (await tx.db.select('account.Journal', { id: method.journalId }))[0]!
        const signedAmount = moneyMinor(payment.amount, scale)
        const amount = signedAmount < 0n ? -signedAmount : signedAmount
        moveLines.push({
          id: `${id}:payment:${String(payment.id)}`,
          moveId: id,
          name: method.name,
          accountId: journal.defaultAccountId,
          partnerId: order.partnerId ?? null,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: minorText(amount, scale),
          discount: '0',
          taxId: null,
          debit: refund ? zero : minorText(amount, scale),
          credit: refund ? minorText(amount, scale) : zero,
          balance: minorText(refund ? -amount : amount, scale),
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: zero,
          sequence: paymentSequence,
        })
        paymentSequence += 10
      }
    }
    await insertDraftMove(tx, { move, lines: moveLines })
  })
  const posted = (await accountFunctions.postMove!.handler(ctx, { id })) as Row
  if (posted.ok !== true)
    throw new Error(
      String((posted.errors as Row[] | undefined)?.[0]?.message ?? 'POS accounting move could not be posted'),
    )
  if (invoice) {
    for (const payment of payments) {
      const method = (await ctx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]!
      const result = (await accountFunctions.registerPayment!.handler(ctx, {
        id: `${String(payment.id)}:account`,
        name: String(order.posReference),
        paymentType: refund ? 'outbound' : 'inbound',
        partnerType: 'customer',
        partnerId: order.partnerId,
        journalId: method.journalId,
        destinationAccountId: config.receivableAccountId,
        amount: minorText(
          (() => {
            const held = moneyMinor(payment.amount, scale)
            return held < 0n ? -held : held
          })(),
          scale,
        ),
        date,
        paymentReference: order.posReference,
        settlementKind: method.settlementKind ?? 'liquidity',
        reconcileLineId: `${id}:counterpart`,
      })) as Row
      if (result.ok !== true)
        throw new Error(
          String((result.errors as Row[] | undefined)?.[0]?.message ?? 'POS payment could not be posted'),
        )
    }
  }
  return id
}

const stockEffects = [
  ...(stockFunctions.createPicking!.effects ?? []),
  ...(stockFunctions.addMove!.effects ?? []),
  ...(stockFunctions.confirmPicking!.effects ?? []),
  ...(stockFunctions.reserveMoves!.effects ?? []),
  ...(stockFunctions.saveMoveLine!.effects ?? []),
  ...(stockFunctions.completePicking!.effects ?? []),
]

export async function validateOrderHandler(ctx: Ctx, args: Row) {
  const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
  if (!order) return invalid('id', 'POS order does not exist')
  if (['paid', 'done'].includes(String(order.state)))
    return {
      ok: true,
      id: args.id,
      state: order.state,
      pickingId: order.pickingId,
      accountMoveId: order.accountMoveId,
      receiptId: order.receiptId,
      revision: n(order.revision),
    }
  if (order.state !== 'draft') return invalid('state', 'only a new order can be paid')
  const providerMembership = await providerFinalizationLocks(ctx, order)
  if (providerMembership.ok !== true) return providerMembership
  if (order.exchangeRole === 'replacement') {
    const exchange = order.exchangeId
      ? (await ctx.db.select('pos.Exchange', { id: order.exchangeId }))[0]
      : null
    const exchangeReturn = exchange
      ? (await ctx.db.select('pos.Order', { id: exchange.returnOrderId }))[0]
      : null
    if (
      !exchange ||
      !exchangeReturn ||
      exchange.replacementOrderId !== order.id ||
      exchangeReturn.exchangeRole !== 'return' ||
      exchangeReturn.exchangeId !== exchange.id ||
      exchangeReturn.isRefund !== true
    )
      return invalid('exchangeId', 'replacement sale is not linked to a valid return')
    if (!['paid', 'done'].includes(String(exchangeReturn.state)))
      return invalid('exchangeId', 'exchange return must be completed before its replacement sale')
  }
  const session = (await ctx.db.select('pos.Session', { id: order.sessionId }))[0]
  if (!session || !['opened', 'closing_control'].includes(String(session.state)))
    return invalid('sessionId', 'session is not open')
  const lines = await ctx.db.select('pos.OrderLine', { orderId: args.id })
  if (!lines.length) return invalid('lines', 'order needs at least one product')
  if (lines.some((line) => (order.isRefund ? !(n(line.qty) < -0.000001) : !(n(line.qty) > 0.000001))))
    return invalid('lines', 'sale and return orders cannot mix quantity directions')
  const payments = (await ctx.db.select('pos.Payment', { orderId: args.id })).filter(
    (payment) => (payment.state ?? 'captured') === 'captured',
  )
  const scale = scaleOf(order.currency)
  if (moneyMinor(order.amountPaid, scale) !== moneyMinor(order.amountTotal, scale))
    return invalid('amountPaid', 'paid amount must equal order total')
  const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]!
  if (moneyMinor(order.amountTax, scale) !== 0n && !config.taxAccountId)
    return invalid('taxAccountId', 'a tax account is required before stock is moved')
  const goods: Row[] = []
  const selectedLots = new Set<string>()
  for (const line of lines) {
    if (line.affectsStock === false) continue
    const held = await productOf(ctx, line.productId)
    if (held?.template.type !== 'service') {
      const tracking = String(held?.template.tracking ?? 'none')
      if (tracking !== String(line.tracking ?? 'none'))
        return invalid('tracking', 'product tracking changed; remove and add the line again')
      if (tracking !== 'none') {
        const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
        if (!based) return invalid('productUomId', 'line unit is incompatible with the product unit')
        const selections = Array.isArray(line.lotSelections) ? (line.lotSelections as Row[]) : []
        if (
          !selections.length ||
          Math.abs(selections.reduce((sum, selection) => sum + n(selection.quantity), 0) - based.quantity) >
            0.000001
        )
          return invalid('lotSelections', 'selected lot/serial quantity must equal line quantity')
        if (new Set(selections.map((selection) => String(selection.lotId))).size !== selections.length)
          return invalid('lotSelections', 'a lot/serial can only be selected once per line')
        for (const selection of selections) {
          const lotId = String(selection.lotId)
          if (selectedLots.has(lotId))
            return invalid('lotSelections', 'a lot/serial can only be selected on one order line')
          selectedLots.add(lotId)
        }
        if (tracking === 'serial') {
          for (const selection of selections) {
            if (Math.abs(n(selection.quantity) - 1) > 0.000001)
              return invalid('lotSelections', 'every selected serial must have quantity 1')
          }
        }
        if (!order.isRefund) {
          const availability = await trackingAvailability(ctx, order, line)
          const lots = new Map((availability.lots as Row[]).map((lot) => [String(lot.lotId), lot] as const))
          for (const selection of selections) {
            const lot = lots.get(String(selection.lotId))
            if (lot?.selectable !== true)
              return invalid('lotSelections', `lot/serial ${String(selection.lotId)} is not selectable`)
            if (String(lot.stockRevision) !== String(selection.stockRevision))
              return invalid('stockRevision', 'stock position changed; reload lot availability')
            if (n(lot.availableQuantity) + 0.000001 < n(selection.quantity))
              return invalid('stock', `insufficient stock for lot/serial ${String(selection.lotId)}`)
          }
        }
      }
      goods.push({ ...line, tracking })
    }
  }
  const claim = providerMembership.locks.length
    ? await claimProviderFinalization(ctx, args.id, args.expectedRevision)
    : await claimDraftRevision(ctx, args.id, args.expectedRevision)
  if (claim.ok !== true) return claim
  const providerLeases = ('leases' in claim ? claim.leases : []) as Array<{
    id: string
    token: string
  }>
  let finalizationCommitted = false
  try {
    const partner = order.partnerId
      ? (await ctx.db.select('partner.Partner', { id: order.partnerId }))[0]
      : await consumerPartner(ctx)
    if (!partner) return invalid('partnerId', 'invoice customer does not exist')
    const effectiveOrder = { ...order, partnerId: partner.id, toInvoice: true }
    await ctx.db.update('pos.Order', { id: args.id }, { partnerId: partner.id, toInvoice: true })
    let pickingId: string | null = null
    if (goods.length) {
      pickingId = `${String(order.id)}:picking`
      const suffix = order.isRefund ? 'incoming' : 'outgoing'
      const pickingTypeId = `${String(config.warehouseId)}:${suffix}`
      const completedPicking = (await ctx.db.select('stock.Picking', { id: pickingId }))[0]
      if (completedPicking?.state === 'done') {
        const completedMoves = await ctx.db.select('stock.Move', { pickingId })
        let matches =
          completedPicking.pickingTypeId === pickingTypeId && completedMoves.length === goods.length
        for (const line of goods) {
          const moveId = `${String(line.id)}:move`
          const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
          const move = completedMoves.find((candidate) => candidate.id === moveId)
          matches =
            matches &&
            based !== null &&
            move?.state === 'done' &&
            move.productId === line.productId &&
            move.productUomId === based.uomId &&
            move.posLineId === line.id &&
            move.origin === order.posReference &&
            Math.abs(n(move.productUomQty) - based.quantity) <= 0.000001
        }
        if (!matches) return invalid('pickingId', 'completed stock transfer does not match this order retry')
      } else {
        const created = (await stockFunctions.createPicking!.handler(ctx, {
          id: pickingId,
          name: `${order.isRefund ? 'Refund' : 'POS'} ${String(order.posReference)}`,
          pickingTypeId,
          scheduledDate: order.dateOrder,
        })) as Row
        if (created.ok !== true) return created
        for (const line of goods) {
          const moveId = `${String(line.id)}:move`,
            quantity = Math.abs(n(line.qty))
          const moved = (await stockFunctions.addMove!.handler(ctx, {
            id: moveId,
            name: line.name,
            pickingId,
            productId: line.productId,
            productUomId: line.productUomId,
            productUomQty: decimal(quantity),
            origin: order.posReference,
          })) as Row
          if (moved.ok !== true) return moved
          await ctx.db.update('stock.Move', { id: moveId }, { posLineId: line.id })
        }
        const confirmed = (await stockFunctions.confirmPicking!.handler(ctx, { id: pickingId })) as Row
        if (confirmed.ok !== true) return confirmed
        if (order.isRefund) {
          for (const line of goods) {
            const moveId = `${String(line.id)}:move`
            const picking = (await ctx.db.select('stock.Picking', { id: pickingId }))[0]!
            const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
            if (!based) return invalid('productUomId', 'line unit is incompatible with the product unit')
            const selections =
              String(line.tracking) === 'none'
                ? [{ lotId: null, quantity: based.quantity }]
                : (line.lotSelections as Row[])
            for (const [index, selection] of selections.entries()) {
              const saved = (await stockFunctions.saveMoveLine!.handler(ctx, {
                id: `${moveId}:line:${String(index + 1)}`,
                moveId,
                productUomId: line.productUomId,
                quantity: decimal(n(selection.quantity)),
                locationId: picking.locationId,
                locationDestId: picking.locationDestId,
                ...(selection.lotId ? { lotId: selection.lotId } : {}),
                picked: true,
              })) as Row
              if (saved.ok !== true) return saved
            }
          }
        } else {
          const reserved = (await stockFunctions.reserveMoves!.handler(ctx, {
            requireFull: true,
            moves: goods.map((line) => ({
              id: `${String(line.id)}:move`,
              ...(String(line.tracking) === 'none' ? {} : { selections: line.lotSelections }),
            })),
          })) as Row
          if (reserved.ok !== true) return reserved
          const results = Array.isArray(reserved.results) ? (reserved.results as Row[]) : []
          for (const line of goods) {
            const result = results.find((entry) => String(entry.id) === `${String(line.id)}:move`)
            const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
            if (!based || !result || n(result.reserved) + 0.000001 < based.quantity)
              return invalid('stock', `insufficient stock for ${String(line.name)}`)
          }
        }
        const completed = (await stockFunctions.completePicking!.handler(ctx, {
          id: pickingId,
          createBackorder: false,
        })) as Row
        if (completed.ok !== true) return completed
      }
    }
    let accountMoveId: string
    try {
      accountMoveId = await createAccounting(ctx, effectiveOrder, config, lines, payments)
    } catch (error) {
      return invalid('accounting', (error as Error).message)
    }
    const receiptId = `${String(order.id)}:receipt:v1`
    const issuedAt = now()
    const receiptDocument = await receiptDocumentFor(
      ctx,
      effectiveOrder,
      config,
      session,
      partner,
      lines,
      payments,
      accountMoveId,
      issuedAt,
    )
    const contentHash = receiptHash(receiptDocument)
    await ctx.tx(async (tx) => {
      const inserted = await tx.db.insertIfAbsent('pos.ReceiptDocument', {
        id: receiptId,
        orderId: args.id,
        version: 1,
        templateVersion: 'pos-receipt-v1',
        contentHash,
        document: receiptDocument,
        issuedAt,
      })
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const existing = (await tx.db.select('pos.ReceiptDocument', { id: receiptId }))[0]
        if (
          existing?.orderId !== args.id ||
          n(existing.version) !== 1 ||
          existing.templateVersion !== 'pos-receipt-v1' ||
          existing.contentHash !== contentHash
        )
          throw new Error('receipt identity is already bound to different content')
      }
      for (const lease of providerLeases) {
        const finalized = await tx.db.compareAndSet(
          'pos.ProviderPaymentLock',
          { id: lease.id },
          { state: 'finalizing', updatedAt: lease.token },
          { state: 'finalized', updatedAt: now() },
        )
        if (!('dryRun' in finalized) && !finalized.matched)
          throw new Error('external payment finalization claim was lost')
      }
      await tx.db.update(
        'pos.Order',
        { id: args.id },
        {
          state: 'paid',
          finalizedAt: issuedAt,
          invoiceStatus: 'invoiced',
          pickingId,
          accountMoveId,
          receiptId,
        },
      )
      await appendAudit(tx, {
        id: `order:${String(args.id)}:finalized`,
        subjectType: 'order',
        subjectId: String(args.id),
        configId: order.configId,
        sessionId: order.sessionId,
        action: order.isRefund ? 'order.refund_finalized' : 'order.finalized',
        actorId: order.operatorId ?? session.userId,
        deviceId: order.deviceId ?? session.deviceId,
        relatedId: receiptId,
        details: {
          amountTotal: order.amountTotal,
          accountMoveId,
          pickingId,
          receiptId,
          revision: claim.revision,
        },
      })
    })
    finalizationCommitted = true
    return {
      ok: true,
      id: args.id,
      state: 'paid',
      revision: claim.revision,
      ...(pickingId ? { pickingId } : {}),
      accountMoveId,
      receiptId,
    }
  } finally {
    if (!finalizationCommitted)
      for (const lease of providerLeases)
        await ctx.db.compareAndSet(
          'pos.ProviderPaymentLock',
          { id: lease.id },
          { state: 'finalizing', updatedAt: lease.token },
          { state: 'needs_review', updatedAt: now() },
        )
  }
}

export const checkoutFunctions: Record<string, FnSpec> = {
  validateOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: {
      ok: 'bool',
      id: 'id?',
      state: 'text?',
      pickingId: 'id?',
      accountMoveId: 'id?',
      receiptId: 'id?',
      revision: 'int?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.Exchange',
      'read:pos.Session',
      'read:pos.Config',
      'read:pos.OrderLine',
      'read:pos.Payment',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.PaymentMethod',
      'read:pos.ReceiptDocument',
      'write:pos.ReceiptDocument',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
      'read:partner.Partner',
      'write:partner.Partner',
      'read:account.Move',
      'write:account.Move',
      'write:account.MoveLine',
      'read:account.Journal',
      'read:account.Account',
      'write:pos.AuditEvent',
      ...stockEffects,
      ...accountEffects,
    ],
    idempotent: true,
    agent: true,
    handler: validateOrderHandler,
  }),
}
