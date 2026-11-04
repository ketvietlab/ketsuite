import type { ListState, Translator } from '@ketvietlab/ketjs'
import { listSearchFilterConfig, type ListFavorite } from '../../backend/search-filter.ts'
import { forecastListSearch } from '../search.ts'
export function forecastSearch(
  _: Translator,
  state: ListState,
  href: string,
  favorites: ListFavorite[] = [],
) {
  return {
    ...listSearchFilterConfig(_, {
      name: 'stock-forecast-filter',
      bodyId: 'stock-forecast-list',
      spec: forecastListSearch,
      state,
      favorites,
      applyInput: { listKey: forecastListSearch.key, returnTo: href },
      labels: { searchPlaceholder: _('stock_backend.forecast') },
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
