import { defineIsland } from '@ketvietlab/ketjs-view'
import type { ForecastProps } from './shared.ts'
import { forecastControls, forecastResults, forecastFooter } from './island.tsx'
const props = { key: 'text', source: 'text', query: 'json', labels: 'json', search: 'json' } as const
const island = (name: string, view: typeof forecastControls) =>
  defineIsland<ForecastProps>()({
    props,
    key: ['key'],
    client: 'forecast-list.mjs',
    export: name,
    view,
  })
export const forecastIslands = {
  'stock.forecast-controls': island('forecastControls', forecastControls),
  'stock.forecast-results': island('forecastResults', forecastResults),
  'stock.forecast-footer': island('forecastFooter', forecastFooter),
}
