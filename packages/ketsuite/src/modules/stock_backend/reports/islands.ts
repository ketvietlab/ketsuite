import { defineIsland } from '@ketvietlab/ketjs-view'
import type { ReportProps } from './shared.ts'
import { stockReportControls, stockReportResults, stockReportFooter } from './island.tsx'
const props = {
  key: 'text',
  report: 'text',
  source: 'text',
  query: 'json',
  labels: 'json',
  search: 'json',
  columns: 'json',
} as const
const island = (name: string, view: typeof stockReportControls) =>
  defineIsland<ReportProps>()({
    props,
    key: ['key'],
    client: 'stock-report-list.mjs',
    export: name,
    view,
  })
export const stockReportIslands = {
  'stock.report-controls': island('stockReportControls', stockReportControls),
  'stock.report-results': island('stockReportResults', stockReportResults),
  'stock.report-footer': island('stockReportFooter', stockReportFooter),
}
