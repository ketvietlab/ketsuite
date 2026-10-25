import { asc, defineFn, eq, from, ilike, inArray, likeLiteral, or } from '@ketvietlab/ketjs'
import { hasPropertyScope, readRecord } from './command.ts'

const bound = (value: unknown) => Math.min(100, Math.max(1, Math.trunc(Number(value) || 20)))
const lookupInput = { search: 'text?', limit: 'int?', propertyId: 'id?', id: 'id?' } as const
export const serviceRecordFunctions = {
  getServiceRecord: defineFn({
    input: { id: 'id' },
    output: { record: 'json?' },
    effects: [
      'read:hospitality_core.ExtraLine',
      'read:hospitality_core.Property',
      'read:hospitality_core.Charge',
      'read:hospitality_core.Folio',
      'read:uom.Unit',
    ],
    handler: async (ctx, args) => {
      const line = await readRecord(ctx, 'hospitality_core.ExtraLine', args.id)
      const property = line ? await readRecord(ctx, 'hospitality_core.Property', line.propertyId) : null
      if (!line || !property || !hasPropertyScope(ctx, property)) return { record: null }
      const C = ctx.table('hospitality_core.Charge')
      const folio = await readRecord(ctx, 'hospitality_core.Folio', line.folioId)
      const locked =
        !folio ||
        folio.state !== 'open' ||
        (await ctx.db.count(from(C).where(eq(C.extraLineId, line.id)))) > 0
      const unit = line.uomId ? await readRecord(ctx, 'uom.Unit', line.uomId) : null
      const fields = [
        'id',
        'version',
        'active',
        'propertyId',
        'productId',
        'uomId',
        'description',
        'fulfillmentKind',
        'recurrence',
        'quantity',
        'unitPrice',
        'folioId',
        'chargeType',
      ]
      return {
        record: {
          ...Object.fromEntries(fields.map((key) => [key, line[key] ?? null])),
          unitName: unit?.name ?? '',
          target: line.stayId ? `stay:${line.stayId}` : `reservation:${line.reservationId}`,
          locked,
        },
      }
    },
  }),
  lookupServiceTargets: defineFn({
    input: lookupInput,
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Stay',
      'read:partner.Partner',
    ],
    handler: async (ctx, args) => {
      const property = args.propertyId
        ? await readRecord(ctx, 'hospitality_core.Property', args.propertyId)
        : null
      if (!property || !hasPropertyScope(ctx, property)) return []
      const rows = []
      for (const [kind, model, states] of [
        ['reservation', 'Reservation', ['draft', 'confirmed']],
        ['stay', 'Stay', ['checked_in']],
      ] as const) {
        const T = ctx.table(`hospitality_core.${model}`)
        let query = from(T).where(eq(T.companyId!, ctx.scope.company), eq(T.propertyId!, property.id))
        if (args.id) {
          const prefix = `${kind}:`
          if (!String(args.id).startsWith(prefix)) continue
          query = query.where(eq(T.id, String(args.id).slice(prefix.length)))
        } else query = query.where(inArray(T.state!, [...states]))
        if (args.search) {
          const pattern = `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`
          const P = ctx.table('partner.Partner')
          const guests = await ctx.db.all(
            from(P)
              .select(P.id)
              .where(ilike(P.name!, pattern, true))
              .limit(100),
          )
          query = query.where(
            or(
              ilike(T.code!, pattern, true),
              inArray(
                T.partnerId!,
                guests.map((row) => row.id),
              ),
            ),
          )
        }
        const found = await ctx.db.all(
          query.orderBy(asc(T.code!), asc(T.id)).limit(bound(args.limit)).preload('partner'),
        )
        rows.push(
          ...found.map((row) => ({
            id: `${kind}:${row.id}`,
            name: [row.code, (row.partner as Record<string, unknown> | null)?.name]
              .filter(Boolean)
              .join(' · '),
            propertyId: row.propertyId,
          })),
        )
      }
      return rows
        .sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id))
        .slice(0, bound(args.limit))
    },
  }),
  lookupServiceProducts: defineFn({
    input: lookupInput,
    effects: [
      'read:hospitality_core.Property',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    handler: async (ctx, args) => {
      const property = args.propertyId
        ? await readRecord(ctx, 'hospitality_core.Property', args.propertyId)
        : null
      if (!property || !hasPropertyScope(ctx, property)) return []
      const T = ctx.table('product.Template'),
        P = ctx.table('product.Product')
      let templates = from(T).where(eq(T.active!, true), eq(T.saleOk!, true))
      if (args.id) {
        const selected = await readRecord(ctx, 'product.Product', args.id)
        if (!selected) return []
        templates = templates.where(eq(T.id, selected.templateId))
      }
      if (args.search)
        templates = templates.where(
          ilike(T.name!, `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`, true),
        )
      const owners = await ctx.db.all(templates.orderBy(asc(T.name!), asc(T.id)).limit(100))
      let query = from(P).where(
        eq(P.active!, true),
        inArray(
          P.templateId!,
          owners.map((row) => row.id),
        ),
      )
      if (args.id) query = query.where(eq(P.id, args.id))
      const products = await ctx.db.all(query.orderBy(asc(P.id)).limit(bound(args.limit)))
      const U = ctx.table('uom.Unit')
      const units = await ctx.db.all(
        from(U).where(inArray(U.id, [...new Set(owners.map((row) => row.uomId).filter(Boolean))])),
      )
      return products.map((row) => {
        const template = owners.find((item) => item.id === row.templateId)!
        return {
          id: row.id,
          name: [template.name, row.defaultCode, units.find((unit) => unit.id === template.uomId)?.name]
            .filter(Boolean)
            .join(' · '),
          unitPrice: template.listPrice,
          uomId: template.uomId,
          unitName: units.find((unit) => unit.id === template.uomId)?.name ?? '',
          propertyId: property.id,
        }
      })
    },
  }),
}
