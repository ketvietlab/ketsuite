import { randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { effectiveFunctionKeys, AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { fold } from '../units.ts'
import { COMBO_PATH, comboHref, comboQuery } from './shared.ts'
import type { ComboAnswer, ComboModalData, ComboRow } from './shared.ts'

export const COMBO_READ_EFFECTS = [
  'read:product.Combo',
  'read:product.ComboItem',
  'read:product.TemplateCombo',
  'read:product.Template',
  'read:product.Product',
]
export const COMBO_CONTEXT_EFFECTS = [...COMBO_READ_EFFECTS, ...AUTHORIZATION_READ_EFFECTS]
const text = (value: unknown) => String(value ?? '')
async function dataOf(ctx: Ctx) {
  const [combos, assignments, products, items, skus] = await Promise.all([
    ctx.db.select('product.Combo'),
    ctx.db.select('product.TemplateCombo'),
    ctx.db.select('product.Template'),
    ctx.db.select('product.ComboItem'),
    ctx.db.select('product.Product'),
  ])
  const productsByCombo = new Map<string, Set<string>>()
  for (const link of assignments) {
    const ids = productsByCombo.get(text(link.comboId)) ?? new Set<string>()
    ids.add(text(link.templateId))
    productsByCombo.set(text(link.comboId), ids)
  }
  const usage = (id: string) => {
    const names = products
      .filter((row) => row.active !== false && productsByCombo.get(id)?.has(text(row.id)))
      .map((row) => text(row.name))
      .sort((a, b) => a.localeCompare(b, 'vi'))
    return { products: names.length, names }
  }
  return { combos, usage, products, items, skus }
}
export async function readCombos(ctx: Ctx, args: Row): Promise<ComboAnswer> {
  const requested = new URL(text(args.href) || COMBO_PATH, 'http://ket.local')
  if (typeof args.q === 'string') requested.searchParams.set('q', args.q)
  if (args.page != null) requested.searchParams.set('page', String(args.page))
  const query = comboQuery(requested, Number(args.pageSize) || undefined)
  const url = new URL(query.href, 'http://ket.local'),
    data = await dataOf(ctx)
  const matched = data.combos.filter((row) => fold(text(row.name)).includes(fold(query.q)))
  const active = matched.filter((row) => row.active !== false).length
  const counts = { active, archived: matched.length - active, all: matched.length }
  const status = url.searchParams.get('status')
  const rows: ComboRow[] = matched
    .filter(
      (row) => status === 'all' || (status === 'archived' ? row.active === false : row.active !== false),
    )
    .map((row) => ({
      id: text(row.id),
      name: text(row.name),
      active: row.active !== false,
      itemCount: data.items.filter((item) => item.comboId === row.id).length,
      productCount: data.usage(text(row.id)).products,
      editHref: '',
    }))
  const direction = url.searchParams.get('dir') === 'desc' ? -1 : 1
  rows.sort(
    (a, b) =>
      direction *
        (url.searchParams.get('sort') === 'items'
          ? a.itemCount - b.itemCount || a.name.localeCompare(b.name, 'vi')
          : url.searchParams.get('sort') === 'products'
            ? a.productCount - b.productCount || a.name.localeCompare(b.name, 'vi')
            : a.name.localeCompare(b.name, 'vi')) || a.id.localeCompare(b.id),
  )
  const pages = Math.max(1, Math.ceil(rows.length / query.pageSize)),
    page = Math.min(query.page, pages)
  const href = comboHref(query.href, { page: page > 1 ? String(page) : null })
  return {
    query: { ...query, page, href },
    total: rows.length,
    page,
    pages,
    counts,
    isEmpty: data.combos.length === 0,
    rows: rows
      .slice((page - 1) * query.pageSize, page * query.pageSize)
      .map((row) => ({ ...row, editHref: recordModalHref(href, { kind: 'product.combo', id: row.id }) })),
    ...(page > 1 ? { previous: comboHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
    ...(page < pages ? { next: comboHref(href, { page: String(page + 1) }) } : {}),
  }
}
export async function comboContextHandler(ctx: Ctx, args: Row) {
  if (!ctx.actor) return null
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  const can = (fn: string) => allowed === null || allowed.includes(fn)
  if (!can('product.listCombos') || (!args.id && !can('product.saveCombo'))) return null
  const data = await dataOf(ctx),
    current = args.id ? data.combos.find((row) => row.id === args.id) : undefined
  if (args.id && !current) return null
  const active = current?.active !== false
  const heldItems = current
    ? data.items
        .filter((row) => row.comboId === current.id)
        .sort((a, b) => Number(a.sequence) - Number(b.sequence))
    : []
  const heldIds = new Set(heldItems.map((item) => text(item.productId)))
  const usage = current ? data.usage(text(current.id)) : { products: 0, names: [] }
  const modal: ComboModalData = {
    lang: args.locale === 'en' ? 'en' : 'vi',
    record: {
      id: current ? text(current.id) : randomUUID(),
      name: text(current?.name),
      active,
      revisionId: text(current?.revisionId),
      items: heldItems.map((row) => ({
        id: text(row.id),
        productId: text(row.productId),
        extraPrice: text(row.extraPrice),
      })),
    },
    choices: data.skus.flatMap((row) => {
      const template = data.products.find((template) => template.id === row.templateId)
      if (
        !template ||
        template.type === 'combo' ||
        (!heldIds.has(text(row.id)) &&
          (row.active === false || template.active === false || template.saleOk === false))
      )
        return []
      return [{ value: text(row.id), label: `${text(row.defaultCode)} · ${text(template.name)}` }]
    }),
    permissions: {
      edit: active && can('product.saveCombo'),
      lifecycle: can('product.setComboActive') && (!active || usage.products === 0),
    },
    usage,
  }
  const messages = Object.fromEntries(
    Object.entries(ctx.manifest.messages?.[modal.lang] ?? {})
      .filter(
        ([key]) =>
          key.startsWith('product_backend.combo.') ||
          key.startsWith('product.error.combo.') ||
          key.startsWith('recordModal.'),
      )
      .map(([key, value]) => [key, typeof value === 'string' ? value : String(value.other ?? key)]),
  )
  return { data: modal, messages }
}

/** The public list and catalogue search share this read service. */
export function searchCombosHandler(ctx: Ctx, args: Row) {
  return readCombos(ctx, args)
}
