import { defineModule } from '@ketvietlab/ketjs'
import { routes } from './routes.ts'
import { templatePageIsland } from './record/island.ts'
import { templateIslands } from './list/islands.ts'
export default defineModule({
  name: 'sale_template_backend',
  version: '0.1.0',
  depends: ['sale_template', 'sale_backend', 'backend', 'product_backend'],
  title: 'Sales template screens',
  category: 'Sales',
  assets: new URL('./client/', import.meta.url),
  islands: { ...templateIslands, 'sale-template.record': templatePageIsland },
  menus: {
    'sale.templates': {
      parent: 'admin.sale',
      label: 'sale_template.title',
      path: '/admin/sales/templates',
      needs: 'sale_template.listTemplates',
      for: ['sale_template.saveTemplate'],
      sequence: 2001,
    },
  },
  routes,
})
