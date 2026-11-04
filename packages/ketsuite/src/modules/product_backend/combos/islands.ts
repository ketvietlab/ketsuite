import { defineIsland } from '@ketvietlab/ketjs-view'
import type { ComboProps } from './shared.ts'
import { comboControls, comboResults, comboFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json' } as const
const island = (name: string, view: typeof comboControls) =>
  defineIsland<ComboProps>()({ props, key: ['key'], client: 'combo-list.mjs', export: name, view })
export const comboIslands = {
  'product.combo-controls': island('comboControls', comboControls),
  'product.combo-results': island('comboResults', comboResults),
  'product.combo-footer': island('comboFooter', comboFooter),
}
