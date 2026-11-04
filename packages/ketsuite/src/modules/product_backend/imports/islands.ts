import { defineIsland } from '@ketvietlab/ketjs-view'
import type { ImportProps } from './shared.ts'
import { importControls, importResults, importFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json' } as const
const island = (name: string, view: typeof importControls) =>
  defineIsland<ImportProps>()({ props, key: ['key'], client: 'import-list.mjs', export: name, view })
export const importIslands = {
  'product.import-controls': island('importControls', importControls),
  'product.import-results': island('importResults', importResults),
  'product.import-footer': island('importFooter', importFooter),
}
