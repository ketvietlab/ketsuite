import { defineIsland } from '@ketvietlab/ketjs-view'
import type { SearchProps } from './shared.ts'
import { searchControls, searchResults, searchFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json' } as const
const island = (name: string, view: typeof searchControls) =>
  defineIsland<SearchProps>()({ props, key: ['key'], client: 'stock-search.mjs', export: name, view })
export const stockSearchIslands = {
  'stock.search-controls': island('searchControls', searchControls),
  'stock.search-results': island('searchResults', searchResults),
  'stock.search-footer': island('searchFooter', searchFooter),
}
