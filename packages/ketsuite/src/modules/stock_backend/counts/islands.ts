import { defineIsland } from '@ketvietlab/ketjs-view'
import type { CountProps } from './shared.ts'
import { countControls, countResults, countFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json', search: 'json' } as const
const island = (name: string, view: typeof countControls) =>
  defineIsland<CountProps>()({
    props,
    key: ['key'],
    client: 'count-list.mjs',
    export: name,
    view,
  })
export const countIslands = {
  'stock.count-controls': island('countControls', countControls),
  'stock.count-results': island('countResults', countResults),
  'stock.count-footer': island('countFooter', countFooter),
}
