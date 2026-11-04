import type { ListState, Translator } from '@ketvietlab/ketjs'
import { listSearchFilterConfig, type ListFavorite } from '../../backend/search-filter.ts'
import { SCRAP_REASONS } from '../../stock/scrap-reasons.ts'
import { scrapListSearch } from '../search.ts'

const STATES = ['draft', 'done', 'reversed', 'cancel'] as const
export function scrapSearch(_: Translator, state: ListState, href: string, favorites: ListFavorite[] = []) {
  return {
    ...listSearchFilterConfig(_, {
      name: 'stock-scrap-filter',
      bodyId: 'stock-scrap-list',
      spec: scrapListSearch,
      state,
      favorites,
      applyInput: { listKey: scrapListSearch.key, returnTo: href },
      labels: { searchPlaceholder: _('stock_backend.scrap.search') },
      fieldChoices: {
        state: STATES.map((value) => ({ value, label: _(`stock_backend.scrap.state.${value}`) })),
        reason: SCRAP_REASONS.map((value) => ({ value, label: _(`stock_backend.scrap.reason.${value}`) })),
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
