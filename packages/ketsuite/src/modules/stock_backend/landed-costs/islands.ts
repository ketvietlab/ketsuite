import { defineIsland } from '@ketvietlab/ketjs-view'
import type { LandedCostProps } from './shared.ts'
import { landedCostControls, landedCostResults, landedCostFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json', search: 'json' } as const
const island = (name: string, view: typeof landedCostControls) =>
  defineIsland<LandedCostProps>()({
    props,
    key: ['key'],
    client: 'landed-cost-list.mjs',
    export: name,
    view,
  })
export const landedCostIslands = {
  'stock.landed-cost-controls': island('landedCostControls', landedCostControls),
  'stock.landed-cost-results': island('landedCostResults', landedCostResults),
  'stock.landed-cost-footer': island('landedCostFooter', landedCostFooter),
}
