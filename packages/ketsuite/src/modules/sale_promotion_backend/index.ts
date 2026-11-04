import { defineModule } from '@ketvietlab/ketjs'
import { routes } from './routes.ts'
import { promotionPageIsland } from './record/island.ts'
import { promotionIslands } from './list/islands.ts'
import { messages } from './messages.ts'
export default defineModule({
  name: 'sale_promotion_backend',
  version: '0.1.0',
  depends: ['loyalty_sale', 'sale_backend', 'backend'],
  title: 'Sales promotion screens',
  category: 'Sales',
  assets: new URL('./client/', import.meta.url),
  islands: { ...promotionIslands, 'sale-promotion.record': promotionPageIsland },
  menus: {
    'sale.promotions': {
      parent: 'admin.sale',
      label: 'sale_promotion_backend.title',
      path: '/admin/sales/promotions',
      needs: 'loyalty_sale.listPrograms',
      sequence: 2002,
    },
  },
  routes,
  messages,
})
