import { defineIsland } from '@ketvietlab/ketjs-view'
import type { Props } from './shared.ts'
import { templateControls, templateResults, templateFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', search: 'json', labels: 'json' } as const
const island = (name: string, view: (props: Props) => ReturnType<typeof templateControls>) =>
  defineIsland<Props>()({ props, key: ['key'], client: 'template-list.mjs', export: name, view })
export const templateIslands = {
  'sale-template.list-controls': island('templateControls', templateControls),
  'sale-template.list-results': island('templateResults', templateResults),
  'sale-template.list-footer': island('templateFooter', templateFooter),
}
