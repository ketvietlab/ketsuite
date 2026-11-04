import type { ListState, Translator } from '@ketvietlab/ketjs'
import { listSearchFilterConfig, type ListFavorite } from '../../backend/search-filter.ts'
import { replenishmentListSearch } from '../search.ts'
export function replenishmentSearch(
  _: Translator,
  state: ListState,
  href: string,
  favorites: ListFavorite[] = [],
) {
  return {
    ...listSearchFilterConfig(_, {
      name: 'stock-replenishment-filter',
      bodyId: 'stock-replenishment-list',
      spec: replenishmentListSearch,
      state,
      favorites,
      applyInput: { listKey: replenishmentListSearch.key, returnTo: href },
      labels: { searchPlaceholder: _('stock_backend.replenishment') },
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
