import { defineIsland } from '@ketvietlab/ketjs-view'
import type { ValuationProps } from './shared.ts'
import { valuationControls, valuationResults, valuationFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json', search: 'json' } as const
const island = (name: string, view: typeof valuationControls) =>
  defineIsland<ValuationProps>()({
    props,
    key: ['key'],
    client: 'valuation-list.mjs',
    export: name,
    view,
  })
export const valuationIslands = {
  'stock.valuation-controls': island('valuationControls', valuationControls),
  'stock.valuation-results': island('valuationResults', valuationResults),
  'stock.valuation-footer': island('valuationFooter', valuationFooter),
}
