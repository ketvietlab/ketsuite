import type { FnSpec } from '@ketvietlab/ketjs'
import { auditFunctions } from './audit.ts'
import { reportsFunctions } from './reports.ts'
import { configsFunctions } from './configs.ts'
import { paymentMethodsFunctions } from './payment-methods.ts'
import { sessionsFunctions } from './sessions.ts'
import { cashFunctions } from './cash.ts'
import { ordersFunctions } from './orders.ts'
import { checkoutFunctions } from './checkout.ts'
import { linesFunctions } from './lines.ts'
import { paymentsFunctions } from './payments.ts'
import { providerPaymentsFunctions } from './provider-payments.ts'
import { returnsFunctions } from './returns.ts'

export {
  POS_ORDER_STATES,
  POS_SESSION_STATES,
  POS_TENDER_STATES,
  POS_INVOICE_STATUSES,
  POS_PAYMENT_SETTLEMENT_KINDS,
  claimDraftRevision,
} from './helpers.ts'

/**
 * Creates a POS session on a context that is already inside a transaction. The `createSession`
 * function opens its own transaction, and transactions do not nest, so a module that opens a
 * session as one step of its own transaction calls this instead.
 */
export { createSessionHandler as createPosSessionInTransaction } from './sessions.ts'

export const functions: Record<string, FnSpec> = {}
for (const group of [
  auditFunctions,
  reportsFunctions,
  configsFunctions,
  paymentMethodsFunctions,
  sessionsFunctions,
  cashFunctions,
  ordersFunctions,
  checkoutFunctions,
  linesFunctions,
  paymentsFunctions,
  providerPaymentsFunctions,
  returnsFunctions,
]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate pos function: ${key}`)
    functions[key] = spec
  }
}
