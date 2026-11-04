import { defineIsland } from '@ketvietlab/ketjs-view'
import type { Props } from './shared.ts'
import { promotionControls, promotionResults, promotionFooter } from './island.tsx'
const props = {
  mode: 'text',
  key: 'text',
  source: 'text',
  query: 'json',
  search: 'json',
  labels: 'json',
} as const
const island = (name: string, view: (props: Props) => ReturnType<typeof promotionControls>) =>
  defineIsland<Props>()({ props, key: ['key'], client: 'promotion-list.mjs', export: name, view })
export const promotionIslands = {
  'sale-promotion.list-controls': island('promotionControls', promotionControls),
  'sale-promotion.list-results': island('promotionResults', promotionResults),
  'sale-promotion.list-footer': island('promotionFooter', promotionFooter),
}
