import { defineIsland } from '@ketvietlab/ketjs-view'
import type { CategoryProps } from './shared.ts'
import { categoryControls, categoryResults, categoryFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json' } as const
const island = (name: string, view: typeof categoryControls) =>
  defineIsland<CategoryProps>()({ props, key: ['key'], client: 'category-list.mjs', export: name, view })
export const categoryIslands = {
  'product.category-controls': island('categoryControls', categoryControls),
  'product.category-results': island('categoryResults', categoryResults),
  'product.category-footer': island('categoryFooter', categoryFooter),
}
