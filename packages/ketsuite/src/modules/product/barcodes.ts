import { randomUUID } from 'node:crypto'
import { deleteFrom, eq, from, ilike } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

export const BARCODE_EFFECTS = [
  'read:product.Product',
  'read:product.ProductUom',
  'read:product.BarcodeClaim',
  'write:product.BarcodeClaim',
] as const

export const barcodeValue = (value: unknown): string | null => {
  const text = value == null ? '' : String(value).trim()
  return text || null
}

/** GS1 GTIN-8, GTIN-12, GTIN-13 and GTIN-14 share the modulo-ten check digit. */
export const validGtin = (value: string): boolean => {
  if (!/^(\d{8}|\d{12,14})$/.test(value)) return false
  const digits = [...value].map(Number)
  const check = digits.pop()
  const total = digits.reverse().reduce((sum, digit, index) => sum + digit * (index % 2 ? 1 : 3), 0)
  return (10 - (total % 10)) % 10 === check
}

// The same GTIN may arrive from a scanner padded to fourteen digits.
export const barcodeKey = (value: unknown): string | null => {
  const code = barcodeValue(value)
  return code && validGtin(code) ? code.padStart(14, '0') : code
}

type Owner = { kind: 'variant' | 'packaging'; id: string }
export const barcodeOwnerKey = (owner: Owner): string => `${owner.kind}:${owner.id}`

export class BarcodeRefused extends Error {
  readonly result: Row
  constructor(field: string, code: 'barcodeFormat' | 'barcodeTaken') {
    super(code)
    this.result = { ok: false, errors: [{ field, code: `product.error.template.${code}` }] }
  }
}

/** Caller owns the transaction, including the corresponding Product/ProductUom write. */
export async function releaseBarcodeClaims(ctx: Ctx, owners: readonly Owner[]): Promise<void> {
  if (!owners.length) return
  const Claim = ctx.table('product.BarcodeClaim')
  for (const owner of owners) {
    const rows = await ctx.db.select('product.BarcodeClaim', { ownerKind: owner.kind, ownerId: owner.id })
    for (const row of rows)
      if (String(row.companyId) === ctx.scope.company)
        await ctx.db.del(deleteFrom(Claim).where(eq(Claim.id, row.id)))
  }
}

export async function claimBarcode(
  ctx: Ctx,
  owner: Owner,
  current: Row | null | undefined,
  value: unknown,
  options: { field?: string; replacing?: ReadonlySet<string> } = {},
): Promise<Row> {
  const code = barcodeValue(value)
  const field = options.field ?? 'barcode'
  if (current && code === barcodeValue(current.barcode)) {
    // Preserve legacy barcodes on unrelated edits. An implicit identity replacement
    // transfers its existing reservation without changing the historical barcode.
    if (String(current.id) !== owner.id) {
      const rows = await ctx.db.select('product.BarcodeClaim', { ownerKind: owner.kind, ownerId: current.id })
      for (const row of rows)
        if (String(row.companyId) === ctx.scope.company)
          await ctx.db.update('product.BarcodeClaim', { id: row.id }, { ownerId: owner.id })
    }
    return { barcode: current.barcode ?? null }
  }
  if (!code && !barcodeValue(current?.barcode)) return { barcode: null }
  if (code && !validGtin(code)) throw new BarcodeRefused(field, 'barcodeFormat')
  const replacing = options.replacing ?? new Set<string>()
  const key = barcodeKey(code)
  if (code) {
    // Legacy rows have no claim. Read them too, including archived identities.
    // Leading zero padding and surrounding whitespace cannot evade a collision.
    const fragment = code.replace(/^0+/, '') || code
    for (const [model, kind] of [
      ['product.Product', 'variant'],
      ['product.ProductUom', 'packaging'],
    ] as const) {
      const table = ctx.table(model)
      const rows = await ctx.db.all(from(table).where(ilike(table.barcode, `%${fragment}%`)))
      if (
        rows.some(
          (row) =>
            (!row.companyId || String(row.companyId) === ctx.scope.company) &&
            !(kind === owner.kind && (String(row.id) === owner.id || row.id === current?.id)) &&
            !replacing.has(barcodeOwnerKey({ kind, id: String(row.id) })) &&
            barcodeKey(row.barcode) === key,
        )
      )
        throw new BarcodeRefused(field, 'barcodeTaken')
    }
  }
  const held = (
    await ctx.db.select('product.BarcodeClaim', { ownerKind: owner.kind, ownerId: owner.id })
  ).find((row) => String(row.companyId) === ctx.scope.company)
  if (!code) {
    await releaseBarcodeClaims(ctx, [owner])
    return { barcode: null }
  }
  if (held) await ctx.db.update('product.BarcodeClaim', { id: held.id }, { code: key })
  else
    await ctx.db.insert('product.BarcodeClaim', {
      id: randomUUID(),
      code: key,
      ownerKind: owner.kind,
      ownerId: owner.id,
    })
  return { barcode: code }
}

export function barcodeFailure(error: unknown, field = 'barcode'): Row | null {
  if (error instanceof BarcodeRefused) return error.result
  let held: unknown = error
  for (let depth = 0; held && depth < 5; depth++) {
    const message = held instanceof Error ? held.message : String(held)
    if (
      /barcode_claim_code|UNIQUE constraint failed: product_barcode_claim\.(?:companyId, product_barcode_claim\.)?code|barcode_unique|barcode_company/i.test(
        message,
      )
    )
      return new BarcodeRefused(field, 'barcodeTaken').result
    held = typeof held === 'object' ? (held as { cause?: unknown }).cause : null
  }
  return null
}
