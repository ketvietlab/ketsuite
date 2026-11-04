// The catalogue's place in the sidebar.
//
// It lives in the bridge, with the route it points at: install the admin without
// the catalogue and neither the entry nor the page exists. `needs` names the
// function behind the screen, so an account that may not list templates is not
// offered a screen that lists them.

import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  'admin.product': { parent: 'admin', label: 'menu.app', icon: 'package', sequence: 20 },
  'admin.product.categories': {
    parent: 'admin.product',
    label: 'category.title',
    path: '/admin/product/categories',
    needs: 'product_backend.searchCategories',
    sequence: 10,
  },
  'admin.product.imports': {
    parent: 'admin.product',
    label: 'import.title',
    path: '/admin/product/imports',
    needs: 'product_backend.searchImports',
    sequence: 35,
  },
  'admin.product.combos': {
    parent: 'admin.product',
    label: 'combo.title',
    path: '/admin/product/combos',
    needs: 'product_backend.searchCombos',
    sequence: 30,
  },
  'admin.product.tags': {
    parent: 'admin.product',
    label: 'tag.title',
    path: '/admin/product/tags',
    needs: 'product_backend.searchTags',
    sequence: 20,
  },
  product: { label: 'menu.app', icon: 'package', sequence: 20 },
  'product.templates': {
    parent: 'product',
    label: 'menu.templates',
    path: '/admin/product/templates',
    needs: 'product.listTemplates',
    sequence: 1010,
  },
  'product.variants': {
    parent: 'product',
    label: 'menu.variants',
    path: '/admin/product/variants',
    needs: 'product_backend.searchVariants',
    sequence: 1015,
  },
  // Attributes and units are configuration: behind the gear, after the catalogue's other settings, so the
  // sidebar keeps the daily work of products and variants (owner #1665, D6).
  'product.attributes': {
    parent: 'admin.product',
    label: 'menu.attributes',
    path: '/admin/product/attributes',
    needs: 'product.listAttributes',
    sequence: 40,
  },
  'product.uoms': {
    parent: 'admin.product',
    label: 'menu.uoms',
    path: '/admin/product/uoms',
    needs: 'product_backend.searchUnits',
    sequence: 50,
  },
}
