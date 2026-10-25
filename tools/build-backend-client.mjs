// Builds shared admin island entries into browser-native ESM. KetJS serves its
// view runtime separately, so generated assets import that shared copy while
// bundling their local view dependencies into the immutable entry itself.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const UI_CLIENT_DIR = join(ROOT, 'packages/ketsuite/src/ui/client')
const BACKEND_CLIENT_DIR = join(ROOT, 'packages/ketsuite/src/modules/backend/design/client')
const DESIGN_SYSTEM_DIR = join(ROOT, 'packages/design-system/src')
const CRM_BACKEND_DIR = join(ROOT, 'packages/ketsuite/src/modules/crm_backend')
const USER_BACKEND_DIR = join(ROOT, 'packages/ketsuite/src/modules/user_backend')
const PRODUCT_BACKEND_DIR = join(ROOT, 'packages/ketsuite/src/modules/product_backend')
const entries = [
  {
    source: join(UI_CLIENT_DIR, 'communication-collections.tsx'),
    output: join(UI_CLIENT_DIR, 'communication-collections-bundle.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_billing/screens/charge-rule-modal.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_billing/client/charge-rule-modal.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/records/desk-booking-page.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/desk-booking-page.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/records/folio-page.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/folio-page.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/records/reservation-page.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/reservation-page.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/records/cleaning-task-page.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/cleaning-task-page.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/records/service-unit.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/service-unit.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/plan/room-plan.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/room-plan.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/collections/view.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/collection.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/collections/reservation-book.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/reservation-book.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/collections/stay-book.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/stay-book.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/collections/folio-book.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/folio-book.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_billing/collections/billing-book.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_billing/client/billing-book.mjs'),
  },

  {
    source: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/records/catalogue-modal.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/hospitality_core/client/catalogue-modal.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/purchase_backend/modal/pricelist-view.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/purchase_backend/client/vendor-pricelist-modal.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/sale_backend/modal/policy-view.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/sale_backend/client/invoicing-policy-modal.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/stock_backend/client/stock-transfer-modal.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/stock_backend/modal/inventory-view.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/stock_backend/client/inventory-count-modal.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/stock_backend/client/stock-configuration-modal.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/purchase_backend/modal/order-modal-view.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/purchase_backend/client/purchase-order-modal.mjs'),
  },
  {
    source: join(ROOT, 'packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'),
    output: join(ROOT, 'packages/ketsuite/src/modules/sale_backend/client/sale-order-modal.mjs'),
  },
  {
    source: join(DESIGN_SYSTEM_DIR, 'interactions/relation-select/index.tsx'),
    output: join(BACKEND_CLIENT_DIR, 'relation-select.mjs'),
  },
  {
    source: join(UI_CLIENT_DIR, 'ket-table-view.tsx'),
    output: join(BACKEND_CLIENT_DIR, 'ket-table.mjs'),
  },
  {
    source: join(UI_CLIENT_DIR, 'search-filter-view.tsx'),
    output: join(BACKEND_CLIENT_DIR, 'search-filter.mjs'),
  },
  {
    source: join(DESIGN_SYSTEM_DIR, 'interactions/lightbox/index.tsx'),
    output: join(BACKEND_CLIENT_DIR, 'lightbox.mjs'),
  },
  {
    source: join(UI_CLIENT_DIR, 'table-selection-view.tsx'),
    output: join(BACKEND_CLIENT_DIR, 'backend-shell.mjs'),
  },
  {
    source: join(UI_CLIENT_DIR, 'mail-entry.mjs'),
    output: join(UI_CLIENT_DIR, 'mail-bundle.mjs'),
  },
  {
    source: join(UI_CLIENT_DIR, 'activity-entry.mjs'),
    output: join(UI_CLIENT_DIR, 'activity-bundle.mjs'),
  },
  // The CRM sales screens: one island draws each of them whole.
  {
    source: join(CRM_BACKEND_DIR, 'sales/client-entry.mjs'),
    output: join(CRM_BACKEND_DIR, 'client/crm-sales-screen.mjs'),
  },
  {
    source: join(CRM_BACKEND_DIR, 'import-island.tsx'),
    output: join(CRM_BACKEND_DIR, 'client/crm-import.mjs'),
  },
  // The user record modal, including the users collection's create action.
  {
    source: join(USER_BACKEND_DIR, 'modal/user-modal-view.tsx'),
    output: join(USER_BACKEND_DIR, 'client/user-modal.mjs'),
  },
  // The role record modal, including the roles collection's create action.
  {
    source: join(USER_BACKEND_DIR, 'modal/role-modal-view.tsx'),
    output: join(USER_BACKEND_DIR, 'client/role-modal.mjs'),
  },
  // The access-rule record modal, including the rules collection's create action.
  {
    source: join(USER_BACKEND_DIR, 'modal/access-policy-modal-view.tsx'),
    output: join(USER_BACKEND_DIR, 'client/access-policy-modal.mjs'),
  },
  // The product template record modal, including the catalogue's create action.
  {
    source: join(PRODUCT_BACKEND_DIR, 'modal/product-modal-view.tsx'),
    output: join(PRODUCT_BACKEND_DIR, 'client/product-modal.mjs'),
  },
  {
    source: join(PRODUCT_BACKEND_DIR, 'modal/attribute-modal-view.tsx'),
    output: join(PRODUCT_BACKEND_DIR, 'client/attribute-modal.mjs'),
  },
  // The catalogue's list island.
  {
    source: join(PRODUCT_BACKEND_DIR, 'list/island.tsx'),
    output: join(PRODUCT_BACKEND_DIR, 'client/product-list.mjs'),
  },
  // The Units of measure list, and a unit's record modal over any admin page.
  {
    source: join(PRODUCT_BACKEND_DIR, 'units/island.tsx'),
    output: join(PRODUCT_BACKEND_DIR, 'client/uom-list.mjs'),
  },
  {
    source: join(PRODUCT_BACKEND_DIR, 'modal/uom-modal-view.tsx'),
    output: join(PRODUCT_BACKEND_DIR, 'client/uom-modal.mjs'),
  },
  // Loaded when the template modal opens its Attributes & variants tab.
  {
    source: join(UI_CLIENT_DIR, 'variant-editor-view.tsx'),
    output: join(PRODUCT_BACKEND_DIR, 'client/variant-editor.mjs'),
  },
]

/** @type {import('esbuild').Plugin} */
const ketViewRuntime = {
  name: 'ket-view-runtime',
  setup(build) {
    build.onResolve({ filter: /^@ketvietlab\/ketjs-view$/ }, () => ({
      path: '/_ket/view/index.js',
      external: true,
    }))
    build.onResolve({ filter: /^@ketvietlab\/ketjs-view\/jsx-runtime$/ }, () => ({
      path: '/_ket/view/jsx-runtime.js',
      external: true,
    }))
  },
}

/** @param {{ only?: string }} [options] */
export async function buildBackendClients(options = {}) {
  const available = entries.filter(
    ({ source, output }) =>
      existsSync(source) && (!options.only || output.endsWith(`/client/${options.only}.mjs`)),
  )
  await Promise.all(
    available.map(({ source, output }) =>
      esbuild.build({
        entryPoints: [source],
        outfile: output,
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        minify: true,
        // External rather than linked: a minified bundle's map inlines the
        // whole original source, so it is not something the asset mount will
        // serve (packages/ketjs/src/server/http.ts). Writing it without the
        // `sourceMappingURL` comment keeps it on disk for anyone debugging
        // locally without pointing every browser at a URL that must 404.
        sourcemap: 'external',
        banner: {
          js: '// @ts-nocheck Generated by tools/build-backend-client.mjs — do not edit.',
        },
        logLevel: 'warning',
        plugins: [ketViewRuntime],
      }),
    ),
  )
  return available.length
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = await buildBackendClients()
  console.log(`bundled ${built} backend client island${built === 1 ? '' : 's'}`)
}
