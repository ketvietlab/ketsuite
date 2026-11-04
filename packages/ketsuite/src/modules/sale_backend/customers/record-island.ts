import { defineRecordPageIsland } from '../../../ui/record-modal.tsx'
export const customerPageIsland = defineRecordPageIsland({
  kind: 'sale.customer',
  client: 'sale-customer-page.mjs',
  export: 'customerPage',
})
