import { and, or, not, inArray, compileListFilter, validateListState } from '@ketvietlab/ketjs'
import type { FilterNode, FilterRule, Row, ListSearchSpec, ListState, Expr } from '@ketvietlab/ketjs'

/**
 * Each category's full name from the top ("Chăm sóc da / Làm sạch"), by id. Two branches may
 * hold the same name, so a product names its category by the whole path (P40).
 */
export function categoryPaths(rows: readonly Row[]): Map<string, string> {
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const paths = new Map<string, string>()
  for (const row of rows) {
    const names: string[] = [],
      seen = new Set<string>()
    for (let cursor: Row | undefined = row; cursor && !seen.has(String(cursor.id)); ) {
      seen.add(String(cursor.id))
      names.unshift(String(cursor.name ?? cursor.id))
      cursor = cursor.parentId == null ? undefined : byId.get(String(cursor.parentId))
    }
    paths.set(String(row.id), names.join(' / '))
  }
  return paths
}

/** Rows must already belong to the caller's company. Missing IDs match no stored category. */
export function categoryDescendants(rows: readonly Row[], roots: readonly string[]): Set<string> {
  const children = new Map<string, string[]>()
  for (const row of rows) {
    if (row.parentId == null) continue
    const parent = String(row.parentId)
    const bucket = children.get(parent) ?? []
    bucket.push(String(row.id))
    children.set(parent, bucket)
  }
  const selected = new Set(roots),
    pending = [...selected]
  for (let i = 0; i < pending.length; i++)
    for (const child of children.get(pending[i]!) ?? []) {
      if (selected.has(child)) continue
      selected.add(child)
      pending.push(child)
    }
  return selected
}

export const hasCategoryFilter = (nodes: readonly FilterNode[]): boolean =>
  nodes.some((node) =>
    node.kind === 'group'
      ? hasCategoryFilter(node.children)
      : node.field === 'categoryId' && ['equals', 'notEquals', 'anyOf'].includes(node.operator),
  )

/** Compile subtree predicates without expanding the user's saved state or filter-count budget. */
export function compileCategoryListFilter(
  spec: ListSearchSpec,
  state: ListState,
  rows: readonly Row[],
  timezone: string,
  resolve?: (rule: FilterRule) => Expr | null,
): Expr | null {
  validateListState(spec, state)
  const category = spec.filterable?.find((field) => field.key === 'categoryId')
  const base = compileListFilter(spec, { ...state, filters: [] }, { timezone })
  const compile = (node: FilterNode): Expr => {
    if (node.kind === 'group') return (node.op === 'and' ? and : or)(...node.children.map(compile))
    const resolved = resolve?.(node)
    if (resolved) return resolved
    if (
      category &&
      node.field === 'categoryId' &&
      node.value != null &&
      ['equals', 'notEquals', 'anyOf'].includes(node.operator)
    ) {
      const roots = (Array.isArray(node.value) ? node.value : [node.value]).map(String)
      const matched = inArray(category.col, [...categoryDescendants(rows, roots)])
      return node.operator === 'notEquals' ? not(matched) : matched
    }
    return compileListFilter(
      spec,
      { ...state, q: undefined, presets: [], filters: [node], groupBy: [], openGroups: [], groupPages: {} },
      { timezone },
    )!
  }
  const parts = [...(base ? [base] : []), ...state.filters.map(compile)]
  return parts.length ? and(...parts) : null
}
