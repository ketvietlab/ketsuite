import type { Ctx, Row } from '@ketvietlab/ketjs'
import { reservesStock } from '../../stock/reservation-policy.ts'
import { transferStatus } from '../transfer-status.ts'
import { effectiveFunctionKeys, AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { ours } from '../../stock/scope.ts'
import { moveKindOf } from '../../stock/analysis.ts'
import { lotCondition } from '../screens/lots-list.tsx'
import {
  SEARCH_PATH,
  SEARCH_PAGE_SIZE,
  searchQuery,
  searchHref,
  type SearchAnswer,
  type SearchKind,
  type SearchRow,
} from './shared.ts'

export const SEARCH_EFFECTS = [
  ...new Set([
    ...AUTHORIZATION_READ_EFFECTS,
    'read:stock.Picking',
    'read:stock.PickingType',
    'read:stock.Move',
    'read:stock.Location',
    'read:stock.Lot',
    'read:stock.Quant',
    'read:stock.CountSession',
    'read:stock.Orderpoint',
    'read:stock.LandedCost',
    'read:stock.Warehouse',
    'read:product.Product',
    'read:product.Template',
    'read:partner.Partner',
  ]),
]

/** Without accents or case, so "kiem ke" finds "Kiểm kê". */
const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase()

type Found = {
  recordId: string
  kind: SearchKind
  name: string
  subject: string
  origin: string
  state: string
  haystack: string
  path: string
  modal?: string
  sort: string
}
/** Transfers and counts come newest first, lots and rules by name. */
type Provider = { grants: readonly string[]; read: () => Promise<Found[]>; order: 'newest' | 'name' }

/**
 * K55: one bounded page across the transfers, lots, counts and replenishment rules the viewer may read, in
 * every state and period and every warehouse, by number, code, name and source document.
 */
export async function readStockSearch(ctx: Ctx, args: Row): Promise<SearchAnswer> {
  const requested = new URL(String(args.href ?? SEARCH_PATH), 'http://ket.local')
  if (typeof args.q === 'string') requested.searchParams.set('q', args.q)
  if (args.page != null) requested.searchParams.set('page', String(args.page))
  if (ctx.scope.company) requested.searchParams.set('company', ctx.scope.company)
  const query = searchQuery(requested)
  const empty = {
    query: { ...query, page: 1, href: searchHref(query.href, { page: null }) },
    rows: [],
    total: 0,
    page: 1,
    pages: 1,
    counts: {},
    isEmpty: true,
  }
  if (!query.q || !ctx.actor || !ctx.scope.company) return empty
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  const may = (fn: string) =>
    Boolean(ctx.manifest.functions[fn]) && (allowed === null || allowed.includes(fn))
  const byId = (rows: Row[]) => new Map(rows.map((row) => [String(row.id), row]))
  const once = <T>(read: () => Promise<T>) => {
    let held: Promise<T> | undefined
    return () => (held ??= read())
  }
  const products = once(async () => {
    const [variants, templates] = await Promise.all([
      ctx.db.select('product.Product'),
      ctx.db.select('product.Template'),
    ])
    const template = byId(templates)
    return new Map(
      variants.map((variant) => {
        const name = String(template.get(String(variant.templateId))?.name ?? variant.id)
        return [
          String(variant.id),
          { label: variant.defaultCode ? `${name} · ${String(variant.defaultCode)}` : name },
        ]
      }),
    )
  })
  const locations = once(async () => byId(await ours(ctx, 'stock.Location')))
  const warehouses = once(async () => byId(await ours(ctx, 'stock.Warehouse')))
  const productOf = async (id: unknown) => (await products()).get(String(id))?.label ?? String(id ?? '')
  const warehouseOf = async (id: unknown) => {
    const warehouse = (await warehouses()).get(String(id))
    return warehouse ? `${String(warehouse.name)}${warehouse.code ? ` (${String(warehouse.code)})` : ''}` : ''
  }

  const pickings = async (): Promise<Found[]> => {
    const [rows, types, moves, partners, location] = await Promise.all([
      ours(ctx, 'stock.Picking'),
      ours(ctx, 'stock.PickingType'),
      ours(ctx, 'stock.Move'),
      ctx.db.select('partner.Partner'),
      locations(),
    ])
    const type = byId(types),
      partner = byId(partners),
      movesOf = new Map<string, Row[]>()
    for (const move of moves)
      movesOf.set(String(move.pickingId), [...(movesOf.get(String(move.pickingId)) ?? []), move])
    return Promise.all(
      rows.map(async (row) => {
        const own = movesOf.get(String(row.id)) ?? []
        // A direct on-hand adjustment marks its move `inventory`, which names no document.
        const origins = [
          ...new Set(own.map((move) => move.origin).filter((origin) => origin && origin !== 'inventory')),
        ].map(String)
        const goods = [...new Set(await Promise.all(own.map((move) => productOf(move.productId))))]
        const who = row.partnerId ? String(partner.get(String(row.partnerId))?.name ?? '') : ''
        return {
          recordId: String(row.id),
          kind: moveKindOf(
            own[0] ?? {},
            type.get(String(row.pickingTypeId)),
            location.get(String(row.locationId)),
            location.get(String(row.locationDestId)),
          ) as SearchKind,
          name: String(row.name),
          subject: who || goods.join(', '),
          origin: origins.join(', '),
          state: `state.${transferStatus(row.state, reservesStock(type.get(String(row.pickingTypeId))))}`,
          haystack: [row.name, who, ...origins, ...goods].join(' '),
          path: `/admin/stock/transfers/${encodeURIComponent(String(row.id))}`,
          sort: String(row.dateDone ?? row.scheduledDate ?? ''),
        }
      }),
    )
  }
  const lots = async (): Promise<Found[]> => {
    const [rows, quants, location] = await Promise.all([
      ours(ctx, 'stock.Lot'),
      ours(ctx, 'stock.Quant'),
      locations(),
    ])
    const onHand = new Map<string, number>()
    for (const quant of quants)
      if (
        quant.lotId &&
        ['internal', 'transit'].includes(String(location.get(String(quant.locationId))?.usage))
      )
        onHand.set(String(quant.lotId), (onHand.get(String(quant.lotId)) ?? 0) + Number(quant.quantity ?? 0))
    const now = Date.now()
    return Promise.all(
      rows.map(async (row) => {
        const product = await productOf(row.productId)
        return {
          recordId: String(row.id),
          kind: 'lot' as const,
          name: String(row.name),
          subject: product,
          origin: String(row.ref ?? ''),
          state: `lot.condition.${lotCondition(row, onHand.get(String(row.id)) ?? 0, now)}`,
          haystack: [row.name, row.ref, product].join(' '),
          path: `/admin/stock/lots/${encodeURIComponent(String(row.id))}`,
          sort: '',
        }
      }),
    )
  }
  const counts = async (): Promise<Found[]> =>
    Promise.all(
      (await ours(ctx, 'stock.CountSession')).map(async (row) => {
        const warehouse = await warehouseOf(row.warehouseId)
        return {
          recordId: String(row.id),
          kind: 'count' as const,
          name: String(row.name),
          subject: warehouse,
          origin: '',
          state: `count.state.${String(row.state)}`,
          haystack: [row.name, warehouse].join(' '),
          path: '/admin/stock/counts',
          modal: 'stock.countSession',
          sort: String(row.startedAt ?? ''),
        }
      }),
    )
  const rules = async (): Promise<Found[]> =>
    Promise.all(
      (await ours(ctx, 'stock.Orderpoint')).map(async (row) => {
        const [product, warehouse] = await Promise.all([
          productOf(row.productId),
          warehouseOf(row.warehouseId),
        ])
        return {
          recordId: String(row.id),
          kind: 'rule' as const,
          // A rule has no name of its own: the replenishment list names it by its product.
          name: product,
          subject: warehouse,
          origin: '',
          state: row.active === false ? 'search.state.archived' : 'search.state.active',
          haystack: [product, warehouse].join(' '),
          path: `/admin/stock/replenishment/${encodeURIComponent(String(row.id))}`,
          sort: '',
        }
      }),
    )
  const landedCosts = async (): Promise<Found[]> => {
    const [rows, done, partners] = await Promise.all([
      ours(ctx, 'stock.LandedCost'),
      ours(ctx, 'stock.Picking', { state: 'done' }),
      ctx.db.select('partner.Partner'),
    ])
    const receipt = byId(done),
      partner = byId(partners)
    return rows.map((row) => {
      const vendor = row.vendorId ? String(partner.get(String(row.vendorId))?.name ?? '') : ''
      const receipts = ((row.pickingIds as unknown[] | null) ?? [])
        .map((id) => String(receipt.get(String(id))?.name ?? id))
        .join(', ')
      return {
        recordId: String(row.id),
        kind: 'landedCost' as const,
        name: String(row.name),
        subject: vendor,
        // The receipts it lands on stand for its source documents.
        origin: receipts,
        state: `landedCost.state.${String(row.state)}`,
        haystack: [row.name, vendor, receipts].join(' '),
        path: `/admin/stock/landed-costs/${encodeURIComponent(String(row.id))}`,
        sort: String(row.date ?? ''),
      }
    })
  }
  // Each kind needs the read its own list makes and the one its record opens with.
  const available: Provider[] = [
    { grants: ['stock.listPickings', 'stock.getPicking'], read: pickings, order: 'newest' },
    { grants: ['stock.listLots'], read: lots, order: 'name' },
    { grants: ['stock.listCountSessions', 'stock.getCountSession'], read: counts, order: 'newest' },
    { grants: ['stock.getOrderpointCollection', 'stock.listOrderpoints'], read: rules, order: 'name' },
    { grants: ['stock.listLandedCosts', 'stock.getLandedCost'], read: landedCosts, order: 'newest' },
  ]
  const needle = fold(query.q)
  const orders = {
    newest: (a: Found, b: Found) => b.sort.localeCompare(a.sort) || b.name.localeCompare(a.name),
    name: (a: Found, b: Found) => a.name.localeCompare(b.name, 'vi') || a.recordId.localeCompare(b.recordId),
  }
  const found = (
    await Promise.all(
      available
        .filter((provider) => provider.grants.every(may))
        .map(async (provider) =>
          (
            await provider.read()
          )
            .filter((row) => fold(row.haystack).includes(needle))
            .sort(orders[provider.order]),
        ),
    )
  ).flat()
  const total = found.length,
    pages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
    page = Math.min(query.page, pages)
  const href = searchHref(query.href, { page: page > 1 ? String(page) : null })
  const context = new URL(href, 'http://ket.local')
  const rows = found.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE).map((row): SearchRow => {
    const target = new URL(row.path, context)
    for (const key of ['company', 'branch', 'lang']) {
      const value = context.searchParams.get(key)
      if (value) target.searchParams.set(key, value)
    }
    const { haystack: _haystack, path: _path, modal, sort: _sort, ...shown } = row
    return {
      ...shown,
      id: `${row.kind}:${row.recordId}`,
      href: modal
        ? recordModalHref(target, { kind: modal, id: row.recordId })
        : target.pathname + target.search,
    }
  })
  return {
    query: { ...query, page, href },
    rows,
    total,
    page,
    pages,
    counts: {},
    isEmpty: total === 0,
    ...(page > 1 ? { previous: searchHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
    ...(page < pages ? { next: searchHref(href, { page: String(page + 1) }) } : {}),
  }
}
