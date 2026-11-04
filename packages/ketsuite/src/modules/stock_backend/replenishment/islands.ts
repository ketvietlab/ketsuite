import { defineIsland } from '@ketvietlab/ketjs-view'
import type { ReplenishmentProps } from './shared.ts'
import { replenishmentControls, replenishmentResults, replenishmentFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json', search: 'json' } as const
const island = (name: string, view: typeof replenishmentControls) =>
  defineIsland<ReplenishmentProps>()({
    props,
    key: ['key'],
    client: 'replenishment-list.mjs',
    export: name,
    view,
  })
export const replenishmentIslands = {
  'stock.replenishment-controls': island('replenishmentControls', replenishmentControls),
  'stock.replenishment-results': island('replenishmentResults', replenishmentResults),
  'stock.replenishment-footer': island('replenishmentFooter', replenishmentFooter),
}
