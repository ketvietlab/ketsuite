import type { ListState, Translator } from '@ketvietlab/ketjs'
import { listSearchFilterConfig, type ListFavorite } from '../../backend/search-filter.ts'
import { agingListSearch, moveAnalysisListSearch, moveHistoryListSearch } from '../search.ts'
import type { StockReport } from './shared.ts'

const SPECS = {
  analysis: moveAnalysisListSearch,
  aging: agingListSearch,
  history: moveHistoryListSearch,
} as const

export function stockReportSearch(
  report: StockReport,
  _: Translator,
  state: ListState,
  href: string,
  favorites: ListFavorite[] = [],
) {
  const spec = SPECS[report]
  return {
    ...listSearchFilterConfig(_, {
      name: `stock-${report}-filter`,
      bodyId: `stock-${report}-list`,
      spec,
      state,
      favorites,
      applyInput: { listKey: spec.key, returnTo: href },
      labels: { searchPlaceholder: _(`stock_backend.${report}.search`) },
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
