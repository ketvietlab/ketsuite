import { writeCategory } from '../category-write.ts'
import { asc, defineFn, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { narrow } from './shared.ts'
import { categoryFailure, categoryInUse, categoryRefusal, lockCategories } from '../category-policy.ts'

export async function listBrandsHandler(ctx: Ctx, args: Record<string, unknown>) {
  const B = ctx.table('product.Brand')
  const rows = await ctx.db.all(from(B).orderBy(asc(B.name)))
  return narrow(args.includeArchived === true ? rows : rows.filter((brand) => brand.active !== false), args, [
    'name',
  ])
}

export async function saveBrandHandler(ctx: Ctx, args: Record<string, unknown>) {
  const existing = (await ctx.db.select('product.Brand', { id: args.id }))[0]
  const changes = ctx
    .change('product.Brand', { ...args, active: args.active ?? true }, existing ?? null)
    .cast(['id', 'name', 'active'])
    .required(['name'])
  if (!changes.valid) return { ok: false, errors: changes.errors }
  await ctx.db.commit(changes, existing ? { id: args.id } : undefined)
  return { ok: true, id: args.id }
}

export async function listCategoriesHandler(ctx: Ctx, args: Record<string, unknown>) {
  const C = ctx.table('product.Category')
  const wanted = Array.isArray(args.ids) ? new Set(args.ids.map(String)) : null
  if (wanted && !wanted.size) return []
  // Children answer the tree picker. An id lookup walks parents instead, so
  // preloading them there is work nobody reads.
  const base = from(C).orderBy(asc(C.name))
  const rows = await ctx.db.all(wanted ? base : base.preload('children'))
  // A category is a node in a tree, and two branches may well hold a "Shirts".
  // `path` spells the ancestry out so a flat picker list stays unambiguous;
  // it is derived here rather than stored, and searching matches on it too.
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const pathOf = (row: Row): string => {
    const parts: string[] = []
    const seen = new Set<string>()
    let cursor: Row | undefined = row
    while (cursor && !seen.has(String(cursor.id))) {
      seen.add(String(cursor.id))
      parts.unshift(String(cursor.name))
      cursor = cursor.parentId == null ? undefined : byId.get(String(cursor.parentId))
    }
    return parts.join(' / ')
  }
  return narrow(
    rows
      .filter((row) =>
        wanted ? wanted.has(String(row.id)) : args.includeArchived === true || row.active !== false,
      )
      .map((row) => ({
        ...row,
        active: row.active !== false,
        path: pathOf(row),
        children: Array.isArray(row.children)
          ? row.children.filter((child: Row) => args.includeArchived === true || child.active !== false)
          : row.children,
      })),
    args,
    ['name', 'path'],
  )
}

export async function saveCategoryHandler(ctx: Ctx, args: Record<string, unknown>) {
  try {
    return await ctx.tx(async (tx) => {
      return writeCategory(tx, args)
    })
  } catch (error) {
    const refused = categoryFailure(error)
    if (refused) return refused
    throw error
  }
}

export async function setCategoryActiveHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    await lockCategories(tx)
    const rows = await tx.db.select('product.Category')
    const existing = rows.find((row) => row.id === args.id)
    if (!existing) return categoryRefusal('id', 'missing')
    if (args.active === false && (await categoryInUse(tx, String(args.id), rows)))
      return categoryRefusal('id', 'inUse')
    if (
      args.active === true &&
      existing.parentId &&
      !rows.some((row) => row.id === existing.parentId && row.active !== false)
    )
      return categoryRefusal('parentId', 'parentInactive')
    await tx.db.update('product.Category', { id: args.id }, { active: args.active })
    return { ok: true, id: args.id, active: args.active }
  })
}

export const classificationFunctions: Record<string, FnSpec> = {
  listBrands: defineFn({
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', name: 'text', active: 'bool' },
    effects: ['read:product.Brand'],
    agent: true,
    handler: listBrandsHandler,
  }),
  saveBrand: defineFn({
    input: { id: 'id', name: 'text', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Brand', 'write:product.Brand'],
    idempotent: true,
    agent: true,
    handler: saveBrandHandler,
  }),
  listCategories: defineFn({
    // `ids` narrows the answer to the categories a caller already named — a page
    // of products wants the labels behind its categoryIds, not the tenant's whole
    // tree. The rows are still all read, because `path` is an ancestry walk that
    // the selected rows cannot answer alone, but children are left unloaded and
    // only the named categories come back.
    input: { search: 'text?', ids: 'json?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', name: 'text', parentId: 'id?', active: 'bool', path: 'text?', children: 'json?' },
    effects: ['read:product.Category'],
    agent: true,
    handler: listCategoriesHandler,
  }),
  saveCategory: defineFn({
    input: { id: 'id', name: 'text', parentId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Category', 'write:product.Category'],
    idempotent: true,
    agent: true,
    handler: saveCategoryHandler,
  }),
  setCategoryActive: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', active: 'bool?', errors: 'json?' },
    effects: [
      'read:product.Category',
      'write:product.Category',
      'read:product.Template',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
    ],
    idempotent: true,
    agent: true,
    handler: setCategoryActiveHandler,
  }),
}
