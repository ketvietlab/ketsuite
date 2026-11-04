import type { SavedFilter } from '../filters/state.ts'
// What the Variants list's read answers and the island shows: no server code, so the
// island's bundle carries only these names and types.

export const VARIANT_LIST_PATH = '/admin/product/variants'

export type VariantStatus = 'active' | 'archived' | 'all'
export type VariantType = 'all' | 'goods' | 'service' | 'combo'
export type VariantSort = 'code' | 'name'

export type VariantRow = {
  id: string
  templateId: string
  code: string | null
  name: string
  /** The attribute values that tell this SKU apart (`30ml · Đỏ`); empty for a product of one SKU. */
  values: string
  barcode: string | null
  type: string
  /** What it sells for before any pricelist: its own price, or the template's plus extras. */
  price: string
  /** The company's current cost; null without the money permission or a known cost. */
  cost: string | null
  /** Null when the product keeps no stock or stock is not installed. */
  onHand: number | null
  available: number | null
  active: boolean
}

export type VariantListQuery = {
  q: string
  use?: 'all' | 'sale' | 'purchase' | 'notSold' | 'tracked'
  type: VariantType
  tagId?: string | null
  categoryId: string | null
  status: VariantStatus
  sort: VariantSort
  dir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export type VariantAnswer = {
  favorites?: SavedFilter[]
  query: VariantListQuery
  total: number
  page: number
  pages: number
  rows: VariantRow[]
  counts: { active: number; archived: number; goods: number; service: number; combo?: number }
  /** The categories the menu offers: those of the company's catalogue, by name. */
  tags?: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string }>
  isEmpty: boolean
  /** Whether the viewer sees costs; the column is absent otherwise. */
  money: boolean
  /** Whether stock answered; the stock columns are absent otherwise. */
  stock: boolean
}
