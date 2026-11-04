import { defineIsland } from '@ketvietlab/ketjs-view'
import type { TagProps } from './shared.ts'
import { tagControls, tagResults, tagFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json' } as const
const island = (name: string, view: typeof tagControls) =>
  defineIsland<TagProps>()({ props, key: ['key'], client: 'tag-list.mjs', export: name, view })
export const tagIslands = {
  'product.tag-controls': island('tagControls', tagControls),
  'product.tag-results': island('tagResults', tagResults),
  'product.tag-footer': island('tagFooter', tagFooter),
}
