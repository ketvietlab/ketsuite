import { defineIsland } from '@ketvietlab/ketjs-view'
import type { Props } from './shared.ts'
import { customerControls, customerResults, customerFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', search: 'json', labels: 'json' } as const
const island = (name: string, view: (props: Props) => ReturnType<typeof customerControls>) =>
  defineIsland<Props>()({ props, key: ['key'], client: 'sale-customer-list.mjs', export: name, view })
export const customerIslands = {
  'sale.customer-list-controls': island('customerControls', customerControls),
  'sale.customer-list-results': island('customerResults', customerResults),
  'sale.customer-list-footer': island('customerFooter', customerFooter),
}
