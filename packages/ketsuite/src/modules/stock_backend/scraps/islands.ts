import { defineIsland } from '@ketvietlab/ketjs-view'
import type { ScrapProps } from './shared.ts'
import { scrapControls, scrapResults, scrapFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json', search: 'json' } as const
const island = (name: string, view: typeof scrapControls) =>
  defineIsland<ScrapProps>()({
    props,
    key: ['key'],
    client: 'scrap-list.mjs',
    export: name,
    view,
  })
export const scrapIslands = {
  'stock.scrap-controls': island('scrapControls', scrapControls),
  'stock.scrap-results': island('scrapResults', scrapResults),
  'stock.scrap-footer': island('scrapFooter', scrapFooter),
}
