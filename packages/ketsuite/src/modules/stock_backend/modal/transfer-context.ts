import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { receiptLandedCosts } from './landed-cost-receipt.ts'
import { pickingShipment } from './picking-shipment.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { mayFor } from '../../../ui/fill-needs.ts'
import { recordIslandsFor } from '../../product/product-record-tabs.ts'
import { localizeGeneratedRecords } from '../generated-names.ts'
import { formatDateTime } from '../../../ui/format.ts'
import { timezoneOf } from '../../backend/screen.ts'
import { pickingPrints } from '../picking-prints.ts'

const COLLABORATION = 'stock_backend:picking.collaboration'
const EDITOR = 'stock_backend:picking.editor'
export const transferContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    if (!(await ctx.allows(creating ? 'stock.createPicking' : 'stock.getPicking', url, req)))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? { id: '', name: '', state: 'draft', moves: [] }
      : ((await ctx.call('stock.getPicking', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const permissions = Object.fromEntries(
      await Promise.all(
        [
          'createPicking',
          'savePicking',
          'addMove',
          'addMoves',
          'saveMoveLine',
          'prepareReceiptLot',
          'savePickingLines',
          'confirmPicking',
          'assignPicking',
          'unreservePicking',
          'validatePicking',
          'cancelPicking',
          'setReceiptUnitCost',
          'revaluePicking',
          'createReturn',
          'saveScrap',
        ].map(async (name) => [name, await ctx.allows(`stock.${name}`, url, req)]),
      ),
    )
    const lookup = (fn: string) => optionalRead<Row[]>(ctx, fn, {}, url, req, [])
    const [seededPickingTypes, seededLocations, templates, units, lots, warehouses] = await Promise.all([
      lookup('stock.listPickingTypes'),
      lookup('stock.listLocations'),
      permissions.addMove ? lookup('stock.listStorableProducts') : [],
      permissions.addMove ? lookup('uom.listUnits') : [],
      permissions.saveMoveLine || permissions.savePickingLines ? lookup('stock.listLots') : [],
      lookup('stock.listWarehouses'),
    ])
    // The warehouse's generated operation types and locations read in the page's language, as on the list.
    const words = ctx.translate(ctx.localeOf(url, req))
    // Each warehouse has its own operation types of the same names: the picker says whose each is.
    const warehouseNames = new Map(warehouses.map((row) => [String(row.id), String(row.name)]))
    const pickingTypes = localizeGeneratedRecords(words, seededPickingTypes, 'pickingType').map(
      (row): Row => ({
        ...row,
        warehouseName: warehouseNames.get(String(row.warehouseId)) ?? null,
      }),
    )
    const locations = localizeGeneratedRecords(words, seededLocations, 'location')
    const products = templates.flatMap((template) =>
      ((template.variants as Row[]) ?? []).map((variant) => ({
        ...variant,
        name: `${template.name}${variant.defaultCode ? ` · ${variant.defaultCode}` : ''}`,
        // The products grid offers a new line the product's own unit and the units it converts into.
        uomId: template.uomId ?? null,
      })),
    )
    // K25: values and unit costs only reach a viewer who may read them.
    const valuation =
      // optionalRead answers null to a viewer the function refuses.
      !creating
        ? await optionalRead<Row | null>(ctx, 'stock.getPickingValuation', { id: params.id }, url, req, null)
        : null
    // K59: a confirmed or completed transfer that holds goods in a warehouse opens a scrap order for them.
    const scrapSource =
      !creating && permissions.saveScrap
        ? await optionalRead<Row | null>(
            ctx,
            'stock.getScrapSource',
            { pickingId: params.id },
            url,
            req,
            null,
          )
        : null
    // K64: a completed receipt takes landed costs and lists those on it.
    const landedCosts =
      !creating && record.state === 'done' ? await receiptLandedCosts(ctx, url, req, String(params.id)) : null
    // K48: a delivery to a customer leads to its shipment, or makes one.
    const shipment = creating
      ? null
      : await pickingShipment(
          ctx,
          url,
          req,
          record,
          pickingTypes.find((row) => row.id === record.pickingTypeId)?.code,
          // A carrier takes goods to a customer, not back to a supplier nor a return of a delivery.
          locations.find((row) => row.id === record.locationDestId)?.usage === 'customer' &&
            !(record.related as Row | undefined)?.returnOf,
        )
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const scheduledAt =
      record.scheduledDate && !Number.isNaN(new Date(String(record.scheduledDate)).getTime())
        ? new Date(String(record.scheduledDate))
        : null
    const timeZone = scheduledAt ? await timezoneOf(ctx, url, req) : undefined
    const manifest = await ctx.live(req)
    // K65: the printed copies, each a page of its own.
    const reports = creating
      ? []
      : await pickingPrints(
          ctx,
          url,
          req,
          String(params.id),
          pickingTypes.find((row) => row.id === record.pickingTypeId)?.code,
          record.state,
        )
    // `allows` answers yes to a superuser even for a function this deployment does not compose.
    const readsEntries = Boolean(
      valuation && manifest.functions?.['account.getMove'] && (await ctx.allows('account.getMove', url, req)),
    )
    const entryLink = (id: string) =>
      `/admin/accounting/entries/${encodeURIComponent(id)}?${new URLSearchParams([...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)))}`
    const entryHref =
      valuation?.accountMoveId && readsEntries ? entryLink(String(valuation.accountMoveId)) : null
    // K19: the transfers this one came from and those that followed it, each opening its page.
    const transferLink = (row: Row | null | undefined) =>
      row
        ? {
            ...row,
            href: `/admin/stock/transfers/${encodeURIComponent(String(row.id))}?${new URLSearchParams([...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)))}`,
          }
        : null
    const related = record.related as Row | undefined
    // The page's rail and print-outs: what the server page placed through joints and its header,
    // which a client-rendered record cannot render, so the context names them.
    const may = creating ? {} : await mayFor(manifest.fills, COLLABORATION, (fn) => ctx.allows(fn, url, req))
    const placed = (joint: string) =>
      creating
        ? []
        : recordIslandsFor({ manifest }, joint, (fn) => {
            const [module = '', name = ''] = fn.split('.')
            return joint === EDITOR || may[module]?.[name] === true
          })
    return json({
      data: {
        record,
        // What the scheduled day plans: receiving, shipping or moving goods; unknown on a new transfer.
        // The transfer names its own type's kind: a reader may not list the warehouse's types.
        kind: (record.pickingTypeCode as string | null | undefined) ?? null,
        // The planned moment as the list shows it, and its day for the edit form: both read where the
        // company is, not in UTC (a transfer planned at 00:00 is not the day before).
        scheduled: scheduledAt
          ? {
              label: formatDateTime(lang === 'vi' ? 'vi-VN' : 'en-US', scheduledAt, {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone,
              }),
              day: formatDateTime('en-CA', scheduledAt, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                timeZone,
              }),
            }
          : null,
        reports,
        editor: placed(EDITOR),
        collaboration: placed(COLLABORATION),
        scrapHref: scrapSource
          ? `/admin/stock/scraps?${new URLSearchParams([
              ...[...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
              ['picking', String(params.id)],
              ['record', 'stock.scrap:new'],
            ])}`
          : null,
        landedCosts,
        shipment,
        related: related
          ? {
              backorderOf: transferLink(related.backorderOf as Row | null),
              returnOf: transferLink(related.returnOf as Row | null),
              backorders: ((related.backorders as Row[] | undefined) ?? []).map(transferLink),
              returns: ((related.returns as Row[] | undefined) ?? []).map(transferLink),
            }
          : null,
        permissions,
        valuation: valuation
          ? {
              ...valuation,
              entryHref,
              revaluations: ((valuation.revaluations as Row[] | undefined) ?? []).map((row) => ({
                ...row,
                entryHref: row.accountMoveId && readsEntries ? entryLink(String(row.accountMoveId)) : null,
              })),
            }
          : null,
        draftId: randomUUID(),
        choices: {
          pickingTypes,
          locations,
          products,
          units,
          lots,
          // K63: the receipt's valued lines, as the adjustment dialog's picker offers them.
          revaluable: ((valuation?.revaluable as Row[] | undefined) ?? []).map((row) => ({
            id: row.moveId,
            name: row.label,
          })),
        },
      },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) =>
              key.startsWith('stock_backend.') ||
              key.startsWith('stock.error.') ||
              key.startsWith('backend.relation.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
