import { chargeRuleContextRequest } from './screens/charge-rule-context-request.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { billingRequestBillingRulesRequest } from './screens/billing-rules-request.tsx'
import { billingRequestBillingRequest } from './screens/billing-request.tsx'
export const routes: Record<string, RouteEntry> = {
  '/admin/hospitality/billing/rules/{id}/record-context': chargeRuleContextRequest,
  '/admin/hospitality/billing/rules': billingRequestBillingRulesRequest,
  '/admin/hospitality/billing': billingRequestBillingRequest,
}
