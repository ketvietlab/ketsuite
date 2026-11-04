import { encodeListState } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { lotCondition } from './screens/lots-list.tsx'

const DAY = 86_400_000
const OPEN = ['draft', 'waiting', 'confirmed', 'partially_available', 'assigned']
const WAITING = ['waiting', 'confirmed', 'partially_available']

/** What the overview reads; a list the reader may not read is `null`, and its tile is left out. */
export type OverviewSource = {
  pickings: Row[]
  pickingTypes: Row[]
  warehouses: Row[]
  locations: Row[]
  quants: Row[] | null
  lots: Row[] | null
  counts: Row[] | null
  orderpoints: Row[] | null
  /** `stock.listValuation` total value per warehouse id, `''` for all of them; `null` when not readable. */
  values: Record<string, string> | null
}
export type OverviewTile = { id: string; value: number | string; href: string | null; detail?: number }
export type OverviewWarehouseRow = {
  id: string
  name: string
  products: number
  receipts: number
  deliveries: number
  late: number
  toOrder: number | null
  value: string | null
}
export type OverviewFigures = {
  tiles: OverviewTile[]
  warehouses: OverviewWarehouseRow[]
  /** K51: confirmed transfers late or due within 7 days, the latest-due last. */
  todo: Row[]
}

/** A list path narrowed to one warehouse's name with the list's own filter, plus its presets. */
const listHref = (
  path: string,
  presets: string[],
  filter?: { field: string; operator: string; value: string },
) =>
  encodeListState(
    {
      q: '',
      presets,
      filters: filter ? [{ kind: 'rule', ...filter }] : [],
      groupBy: [],
      sort: [],
      openGroups: [],
      groupPages: {},
      page: 1,
      includeArchived: false,
      favoriteId: null,
    } as never,
    path,
  )

/**
 * K51: the stock overview's figures for one warehouse (`''` for all), each the same number its list shows
 * once opened through the tile's link.
 */
export function overviewFigures(source: OverviewSource, warehouseId: string, now: number): OverviewFigures {
  const typeById = new Map(source.pickingTypes.map((row) => [String(row.id), row]))
  const warehouseOf = (picking: Row) => String(typeById.get(String(picking.pickingTypeId))?.warehouseId ?? '')
  const kindOf = (picking: Row) => String(typeById.get(String(picking.pickingTypeId))?.code ?? '')
  const inWarehouse = (id: string) => !warehouseId || id === warehouseId
  const warehouseName = (id: string) =>
    String(source.warehouses.find((row) => String(row.id) === id)?.name ?? id)
  const named = warehouseId ? warehouseName(warehouseId) : ''
  const narrowed = (field: string, operator = 'equals') =>
    named ? { field, operator, value: named } : undefined
  const time = (value: unknown) => {
    const ms = Date.parse(String(value ?? ''))
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
  }
  const pickings = source.pickings.filter((row) => OPEN.includes(String(row.state)))
  const late = (row: Row) => row.state !== 'draft' && time(row.scheduledDate) < now
  const of = (id: string, kind: string, states: string[]) =>
    pickings.filter(
      (row) => warehouseOf(row) === id && kindOf(row) === kind && states.includes(String(row.state)),
    )
  const here = (kind: string, states: string[]) =>
    pickings.filter(
      (row) => inWarehouse(warehouseOf(row)) && kindOf(row) === kind && states.includes(String(row.state)),
    )
  const location = new Map(source.locations.map((row) => [String(row.id), row]))
  const stockedIn = (quant: Row) => {
    const at = location.get(String(quant.locationId))
    return at && ['internal', 'transit'].includes(String(at.usage)) ? String(at.warehouseId ?? '') : null
  }
  const lotStock = new Map<string, number>()
  for (const quant of source.quants ?? []) {
    const warehouse = stockedIn(quant)
    if (warehouse === null || !quant.lotId || !inWarehouse(warehouse)) continue
    lotStock.set(String(quant.lotId), (lotStock.get(String(quant.lotId)) ?? 0) + Number(quant.quantity ?? 0))
  }
  // A lot none of which is in the chosen warehouse reads as used up there, so neither expiring nor expired.
  const condition = (lot: Row) => lotCondition(lot, lotStock.get(String(lot.id)) ?? 0, now)
  const lots = source.lots ?? []
  const toOrder = (rows: Row[]) => rows.filter((row) => Number(row.toOrder) > 0)
  const tile = (id: string, value: number, href: string, detail?: number): OverviewTile => ({
    id,
    value,
    href: value ? href : null,
    ...(detail === undefined ? {} : { detail }),
  })
  const waiting = here('outgoing', WAITING)
  const tiles: OverviewTile[] = [
    // Every open receipt: once confirmed it reads as ready to receive (K18), in the list's `ready` preset.
    tile(
      'receiptsOpen',
      here('incoming', [...WAITING, 'assigned']).length,
      listHref('/admin/stock/transfers', ['receipts', 'waiting', 'ready'], narrowed('warehouse')),
    ),
    tile(
      'deliveriesReady',
      here('outgoing', ['assigned']).length,
      listHref('/admin/stock/transfers', ['deliveries', 'ready'], narrowed('warehouse')),
    ),
    tile(
      'deliveriesWaiting',
      waiting.length,
      listHref('/admin/stock/transfers', ['deliveries', 'waiting'], narrowed('warehouse')),
      waiting.filter(late).length,
    ),
    ...(source.orderpoints
      ? [
          tile(
            'toOrder',
            toOrder(source.orderpoints.filter((row) => !named || row.warehouse === named)).length,
            listHref('/admin/stock/replenishment', ['toOrder'], narrowed('warehouse')),
          ),
        ]
      : []),
    ...(source.lots && source.quants
      ? [
          tile(
            'lotsExpiring',
            lots.filter((lot) => condition(lot) === 'expiring').length,
            listHref('/admin/stock/lots', ['expiring'], narrowed('warehouses', 'contains')),
            lots.filter((lot) => condition(lot) === 'expired').length,
          ),
        ]
      : []),
    ...(source.counts
      ? [
          tile(
            'countsReview',
            source.counts.filter(
              (row) => row.state === 'review' && inWarehouse(String(row.warehouseId ?? '')),
            ).length,
            listHref(
              `/admin/stock/counts${warehouseId ? `?warehouse=${encodeURIComponent(warehouseId)}` : ''}`,
              ['review'],
            ),
          ),
        ]
      : []),
  ]
  const value = source.values?.[warehouseId]
  if (source.values && value !== undefined)
    tiles.push({
      id: 'value',
      value,
      href: `/admin/stock/valuation${warehouseId ? `?warehouse=${encodeURIComponent(warehouseId)}` : ''}`,
    })
  const products = (id: string) =>
    new Set(
      (source.quants ?? [])
        .filter((quant) => stockedIn(quant) === id && Number(quant.quantity) > 0)
        .map((quant) => String(quant.productId)),
    ).size
  const warehouses = source.warehouses
    .filter((row) => inWarehouse(String(row.id)))
    .map((row) => {
      const id = String(row.id)
      const open = pickings.filter((picking) => warehouseOf(picking) === id)
      return {
        id,
        name: String(row.name),
        products: products(id),
        receipts: of(id, 'incoming', OPEN).length,
        deliveries: of(id, 'outgoing', OPEN).length,
        late: open.filter(late).length,
        toOrder: source.orderpoints
          ? toOrder(source.orderpoints.filter((point) => point.warehouse === String(row.name))).length
          : null,
        value: source.values ? (source.values[id] ?? null) : null,
      }
    })
  const todo = pickings
    .filter(
      (row) =>
        row.state !== 'draft' && inWarehouse(warehouseOf(row)) && time(row.scheduledDate) < now + 7 * DAY,
    )
    .sort(
      (a, b) => time(a.scheduledDate) - time(b.scheduledDate) || String(a.name).localeCompare(String(b.name)),
    )
    .map((row) => ({ ...row, late: late(row) }))
  return { tiles, warehouses, todo }
}
