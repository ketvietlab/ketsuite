import { deskBookingBillingFunctions } from './functions/desk-booking.ts'
import { folioFinanceWorkspaceFunctions } from './functions/folio-workspace.ts'
import { frontDeskBillingFunctions } from './functions/front-desk.ts'
import { reservationArrivalFunctions } from './functions/reservation-arrival.ts'
import { chargeRuleRecordFunctions } from './functions/charge-rule-record.ts'
import { guaranteeWorkbenchFunctions } from './functions/guarantee-workbench.ts'
import { billingAuditFunctions, billingAuditJobs } from './functions/night-audit.ts'
import { islands } from './islands.ts'
import { defineModule } from '@ketvietlab/ketjs'
import { billingCollectionFunctions } from './functions/collection-search.ts'
import { billingBookFunctions } from './functions/billing-book.ts'
import { reservationGuaranteeFunctions } from './functions/reservation-guarantee.ts'
import { functions } from './functions.ts'
import { searchFilterFunctions } from './search-functions.ts'
import { billingJobFunctions, billingJobs } from './jobs.ts'
import { menus } from './menus.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'hospitality_billing',
  version: '0.1.0',
  // `backend` for the settings screen, and both sides of the seam this module
  // exists to close. It is optional on purpose: a property that bills outside
  // KetSuite installs hospitality_core without it.
  depends: ['backend', 'hospitality_core', 'account', 'partner', 'company', 'product', 'uom'],
  // Authorization reads the user module's grants.
  optional: ['user'],
  title: 'Thanh toán khách sạn',
  summary: 'Xuất hoá đơn cho hồ sơ dịch vụ đã đóng và ghi nhận tiền khách đã trả.',
  category: 'Khách sạn',
  models,
  functions: {
    ...functions,
    ...deskBookingBillingFunctions,
    ...folioFinanceWorkspaceFunctions,
    ...frontDeskBillingFunctions,
    ...reservationArrivalFunctions,
    ...chargeRuleRecordFunctions,
    ...guaranteeWorkbenchFunctions,
    ...billingAuditFunctions,
    ...billingJobFunctions,
    ...searchFilterFunctions,
    ...reservationGuaranteeFunctions,
    ...billingCollectionFunctions,
    ...billingBookFunctions,
  },
  jobs: { ...billingJobs, ...billingAuditJobs },
  islands,
  assets: new URL('./client/', import.meta.url),
  fills: { 'backend:runtime': '{% island "hospitality.billingRule-modal" %}' },
  routes,
  menus,
  messages,
})
