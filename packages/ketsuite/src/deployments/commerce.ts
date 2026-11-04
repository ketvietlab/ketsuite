import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import type { OpenStore } from '@ketvietlab/ketjs'
import * as suite from '../index.ts'
import { companyCatalogueModules } from '../modules/product/company-catalogue.ts'
import { commerceRoleTemplates } from '../role-templates.ts'
import {
  commonBusinessModules,
  productDefaults,
  productPermissions,
  productQueues,
  productServe,
} from './common.ts'

// Commerce keeps its catalogue per company; existing databases are split once by
// `splitCatalogueByCompany` before this composition serves them.
const modules = companyCatalogueModules([
  ...commonBusinessModules.map((m) =>
    m.name === 'product_media'
      ? suite.productMediaWithWebsiteCatalog()
      : m.name === 'product_backend'
        ? suite.productBackendWith({ combinedInventoryTracking: true, variantPackagings: true })
        : m.name === 'stock'
          ? // A completed delivery counts on its sales order at once (K2).
            suite.moduleWithSaleDeliveries(
              suite.stockWithProductSuppliers({ make: suite.manufactureReplenishment }),
              [
                'completePicking',
                'validatePicking',
                // Handing a parcel over completes its delivery (K46).
                'handOverShipment',
                'handOverShipments',
              ],
            )
          : m.name === 'sale'
            ? suite.withSaleProductions(suite.saleWithLoyalty())
            : m,
  ),
  suite.websiteCatalog,
  suite.pricing,
  suite.crm,
  suite.saleTemplatesWithLoyalty(),
  suite.saleTemplatesBackend,
  suite.pricingBackend,
  // A cancelled or reversed sales invoice gives the order its quantity back (D10).
  suite.moduleWithSaleInvoices(suite.account, ['cancelMove', 'reverseMove']),
  suite.businessReportStaffChannel,
  suite.quality,
  suite.qualityStaffChannel,
  suite.purchase,
  suite.purchaseStaffChannel,
  suite.pos,
  suite.posBackend,
  suite.posChannel,
  suite.loyalty,
  suite.loyaltySale,
  suite.salePromotionBackend,
  suite.loyaltyPos,
  suite.purchaseBackend,
  suite.accountBackend,
  suite.manufacturing,
  suite.manufacturingBackend,
])

/** Commerce: selling, the counter, purchasing, stock, manufacturing and accounting. */
export const createCommerceDeployment = (openStore: OpenStore = sqliteStore) =>
  defineDeployment({
    name: 'commerce',
    // Every KetSuite row belongs to a company; KetJS scopes by company only on request.
    companies: true,
    datastore: 'commerce',
    modules,
    permissions: productPermissions(
      modules,
      Object.fromEntries(
        Object.entries(commerceRoleTemplates).map(([key, value]) => [
          key,
          key === 'commerce.company-administrator'
            ? {
                ...value,
                version: value.version + 1,
                bundles: [...value.bundles, 'website_catalog.view', 'website_catalog.configure'],
              }
            : value,
        ]),
      ),
    ),
    theme: suite.paperTheme,
    worker: { queues: productQueues },
    serve: {
      ...productServe(openStore),
      pages: { ...productServe(openStore).pages!, resolve: 'website_catalog.getEntryByPath' },
      defaults: productDefaults('commerce'),
    },
  })
