import type { ListState, Translator } from '@ketvietlab/ketjs'
import { listSearchFilterConfig, type ListFavorite } from '../../backend/search-filter.ts'
import { countListSearch } from '../search.ts'

const STATES = ['counting', 'review', 'done', 'cancel'] as const
export function countSearch(_: Translator, state: ListState, href: string, favorites: ListFavorite[] = []) {
  return {
    ...listSearchFilterConfig(_, {
      name: 'stock-count-filter',
      bodyId: 'stock-count-list',
      spec: countListSearch,
      state,
      favorites,
      applyInput: { listKey: countListSearch.key, returnTo: href },
      labels: { searchPlaceholder: _('stock_backend.count.search') },
      fieldChoices: {
        state: STATES.map((value) => ({ value, label: _(`stock_backend.count.state.${value}`) })),
      },
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
