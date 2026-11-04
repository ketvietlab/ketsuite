import { defineModule } from '@ketvietlab/ketjs'
import { models } from './models.ts'
import { functions } from './functions/index.ts'
import { messages } from './messages.ts'
import { withOrderHistory } from '../sale/order-history.ts'
export default defineModule({
  name: 'sale_template',
  version: '0.1.0',
  depends: ['sale', 'crm', 'user'],
  title: 'Sales templates',
  summary: 'Reusable quotation and section templates with team access.',
  category: 'Sales',
  models,
  functions: withOrderHistory(functions),
  messages,
  extend: {
    'sale.Order': {
      templateSignature: 'bool?',
      templatePayment: 'bool?',
      templatePrepaymentPercent: 'decimal?',
    },
  },
})
