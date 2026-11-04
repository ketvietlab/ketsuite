import { defineIsland } from '@ketvietlab/ketjs-view'
import type { PolicyProps } from './shared.ts'
import { policyControls, policyResults, policyFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json' } as const
const island = (name: string, view: typeof policyControls) =>
  defineIsland<PolicyProps>()({ props, key: ['key'], client: 'sale-policy-list.mjs', export: name, view })
export const salePolicyIslands = {
  'sale.policy-controls': island('policyControls', policyControls),
  'sale.policy-results': island('policyResults', policyResults),
  'sale.policy-footer': island('policyFooter', policyFooter),
}
