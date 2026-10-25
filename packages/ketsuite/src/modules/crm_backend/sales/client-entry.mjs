// @ts-nocheck Browser entry: tools/build-backend-client.mjs bundles it into client/crm-sales-screen.mjs.
// The island is the one the server renders (islands.ts), with the admin's addresses.
import * as ds from '@ketvietlab/design-system'
import * as view from '@ketvietlab/ketjs-view'
import { createSalesIsland } from './island.mjs'
import { adminSalesRoutes } from './routes.mjs'

export const salesScreen = createSalesIsland({ view, ds, routes: adminSalesRoutes })
