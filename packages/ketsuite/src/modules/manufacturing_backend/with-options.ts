import manufacturingBackend from './index.ts'
import { orderRoute } from './routes.ts'
import type { ManufacturingOrderOptions } from './routes.ts'

export type ManufacturingBackendOptions = ManufacturingOrderOptions

/** Deployment-owned presentation choices; domain capabilities and permissions are unchanged. */
export function manufacturingBackendWith(options: ManufacturingBackendOptions = {}) {
  if (!options.countPieces) return manufacturingBackend
  return {
    ...manufacturingBackend,
    routes: {
      ...manufacturingBackend.routes,
      '/admin/manufacturing/orders/{id}': orderRoute(options),
    },
  }
}
