import { replenishmentIslands } from './replenishment/islands.ts'
import { forecastIslands } from './forecast/islands.ts'
import { valuationIslands } from './valuation/islands.ts'
import { stockReportIslands } from './reports/islands.ts'
import { scrapIslands } from './scraps/islands.ts'
import { landedCostIslands } from './landed-costs/islands.ts'
import { deliveryIslands } from './delivery/islands.ts'
import { countIslands } from './counts/islands.ts'
import { stockSearchIslands } from './search/islands.ts'
import { defineRecordModalIsland, defineRecordPageIsland } from '../../ui/record-modal.tsx'
import { defineIsland, html, signal } from '@ketvietlab/ketjs-view'
import { createStockEditorStatusView } from './client/editor-view.mjs'

const runtime = { html, signal }

type StockEditorProps = { identity: string; pickingId?: string; lotId?: string; lang?: string }

export const islands = {
  ...replenishmentIslands,
  ...forecastIslands,
  ...valuationIslands,
  ...stockReportIslands,
  ...scrapIslands,
  ...landedCostIslands,
  ...deliveryIslands,
  ...countIslands,
  ...stockSearchIslands,
  'stock.replenishment-page': defineRecordPageIsland({
    kind: 'stock.replenishment',
    client: 'stock-configuration-modal.mjs',
    export: 'replenishmentPage',
  }),
  'stock.lot-page': defineRecordPageIsland({
    kind: 'stock.lot',
    client: 'stock-configuration-modal.mjs',
    export: 'lotPage',
  }),
  // A transfer's own page (`/admin/stock/transfers/{id}`, `new` to create): the server renders the
  // RecordPage loading and the client renders the transfer (modal/transfer-view.tsx).
  'stock.transfer-page': defineRecordPageIsland({
    kind: 'stock.transfer',
    client: 'stock-transfer-modal.mjs',
    export: 'transferPage',
  }),
  // K64: a landed cost's own page (`/admin/stock/landed-costs/{id}`, `new` to create).
  'stock.landed-cost-page': defineRecordPageIsland({
    kind: 'stock.landedCost',
    client: 'stock-landed-cost.mjs',
    export: 'landedCostPage',
  }),
  // K46, K47: a shipment's and a carrier statement's own pages.
  'stock.shipment-page': defineRecordPageIsland({
    kind: 'stock.shipment',
    client: 'stock-shipment.mjs',
    export: 'shipmentPage',
  }),
  'stock.delivery-statement-page': defineRecordPageIsland({
    kind: 'stock.deliveryStatement',
    client: 'stock-delivery-statement.mjs',
    export: 'deliveryStatementPage',
  }),
  'stock.lot-modal': defineRecordModalIsland({
    kind: 'stock.lot',
    client: 'stock-configuration-modal.mjs',
    export: 'lotModal',
  }),
  'stock.route-modal': defineRecordModalIsland({
    kind: 'stock.route',
    client: 'stock-configuration-modal.mjs',
    export: 'stockRouteModal',
  }),
  'stock.replenishment-modal': defineRecordModalIsland({
    kind: 'stock.replenishment',
    client: 'stock-configuration-modal.mjs',
    export: 'replenishmentModal',
  }),
  'stock.scrap-modal': defineRecordModalIsland({
    kind: 'stock.scrap',
    client: 'stock-scrap-modal.mjs',
    export: 'scrapModal',
  }),
  'stock.count-session-modal': defineRecordModalIsland({
    kind: 'stock.countSession',
    client: 'stock-count-session-modal.mjs',
    export: 'countSessionModal',
  }),
  'stock.count-modal': defineRecordModalIsland({
    kind: 'stock.count',
    client: 'inventory-count-modal.mjs',
    export: 'inventoryCountModal',
  }),
  // K45: a carrier's record, from Settings › Inventory › Carriers.
  'stock.carrier-modal': defineRecordModalIsland({
    kind: 'stock.carrier',
    client: 'stock-configuration-modal.mjs',
    export: 'carrierModal',
  }),
  'stock.warehouse-modal': defineRecordModalIsland({
    kind: 'stock.warehouse',
    client: 'stock-configuration-modal.mjs',
    export: 'warehouseModal',
  }),
  'stock.location-modal': defineRecordModalIsland({
    kind: 'stock.location',
    client: 'stock-configuration-modal.mjs',
    export: 'locationModal',
  }),
  'stock.picking-type-modal': defineRecordModalIsland({
    kind: 'stock.pickingType',
    client: 'stock-configuration-modal.mjs',
    export: 'pickingTypeModal',
  }),
  'stock.editor': defineIsland<StockEditorProps>()({
    props: { identity: 'text', pickingId: 'id?', lotId: 'id?', lang: 'text?' },
    key: ['identity'],
    view: (props) => createStockEditorStatusView(runtime, props),
  }),
}
