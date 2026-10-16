import * as ds from '@ketvietlab/design-system'
import * as view from '@ketvietlab/ketjs-view'
import { defineIsland } from '@ketvietlab/ketjs-view'
import { createSalesIsland } from './sales/island.mjs'
import { adminSalesRoutes } from './sales/routes.mjs'
import { collectionIsland } from './import-collection.tsx'
import { importIsland } from './import-island.tsx'

/** A CRM sales screen, drawn whole by one island from `crm.sales.read`: the server sends its loading frame. */
type CrmSalesScreenProps = { screen: string; query?: string; lang?: string }

export const islands = {
  'crm.import-screen': importIsland,
  'crm.import-collection': collectionIsland,
  'crm.sales-screen': defineIsland<CrmSalesScreenProps>()({
    props: { screen: 'text', query: 'text?', lang: 'text?' },
    client: 'crm-sales-screen.mjs',
    export: 'salesScreen',
    view: createSalesIsland({ view, ds, routes: adminSalesRoutes }),
  }),
}
