// Units of measure (Sản phẩm › Đơn vị tính): the rows its list reads and its record shows.
// A unit is a reference unit or counts `relativeFactor` of another (there are no categories);
// its family is the reference unit at the top of that chain. Shared by the paged read
// (`product_backend.searchUnits`) and the record modal's read (`product_backend.unitContext`).
import type { Ctx, Row } from '@ketvietlab/ketjs'

export type UnitUsage = Record<string, { products: number; packagings: number }>

export type UnitRow = {
  id: string
  name: string
  /** The unit this one counts, null for a reference unit. */
  referenceId: string | null
  reference: string | null
  /** How many of `reference` one of this unit holds, as stored; null for a reference unit. */
  factor: string | null
  /** The reference unit at the top of its chain, which names the family. */
  familyId: string
  family: string
  /** How many of the family's reference unit one of this unit holds. */
  rootQuantity: number
  /** Active products whose own unit this is, and products packed in it. */
  products: number
  packagings: number
  active: boolean
  /** Stock or documents count in this unit: its conversion is fixed. */
  locked: boolean
}

export type UnitKind = 'all' | 'reference' | 'derived'
export type UnitQuery = {
  q: string
  status: 'active' | 'archived' | 'all'
  /** Reference units, or the units that count in another (conversions and packagings). */
  kind: UnitKind
  page: number
  pageSize: number
}

export type UnitAnswer = {
  query: UnitQuery
  total: number
  page: number
  pages: number
  rows: UnitRow[]
  counts: { active: number; archived: number }
  /** No unit at all yet, which is not the same as none matching. */
  isEmpty: boolean
}

export const UNIT_PAGE_SIZE = 50
export const UNIT_LIST_PATH = '/admin/product/uoms'
/** Where the unit's record modal saves (units/routes.ts). */
export const UNIT_COMMAND_PATH = '/admin/product/uoms/command'

export const fold = (value: string): string =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/gu, '').replace(/đ/gu, 'd')

/**
 * How many products use each unit: as their own unit (active products only, the ones a
 * sale can still name) and as a packaging. The caller declares the two reads.
 */
export const readUnitUsage = async (ctx: Ctx): Promise<UnitUsage> => {
  const usage: UnitUsage = {}
  const count = (id: unknown, key: 'products' | 'packagings') => {
    if (id == null) return
    usage[String(id)] ??= { products: 0, packagings: 0 }
    usage[String(id)]![key] += 1
  }
  for (const template of await ctx.db.select('product.Template', { active: true }))
    count(template.uomId, 'products')
  for (const link of await ctx.db.select('product.TemplateUom')) count(link.uomId, 'packagings')
  return usage
}

const rootIdOf = (unit: Row): string =>
  String(unit.parentPath ?? '')
    .split('/')
    .filter(Boolean)[0] ?? String(unit.id)

/** Every unit as a list row, families together and each in the order of what it holds. */
export const unitRowsOf = (units: readonly Row[], usage: UnitUsage): UnitRow[] => {
  const byId = new Map(units.map((unit) => [String(unit.id), unit]))
  return units
    .map((unit) => {
      const id = String(unit.id)
      const root = byId.get(rootIdOf(unit)) ?? unit
      const reference = unit.relativeUomId == null ? undefined : byId.get(String(unit.relativeUomId))
      return {
        id,
        name: String(unit.name ?? id),
        referenceId: unit.relativeUomId == null ? null : String(unit.relativeUomId),
        reference: reference ? String(reference.name) : null,
        factor: unit.relativeUomId == null ? null : String(unit.relativeFactor),
        familyId: String(root.id),
        family: String(root.name ?? root.id),
        rootQuantity: (Number(unit.absoluteFactor) || 1) / (Number(root.absoluteFactor) || 1),
        products: usage[id]?.products ?? 0,
        packagings: usage[id]?.packagings ?? 0,
        active: unit.active !== false,
        locked: unit.locked === true,
      }
    })
    .sort(
      (a, b) =>
        fold(a.family).localeCompare(fold(b.family)) ||
        a.familyId.localeCompare(b.familyId) ||
        a.rootQuantity - b.rootQuantity ||
        fold(a.name).localeCompare(fold(b.name)),
    )
}

/** One page of the units matching a query; the counts ignore the status filter they feed. */
export const unitAnswer = (
  rows: readonly UnitRow[],
  input: { q?: unknown; status?: unknown; kind?: unknown; page?: unknown; pageSize?: unknown },
): UnitAnswer => {
  const status = input.status === 'archived' || input.status === 'all' ? input.status : 'active'
  const kind: UnitKind = input.kind === 'reference' || input.kind === 'derived' ? input.kind : 'all'
  const q = String(input.q ?? '')
    .trim()
    .slice(0, 100)
  const pageSize = Math.min(Math.max(Math.trunc(Number(input.pageSize)) || UNIT_PAGE_SIZE, 1), 100)
  const needle = fold(q)
  const matching = rows.filter(
    (row) =>
      (kind === 'all' || (kind === 'reference') === (row.referenceId === null)) &&
      (!needle || fold(row.name).includes(needle) || fold(row.family).includes(needle)),
  )
  const shown = status === 'all' ? matching : matching.filter((row) => row.active === (status === 'active'))
  const pages = Math.max(1, Math.ceil(shown.length / pageSize))
  const page = Math.min(Math.max(Math.trunc(Number(input.page)) || 1, 1), pages)
  return {
    query: { q, status, kind, page, pageSize },
    total: shown.length,
    page,
    pages,
    rows: shown.slice((page - 1) * pageSize, page * pageSize),
    counts: {
      active: matching.filter((row) => row.active).length,
      archived: matching.filter((row) => !row.active).length,
    },
    isEmpty: rows.length === 0,
  }
}

export type UnitChoice = { value: string; label: string }

/** What the unit's record modal shows and edits; `null` when there is no such unit. */
export type UnitModalData = {
  lang: 'vi' | 'en'
  editable: boolean
  record: { id: string; name: string; referenceId: string; factor: string; active: boolean }
  /** Units this one may count in: never itself or a unit counting in it. */
  references: UnitChoice[]
  usage: { products: number; packagings: number; locked: boolean }
  /** The units that count in this one, archived ones marked. */
  derived: string[]
  /** How many of the family's reference unit one of this unit holds, for a unit that is not one. */
  conversion: { quantity: number; root: string } | null
}

/** The record modal's data for unit `id`, or for a new unit when `id` is absent. */
export const unitModalData = (
  units: readonly Row[],
  usage: UnitUsage,
  id: string | null,
  options: { lang: 'vi' | 'en'; editable: boolean },
): UnitModalData | null => {
  const rows = unitRowsOf(units, usage)
  const unit = id === null ? null : rows.find((row) => row.id === id)
  if (id !== null && !unit) return null
  const number = new Intl.NumberFormat(options.lang === 'en' ? 'en-GB' : 'vi-VN', {
    maximumFractionDigits: 3,
  })
  // A unit's chain is its parent path: a unit whose chain passes through this one counts in it.
  const chainOf = new Map(units.map((row) => [String(row.id), String(row.parentPath ?? '').split('/')]))
  const references = rows
    .filter(
      (row) =>
        (row.active || row.id === unit?.referenceId) &&
        (!unit || !(chainOf.get(row.id) ?? [row.id]).includes(unit.id)),
    )
    .map((row) => ({
      value: row.id,
      label: row.referenceId ? `${row.name} · ${number.format(row.rootQuantity)} ${row.family}` : row.name,
    }))
  const archived = options.lang === 'en' ? 'archived' : 'lưu trữ'
  return {
    lang: options.lang,
    editable: options.editable,
    record: unit
      ? {
          id: unit.id,
          name: unit.name,
          referenceId: unit.referenceId ?? '',
          factor: unit.factor === null ? '' : String(Number(unit.factor)),
          active: unit.active,
        }
      : { id: '', name: '', referenceId: '', factor: '', active: true },
    references,
    usage: unit
      ? { products: unit.products, packagings: unit.packagings, locked: unit.locked }
      : { products: 0, packagings: 0, locked: false },
    derived: unit
      ? rows
          .filter((row) => row.referenceId === unit.id)
          .map((row) => (row.active ? row.name : `${row.name} (${archived})`))
      : [],
    conversion: unit?.referenceId ? { quantity: unit.rootQuantity, root: unit.family } : null,
  }
}

/**
 * A typed quantity as a decimal string, or `null` when it is not a number above 0. A
 * Vietnamese reader groups thousands with dots and writes decimals with a comma ("1.000",
 * "0,5"); an English one the other way round. A dot or comma not followed by exactly three
 * digits is a decimal point either way, which is how "1.5" and "0,125" are meant.
 */
export const parseQuantity = (typed: string, lang: 'vi' | 'en'): string | null => {
  const text = typed.replace(/\s/gu, '')
  const [group, point] = lang === 'en' ? [',', '.'] : ['.', ',']
  const grouped = lang === 'en' ? /^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/u : /^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/u
  const plain = grouped.test(text)
    ? text.split(group).join('').replace(point, '.')
    : /^\d+([.,]\d+)?$/u.test(text)
      ? text.replace(',', '.')
      : null
  return plain !== null && Number(plain) > 0 ? plain : null
}

/** A stored quantity as the reader types it: "0,5" in Vietnamese, "0.5" in English, no grouping. */
export const typedQuantity = (stored: string, lang: 'vi' | 'en'): string =>
  lang === 'en' ? stored : stored.replace('.', ',')
