import stockBackend from './index.ts'
import { countSessionContextWith } from './modal/count-context.ts'
import type { CountSessionOptions } from './modal/count-context.ts'

export type StockBackendOptions = CountSessionOptions

/** Deployment-owned presentation choices; domain capabilities and permissions are unchanged. */
export function stockBackendWith(options: StockBackendOptions = {}) {
  if (!options.countPieces) return stockBackend
  return {
    ...stockBackend,
    routes: {
      ...stockBackend.routes,
      '/admin/stock/count-session/{id}/context': countSessionContextWith(options),
    },
  }
}
