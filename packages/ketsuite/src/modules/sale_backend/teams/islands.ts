import { defineIsland } from '@ketvietlab/ketjs-view'
import type { TeamProps } from './shared.ts'
import { teamControls, teamResults, teamFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json' } as const
const island = (name: string, view: typeof teamControls) =>
  defineIsland<TeamProps>()({ props, key: ['key'], client: 'sale-team-list.mjs', export: name, view })
export const saleTeamIslands = {
  'sale.team-controls': island('teamControls', teamControls),
  'sale.team-results': island('teamResults', teamResults),
  'sale.team-footer': island('teamFooter', teamFooter),
}
