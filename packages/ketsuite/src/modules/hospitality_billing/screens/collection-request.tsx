import { renderHospitalityCollection } from '../../hospitality_core/screens/collection-page.tsx'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { chargeRuleCollection } from '../functions/collection-search.ts'
// Every charge type is a row, so a rule is set up by opening its row: the list has no create button (HOS-DEC-034).
// The old `?create=1` link still opens the rule modal on a type of the reader's choosing.
export const billingRuleCollectionRequest: (ctx: ServeContext) => Route = (ctx) => (url, req) =>
  renderHospitalityCollection(ctx, url, req, {
    id: 'billing-rules',
    namespace: 'hospitality_billing',
    collection: chargeRuleCollection,
    fn: 'searchChargeRules',
    path: '/admin/hospitality/billing/rules',
    title: 'chargeRules.title',
    searchLabel: 'chargeRules.search',
    recordKind: 'hospitality.billingRule',
    recordParam: 'rule',
    recordIdField: 'chargeType',
    recordQuery: { create: '1' },
    statePrefix: 'collection.state',
    columns: [
      { key: 'type', field: 'chargeType', label: 'hospitality_billing.chargeRules.column.type' },
      {
        key: 'income',
        field: 'incomeAccount',
        label: 'hospitality_billing.chargeRules.column.account',
        empty: 'chargeRules.inherit',
      },
      {
        key: 'tax',
        field: 'tax',
        label: 'hospitality_billing.chargeRules.column.tax',
        empty: { field: 'taxExempt', values: { true: 'ruleRecord.exempt', false: 'chargeRules.taxUnset' } },
      },
      {
        key: 'state',
        field: 'state',
        label: 'state',
        kind: 'state',
        tones: { incomplete: 'warning', ready: 'positive' },
      },
    ],
  })
