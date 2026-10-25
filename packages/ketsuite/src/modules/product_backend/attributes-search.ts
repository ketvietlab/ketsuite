import type { Translator } from '@ketvietlab/ketjs'
import type { SearchFacet, SearchFilterConfig } from '@ketvietlab/design-system'
import { ATTRIBUTE_SEARCH_VALUES } from './attribute-search-state.ts'
import { selectionLabel } from '../backend/screen.ts'
import { searchFilterLabels } from '../backend/search-filter.ts'

export const ATTRIBUTE_SEARCH_FILTERS: readonly {
  key: keyof typeof ATTRIBUTE_SEARCH_VALUES
  values: readonly string[]
}[] = [
  { key: 'displayType', values: ATTRIBUTE_SEARCH_VALUES.displayType },
  { key: 'createVariant', values: ATTRIBUTE_SEARCH_VALUES.createVariant },
]

/** Shared by the native route and mock: the same compact Product SearchFilter, with supported facets only. */
export const attributeSearchFilterConfig = (_: Translator, url: URL): SearchFilterConfig => {
  const filters = ATTRIBUTE_SEARCH_FILTERS.flatMap((group) => {
    const active = new Set((url.searchParams.get(group.key) ?? '').split(','))
    return group.values.map((value) => ({
      id: `${group.key}:${value}`,
      group: group.key,
      label: selectionLabel(_, 'product_backend', group.key, value),
      active: active.has(value),
    }))
  })
  const query = (url.searchParams.get('q') ?? '').trim()
  const facets: SearchFacet[] = [
    ...(query ? [{ id: 'query', type: 'field' as const, label: query }] : []),
    ...filters
      .filter((filter) => filter.active)
      .map((filter) => ({ id: filter.id, type: 'filter' as const, label: filter.label })),
  ]
  return {
    name: 'product-attribute-filter',
    size: 'compact',
    facets,
    filters,
    capabilities: { groupBy: false, favorites: false, customFilters: false },
    groupBy: [],
    favorites: [],
    customFilterFields: [],
    labels: searchFilterLabels(_, {
      searchLabel: _('product_backend.attributes.search'),
      searchPlaceholder: _('product_backend.attributes.search'),
      toggleLabel: _('backend.search.filters'),
    }),
    manager: {
      applyFunction: 'product_backend.applyAttributeSearchFilter',
      bodyId: 'product-attribute-list',
      applyInput: { returnTo: url.pathname + url.search },
    },
  }
}
