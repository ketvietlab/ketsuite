import { defineIsland } from '@ketvietlab/ketjs-view'
import type { TagProps } from './shared.ts'
import { tagControls, tagResults, tagFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json' } as const
const island = (name: string, view: typeof tagControls) =>
  defineIsland<TagProps>()({ props, key: ['key'], client: 'sale-tag-list.mjs', export: name, view })
export const saleTagIslands = {
  'sale.tag-controls': island('tagControls', tagControls),
  'sale.tag-results': island('tagResults', tagResults),
  'sale.tag-footer': island('tagFooter', tagFooter),
}
