// The vendor prices the product page lists: this company's supplier prices for one
// template (or one of its variants) that are valid today, cheapest first.

import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'

const LIMIT = 20

export const productVendorFunctions: Record<string, FnSpec> = {
  listProductVendors: defineFn({
    input: { templateId: 'id' },
    effects: ['read:purchase.SupplierInfo', 'read:partner.Partner'],
    agent: true,
    handler: async (ctx, args) => {
      const company = ctx.scope.company
      if (!company) return []
      const now = Date.now()
      const at = (value: unknown) =>
        value == null || value === '' ? null : new Date(String(value)).getTime()
      const rows = (await ctx.db.select('purchase.SupplierInfo', { productTemplateId: args.templateId }))
        .filter((row) => String(row.companyId) === company)
        .filter((row) => (at(row.dateStart) ?? -Infinity) <= now && now <= (at(row.dateEnd) ?? Infinity))
        .sort(
          (a, b) =>
            Number(a.sequence ?? 10) - Number(b.sequence ?? 10) ||
            Number(a.price ?? 0) - Number(b.price ?? 0) ||
            String(a.id).localeCompare(String(b.id)),
        )
        .slice(0, LIMIT)
      const partners = new Map<string, string>()
      for (const id of new Set(rows.map((row) => String(row.partnerId)))) {
        const partner = (await ctx.db.select('partner.Partner', { id }))[0]
        partners.set(id, partner ? String(partner.name ?? id) : id)
      }
      return rows.map((row) => ({
        id: String(row.id),
        vendor: partners.get(String(row.partnerId)) ?? String(row.partnerId),
        vendorId: String(row.partnerId),
        productId: row.productId == null ? null : String(row.productId),
        vendorCode: row.productCode == null ? null : String(row.productCode),
        vendorName: row.productName == null ? null : String(row.productName),
        price: String(row.price ?? '0'),
        discount: String(row.discount ?? '0'),
        minQty: Number(row.minQty ?? 0),
        delay: Number(row.delay ?? 0),
        dateEnd: row.dateEnd == null ? null : String(row.dateEnd),
        uomId: String(row.productUomId ?? ''),
      }))
    },
  }),
}
