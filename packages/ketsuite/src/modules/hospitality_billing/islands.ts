import { defineIsland } from '@ketvietlab/ketjs-view'
import { defineRecordModalIsland } from '../../ui/record-modal.tsx'
import type { BillingBookProps } from './collections/billing-book.tsx'
import { billingBookControls, billingBookFooter, billingBookResults } from './collections/billing-book.tsx'

const billingProps = {
  key: 'text',
  id: 'text',
  source: 'text',
  path: 'text',
  recordPath: 'text',
  foliosHref: 'text?',
  lang: 'text',
  allowed: 'bool',
  may: 'json',
  properties: 'json',
  query: 'json',
  words: 'json',
} as const

export const islands = {
  'hospitality.billingRule-modal': defineRecordModalIsland({
    kind: 'hospitality.billingRule',
    client: 'charge-rule-modal.mjs',
    export: 'chargeRuleModal',
  }),
  // The billing list (HOS-UI-020): controls, rows and pager on one paged store.
  'hospitality.billing-controls': defineIsland<BillingBookProps>()({
    props: billingProps,
    key: ['key'],
    client: 'billing-book.mjs',
    export: 'billingBookControls',
    view: (input) => billingBookControls(input).view,
  }),
  'hospitality.billing-results': defineIsland<BillingBookProps>()({
    props: billingProps,
    key: ['key'],
    client: 'billing-book.mjs',
    export: 'billingBookResults',
    view: (input) => billingBookResults(input).view,
  }),
  'hospitality.billing-footer': defineIsland<BillingBookProps>()({
    props: billingProps,
    key: ['key'],
    client: 'billing-book.mjs',
    export: 'billingBookFooter',
    view: (input) => billingBookFooter(input).view,
  }),
}
