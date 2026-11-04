import { KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { effectiveFunctionKeys } from '../../user/authorization.ts'
import { fold } from '../text-fold.ts'

/**
 * The field groups of a product record and the function whose grant opens each.
 *
 * A grant is held per function, so a group is opened by the one function that
 * edits it on its own: whoever may set a barcode may change it inside a template
 * save too, and whoever may not is refused there as well.
 */
export const FIELD_GROUP_FUNCTIONS = {
  stock: 'product.setBarcode',
  accounting: 'product.setCost',
} as const

/** Whether the caller holds `fnKey`. An internal call has no actor and is trusted; a superuser holds all. */
export const holdsFunction = async (ctx: Ctx, fnKey: string): Promise<boolean> => {
  if (!ctx.actor) return true
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  return allowed === null || allowed.includes(fnKey)
}

/**
 * Refuse a changed value in a field group the caller may not edit.
 *
 * Refused rather than dropped: a save that quietly kept the old barcode would
 * report success for a change it never made. `E_FN_NOT_PERMITTED` answers 403.
 */
export const requireFieldGroup = async (
  ctx: Ctx,
  group: keyof typeof FIELD_GROUP_FUNCTIONS,
  fields: string[],
): Promise<void> => {
  if (await holdsFunction(ctx, FIELD_GROUP_FUNCTIONS[group])) return
  throw new KetError({
    code: 'E_FN_NOT_PERMITTED',
    message: `${fields.join(', ')} belong to the ${group} fields, which this role may not change`,
    hint: `grant ${FIELD_GROUP_FUNCTIONS[group]}, or leave the value as it is`,
  })
}

/** A barcode as stored: blank is none. */
export const barcodeOf = (value: unknown): string | null =>
  value == null || String(value).trim() === '' ? null : String(value).trim()

/**
 * The `search` and `limit` a relation picker sends, applied in memory.
 *
 * These lists are small and already fully loaded by their handler, so narrowing
 * here costs nothing and keeps the picker's contract — a `search` term and a
 * `limit` on every call — satisfiable without a second query path.
 */
export const narrow = (
  rows: Row[],
  args: { search?: unknown; limit?: unknown; offset?: unknown },
  fields: string[],
): Row[] => {
  // Pickers search as people type, often without accents ("lam sach" finds "Làm sạch").
  const needle = fold(String(args.search ?? '').trim())
  const matched = needle
    ? rows.filter((row) => fields.some((field) => fold(String(row[field] ?? '')).includes(needle)))
    : rows
  const rawOffset = Number(args.offset)
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0
  const limit = Number(args.limit)
  return Number.isInteger(limit) && limit > 0 ? matched.slice(offset, offset + limit) : matched.slice(offset)
}

export const productExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  Boolean((await ctx.db.select('product.Product', { id }))[0])

/**
 * The id of a company-scoped row, carrying the company it belongs to.
 *
 * `id` is a tenant-wide primary key, so a derived id built only from the shared
 * ids either collides across companies or reads as another company's row. Reads
 * span the whole readable company set while writes are pinned to the active
 * company, so a lookup that ignores the company finds a row it can never write.
 */
export const companyKey = (company: string, ...parts: unknown[]): string =>
  [company, ...parts.map((part) => String(part))].join(':')
