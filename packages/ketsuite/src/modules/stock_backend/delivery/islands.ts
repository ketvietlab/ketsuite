import { defineIsland } from '@ketvietlab/ketjs-view'
import type { DeliveryProps } from './shared.ts'
import { deliveryControls, deliveryResults, deliveryFooter } from './island.tsx'
const props = {
  key: 'text',
  list: 'text',
  path: 'text',
  source: 'text',
  query: 'json',
  columns: 'json',
  labels: 'json',
  search: 'json',
  bulk: 'json?',
} as const
const island = (name: string, view: typeof deliveryControls) =>
  defineIsland<DeliveryProps>()({
    props,
    key: ['key'],
    client: 'delivery-list.mjs',
    export: name,
    view,
  })
export const deliveryIslands = {
  'stock.delivery-controls': island('deliveryControls', deliveryControls),
  'stock.delivery-results': island('deliveryResults', deliveryResults),
  'stock.delivery-footer': island('deliveryFooter', deliveryFooter),
}
