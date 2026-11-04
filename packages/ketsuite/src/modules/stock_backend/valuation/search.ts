import type { ListState, Translator } from '@ketvietlab/ketjs'
import { listSearchFilterConfig, type ListFavorite } from '../../backend/search-filter.ts'
import { valuationListSearch } from '../search.ts'
export function valuationSearch(
  _: Translator,
  state: ListState,
  href: string,
  favorites: ListFavorite[] = [],
) {
  return {
    ...listSearchFilterConfig(_, {
      name: 'stock-valuation-filter',
      bodyId: 'stock-valuation-list',
      spec: valuationListSearch,
      state,
      favorites,
      applyInput: { listKey: valuationListSearch.key, returnTo: href },
      labels: { searchPlaceholder: _('stock_backend.valuation.search') },
      functions: {
        apply: 'stock_backend.applySearchFilter',
        saveFavorite: 'stock_backend.saveSearchFavorite',
        deleteFavorite: 'stock_backend.deleteSearchFavorite',
        setDefaultFavorite: 'stock_backend.setDefaultSearchFavorite',
      },
    }),
    applyOnInput: true,
  }
}
