import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import {
  CUSTOMER_READ_EFFECTS,
  customerChoices,
  customerCredit,
  getCustomer,
  listCustomers,
  saveCustomer,
  saveCustomerCredit,
} from '../customers.ts'
import { saleRecordResult } from '../record-result.ts'

const USER_EFFECTS = ['read:user.User', 'read:user.Membership'] as const

export const listCustomersHandler = (ctx: Ctx, args: Row) => listCustomers(ctx, args)
export const getCustomerHandler = (ctx: Ctx, args: Row) => getCustomer(ctx, args)
export const getCustomerCreditHandler = (ctx: Ctx, args: Row) =>
  customerCredit(ctx, String(args.partnerId), args.orderId ? String(args.orderId) : undefined)
export const getCustomerChoicesHandler = (ctx: Ctx) => customerChoices(ctx)
export const saveCustomerHandler = async (ctx: Ctx, args: Row) =>
  saleRecordResult(await saveCustomer(ctx, args))
export const saveCustomerCreditHandler = async (ctx: Ctx, args: Row) =>
  saleRecordResult(await saveCustomerCredit(ctx, args))

export const customerFunctions: Record<string, FnSpec> = {
  listCustomers: defineFn({
    input: { search: 'text?', mine: 'bool?', over: 'bool?', limit: 'int?', offset: 'int?' },
    effects: [...CUSTOMER_READ_EFFECTS],
    agent: true,
    handler: listCustomersHandler,
  }),
  getCustomer: defineFn({
    input: { id: 'id' },
    effects: [...CUSTOMER_READ_EFFECTS],
    agent: true,
    handler: getCustomerHandler,
  }),
  getCustomerCredit: defineFn({
    input: { partnerId: 'id', orderId: 'id?' },
    effects: [...CUSTOMER_READ_EFFECTS],
    agent: true,
    handler: getCustomerCreditHandler,
  }),
  getCustomerChoices: defineFn({
    input: {},
    effects: [...USER_EFFECTS, 'read:pricing.Pricelist', 'read:account.PaymentTerm'],
    agent: true,
    handler: getCustomerChoicesHandler,
  }),
  saveCustomer: defineFn({
    input: {
      id: 'id',
      expectedRevision: 'int',
      kind: 'text',
      name: 'text',
      ref: 'text?',
      vat: 'text?',
      phone: 'text?',
      email: 'text?',
      salespersonId: 'id?',
      pricelistId: 'id?',
    },
    effects: [
      ...CUSTOMER_READ_EFFECTS,
      ...USER_EFFECTS,
      'write:partner.Partner',
      'write:partner.Role',
      'write:sale.CustomerTerms',
    ],
    idempotent: true,
    agent: true,
    handler: saveCustomerHandler,
  }),
  saveCustomerCredit: defineFn({
    input: { partnerId: 'id', expectedRevision: 'int', creditLimit: 'text?', paymentTermId: 'id?' },
    effects: [...CUSTOMER_READ_EFFECTS, 'write:partner.CompanyTerms', 'write:sale.CustomerTerms'],
    idempotent: true,
    agent: true,
    handler: saveCustomerCreditHandler,
  }),
}
