import { randomUUID } from 'node:crypto'
import { from, ilike, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

export const productCodeOf = (value: unknown): string | null =>
  value == null || String(value).trim() === '' ? null : String(value).trim()

/** Caller owns the transaction; code edits invalidate open record and inventory drafts. */
export async function claimProductCodeRevision(ctx: Ctx, template: Row): Promise<void> {
  const stocked = Boolean(ctx.manifest.modules.stock)
  const result = await ctx.db.compareAndSet(
    'product.Template',
    { id: template.id },
    {
      revisionId: template.revisionId ?? null,
      ...(stocked ? { inventoryRevision: template.inventoryRevision ?? null } : {}),
    },
    {
      revisionId: randomUUID(),
      ...(stocked ? { inventoryRevision: Number(template.inventoryRevision ?? 0) + 1 } : {}),
    },
  )
  if (!('dryRun' in result) && !result.matched)
    throw new KetError({ code: 'conflict', message: 'The product changed; reload before editing its codes.' })
}

export class ProductCodeRefused extends Error {
  readonly result: Row
  constructor(field: string, code: 'codeRequired' | 'codeFormat' | 'codeTaken') {
    super(code)
    this.result = { ok: false, errors: [{ field, code: `product.error.template.${code}` }] }
  }
}

/** The nullable unique key protects new assignments without rewriting legacy identifiers. */
export async function productCodePatch(
  ctx: Ctx,
  current: Row | undefined | null,
  value: unknown,
  options: { field?: string; required?: boolean; replacing?: readonly string[] } = {},
): Promise<Row> {
  const field = options.field ?? 'defaultCode'
  const code = productCodeOf(value)
  if (!code && (options.required || productCodeOf(current?.defaultCode)))
    throw new ProductCodeRefused(field, 'codeRequired')
  // Preserve even invalid or duplicate legacy codes when editing unrelated fields.
  if (current && code === productCodeOf(current.defaultCode)) return { defaultCode: current.defaultCode }
  if (!code) return { defaultCode: null, codeKey: null }
  // P22: a code is written in capitals whatever was typed ("kd-02" saves as "KD-02"),
  // and starts with a letter or digit.
  const upper = code.toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(upper)) throw new ProductCodeRefused(field, 'codeFormat')
  if (current && upper === productCodeOf(current.defaultCode)) return { defaultCode: current.defaultCode }
  const P = ctx.table('product.Product')
  // Include legacy rows whose unique key is null, and codes held by inactive SKUs.
  // The candidate LIKE narrows the scan; comparison also handles legacy whitespace/case.
  const candidates = await ctx.db.all(from(P).where(ilike(P.defaultCode, `%${upper}%`)))
  const replacing = new Set(options.replacing ?? [])
  if (
    candidates.some(
      (row) =>
        row.id !== current?.id &&
        !replacing.has(String(row.id)) &&
        productCodeOf(row.defaultCode)?.toUpperCase() === upper,
    )
  )
    throw new ProductCodeRefused(field, 'codeTaken')
  return { defaultCode: upper, codeKey: upper }
}

/** Translate only this index's race; unrelated storage failures must still surface. */
export function productCodeFailure(error: unknown, field = 'defaultCode'): Row | null {
  if (error instanceof ProductCodeRefused) return error.result
  let held: unknown = error
  for (let depth = 0; held && depth < 5; depth++) {
    const message = held instanceof Error ? held.message : String(held)
    if (
      /code_key_unique|UNIQUE constraint failed: product_product\.(?:companyId, product_product\.)?codeKey/i.test(
        message,
      )
    )
      return new ProductCodeRefused(field, 'codeTaken').result
    held = typeof held === 'object' ? (held as { cause?: unknown }).cause : null
  }
  return null
}
