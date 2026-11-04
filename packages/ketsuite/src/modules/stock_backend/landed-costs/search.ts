import type { ListState, Translator } from '@ketvietlab/ketjs'
import { listSearchFilterConfig, type ListFavorite } from '../../backend/search-filter.ts'
import { landedCostListSearch } from '../search.ts'

export const LANDED_COST_STATES = ['draft', 'posted', 'cancel'] as const
export function landedCostSearch(
  _: Translator,
  state: ListState,
  href: string,
  favorites: ListFavorite[] = [],
) {
  return {
    ...listSearchFilterConfig(_, {
      name: 'stock-landed-cost-filter',
      bodyId: 'stock-landed-cost-list',
      spec: landedCostListSearch,
      state,
      favorites,
      applyInput: { listKey: landedCostListSearch.key, returnTo: href },
      labels: { searchPlaceholder: _('stock_backend.landedCost.search') },
      fieldChoices: {
        state: LANDED_COST_STATES.map((value) => ({
          value,
          label: _(`stock_backend.landedCost.state.${value}`),
        })),
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
