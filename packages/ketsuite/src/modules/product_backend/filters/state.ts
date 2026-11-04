import type { ListState } from '@ketvietlab/ketjs'
export const PRODUCT_FILTERS = 'product.templates'
export const VARIANT_FILTERS = 'product.variants'
export type SavedFilter = {
  id: string
  name: string
  owned: boolean
  shared: boolean
  revisionId: string
  href: string
  active: boolean
  isDefault: boolean
}
export type FilterModalData = {
  id: string
  listKey: string
  name: string
  shared: boolean
  isDefault: boolean
  state: Record<string, unknown>
  revisionId?: string
  lang: 'vi' | 'en'
  existing: boolean
}
/** Persist only the list's meaning, never paging, expanded groups, selection or modal context. */
export function productFilterState(state: Partial<ListState>) {
  return {
    q: state.q?.trim() || '',
    presets: state.presets ?? [],
    filters: state.filters ?? [],
    groupBy: state.groupBy ?? [],
    sort: state.sort ?? [],
    includeArchived: state.includeArchived === true,
  }
}
export function variantFilterState(state: Record<string, unknown>) {
  return Object.fromEntries(
    ['q', 'use', 'type', 'categoryId', 'tagId', 'status', 'sort', 'dir'].map((key) => [key, state[key]]),
  )
}
