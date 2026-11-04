import type { ServeContext } from '@ketvietlab/ketjs'
import { renderSaleCatalogue } from '../screens/catalogue.tsx'

export { saleCatalogueIsland } from '../screens/catalogue.tsx'
export const saleCatalogueRoute = (ctx: ServeContext) => renderSaleCatalogue(ctx)
