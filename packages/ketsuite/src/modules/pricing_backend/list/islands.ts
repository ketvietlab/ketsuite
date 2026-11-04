import { defineIsland } from '@ketvietlab/ketjs-view'
import type { Props } from './shared.ts'
import { pricelistControls, pricelistResults, pricelistFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', search: 'json', labels: 'json' } as const
const island = (name: string, view: (props: Props) => ReturnType<typeof pricelistControls>) =>
  defineIsland<Props>()({ props, key: ['key'], client: 'pricelist-list.mjs', export: name, view })
export const pricelistIslands = {
  'pricing.list-controls': island('pricelistControls', pricelistControls),
  'pricing.list-results': island('pricelistResults', pricelistResults),
  'pricing.list-footer': island('pricelistFooter', pricelistFooter),
}
