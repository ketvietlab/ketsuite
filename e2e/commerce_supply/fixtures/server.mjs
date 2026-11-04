// Seeds a fresh SQLite database and serves the Commerce deployment over it, for the browser
// tests of what only Commerce composes: replenishment that buys from a product's suppliers
// (P48–P50). The product tests serve the standalone KetSuite workspace, whose Stock keeps
// route-only replenishment. KetJS is imported from the copy the built KetSuite resolves, so
// the seed and the served deployment share one module instance.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bootRuntime,
  callFn,
  migrateOne,
  sqliteStore,
} from '../../../node_modules/@ketvietlab/ketjs/dist/index.js'
import { ketsuiteDeployments } from '../../../packages/ketsuite/dist/deployment.js'
import { PASSWORD, PORT } from '../../product_backend/fixtures/users.mjs'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const runtimeDir = mkdtempSync(join(tmpdir(), 'ketsuite-commerce-supply-e2e-'))
const env = {
  ...process.env,
  KET_SQLITE: join(runtimeDir, 'commerce.sqlite'),
  KET_STORAGE_DIR: join(runtimeDir, 'storage'),
  KET_SECRET: 'commerce-supply-e2e-secret-0123456789',
  KET_LOCALE: 'vi',
  KET_FALLBACK_LOCALE: 'vi',
  KET_LOG: 'null',
}

const seed = async () => {
  const deployment = ketsuiteDeployments.commerce
  const runtime = await bootRuntime(deployment, { env })
  const adapter = await (deployment.serve.openStore ?? sqliteStore)(runtime.config)
  await migrateOne(adapter, runtime.manifest)
  let scope = { company: null, branch: null }
  let admin = null
  const call = async (name, input, actor = admin) => {
    const result = await callFn(name, input, { adapter, manifest: runtime.manifest, actor, scope })
    if (result.ok === false || result.value?.ok === false)
      throw new Error(`${name}: ${JSON.stringify(result.value?.errors ?? result.error ?? result.value)}`)
    return result.value
  }

  const tenant = await call(
    'user.provisionAdmin',
    {
      companyName: 'Mỹ phẩm Lá Xanh',
      companyCode: 'LX',
      currency: 'VND',
      adminLogin: 'admin',
      adminName: 'Chủ doanh nghiệp',
      adminPassword: PASSWORD,
    },
    'system:provision',
  )
  admin = tenant.userId
  await call('user.syncRoleTemplates', {}, 'system:role-templates')
  scope = { company: tenant.companyId, companies: [tenant.companyId], branch: tenant.branchId }
  // A warehouse operator reads supplier choices but no purchase price (P48).
  await call('user.createUser', { id: 'thukho', login: 'thukho', name: 'Thủ kho', password: PASSWORD }, null)
  await call('user.grantCompany', { id: 'thukho:company', userId: 'thukho', companyId: tenant.companyId })
  await call('user.grantBranch', { id: 'thukho:branch', userId: 'thukho', branchId: tenant.branchId })
  await call('user.assignRole', {
    id: 'thukho:commerce.warehouse-operator',
    userId: 'thukho',
    roleId: 'commerce.warehouse-operator',
  })

  await call('uom.saveUnit', { id: 'pack', name: 'Gói', relativeFactor: '1' })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Kho Hồ Chí Minh', code: 'HCM' })
  // The few accounts Tạo hoá đơn posts to, as the demo writes them.
  await call('account.initializeCompany', {})
  for (const [id, code, name, accountType] of [
    ['acc-511', '511', 'Doanh thu bán hàng', 'income'],
    ['acc-156', '156', 'Hàng hóa', 'asset_current'],
    ['acc-642', '642', 'Chi phí quản lý', 'expense'],
    ['acc-131', '131', 'Phải thu của khách hàng', 'asset_receivable'],
    ['acc-331', '331', 'Phải trả cho người bán', 'liability_payable'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveDefaults', {
    incomeAccountId: 'acc-511',
    expenseAccountId: 'acc-642',
    goodsPurchaseAccountId: 'acc-156',
    servicePurchaseAccountId: 'acc-642',
    receivableAccountId: 'acc-131',
    payableAccountId: 'acc-331',
  })
  await call('account.saveJournal', {
    id: 'journal-sale',
    name: 'Sổ bán hàng',
    code: 'INV',
    type: 'sale',
    defaultAccountId: 'acc-511',
  })
  // C26 (K23): the stock journal posts every transfer done from here on, so it is on before the first.
  for (const [id, code, name, accountType, reconcile] of [
    ['acc-151', '151', 'Hàng mua đang đi đường', 'asset_current', false],
    ['acc-1541', '1541', 'Chi phí sản xuất dở dang', 'asset_current', false],
    ['acc-632', '632', 'Giá vốn hàng bán', 'expense_direct_cost', false],
    ['acc-33811', '33811', 'Tài sản thừa chờ giải quyết', 'liability_current', true],
    ['acc-13811', '13811', 'Tài sản thiếu chờ xử lý', 'asset_receivable', true],
  ])
    await call('account.saveAccount', { id, code, name, accountType, reconcile })
  await call('account.saveJournal', {
    id: 'journal-kho',
    name: 'Sổ nhật ký Kho',
    code: 'KHO',
    type: 'general',
  })
  await call('stock.saveAccountingSetting', {
    journalId: 'journal-kho',
    valuationAccountId: 'acc-156',
    supplierAccountId: 'acc-151',
    productionAccountId: 'acc-1541',
    cogsAccountId: 'acc-632',
    gainAccountId: 'acc-33811',
    lossAccountId: 'acc-13811',
  })
  // Two suppliers, a customer, and a partner the company has not yet sold to or bought from.
  for (const [id, name, role] of [
    ['vendor-east', 'Công ty CP Hóa mỹ phẩm Đông Á', 'supplier'],
    ['vendor-lotus', 'Công ty TNHH Bông Sen Việt', 'supplier'],
    ['spa', 'Spa Hoa Mai', 'customer'],
    ['contact', 'Cửa hàng Mới Mở', null],
  ]) {
    await call('partner.savePartner', { id, kind: 'company', name })
    if (role) await call('partner.grantRole', { id: `${id}:${role}`, partnerId: id, role })
  }
  // TM-001 as the mock has it: Đông Á from 500 packs at 17.200 ₫, 10 days; Bông Sen Việt from
  // 100 packs at 18.000 ₫, 5 days, in that order (P48, P49).
  await call('product.saveTemplate', {
    id: 'pads',
    name: 'Bông tẩy trang 120 miếng',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'TM-001',
    listPrice: '39000',
    saleOk: true,
    purchaseOk: true,
    // C22: shown on an order of it once the company turns sale warnings on.
    saleWarning: 'Hàng dễ móp, đóng thêm thùng.',
  })
  // TM-002 has the same two suppliers, for a rule of its own that names one.
  await call('product.saveTemplate', {
    id: 'pads-mini',
    name: 'Bông tẩy trang mini',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'TM-002',
    listPrice: '25000',
    saleOk: true,
    purchaseOk: true,
  })
  for (const templateId of ['pads', 'pads-mini']) {
    await call('stock.configureProduct', { templateId, isStorable: true, tracking: 'none' })
    for (const [suffix, partnerId, minQty, price, delay, sequence] of [
      ['east', 'vendor-east', '500', '17200', 10, 1],
      ['lotus', 'vendor-lotus', '100', '18000', 5, 2],
    ])
      await call('purchase.saveSupplierInfo', {
        id: `${templateId}-${suffix}`,
        partnerId,
        productTemplateId: templateId,
        productUomId: 'pack',
        minQty,
        price,
        delay,
        sequence,
      })
  }
  // A storable product nobody supplies yet: its supplier rule needs a lead time of its own.
  await call('product.saveTemplate', {
    id: 'towel',
    name: 'Khăn bông chưa có nhà cung cấp',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'KB-01',
    listPrice: '60000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('stock.configureProduct', { templateId: 'towel', isStorable: true, tracking: 'none' })

  // C16 (P8, P14, P35): a product counted by quantity with stock on hand, one with none, a box
  // of the pack unit, an invoice policy other than the default, and a delivery to open as is.
  await call('stock.saveLocation', { id: 'adjust', name: 'Điều chỉnh tồn', usage: 'inventory' })
  await call('uom.saveUnit', { id: 'box6', name: 'Hộp 6 gói', relativeUomId: 'pack', relativeFactor: '6' })
  for (const [id, name, code, onHand] of [
    ['cream', 'Kem dưỡng có tồn', 'TM-010', '5'],
    ['gel', 'Gel rửa mặt chưa có tồn', 'TM-011', null],
  ]) {
    await call('product.saveTemplate', {
      id,
      name,
      type: 'goods',
      uomId: 'pack',
      defaultCode: code,
      listPrice: '120000',
      saleOk: true,
      purchaseOk: true,
    })
    await call('stock.configureProduct', { templateId: id, isStorable: true, tracking: 'none' })
    if (onHand)
      await call('stock.adjustInventory', {
        id: `count-${id}`,
        productId: `${id}:default`,
        locationId: 'wh:stock',
        inventoryLocationId: 'adjust',
        countedQuantity: onHand,
        productUomId: 'pack',
      })
  }
  await call('sale.setInvoicePolicy', { templateId: 'gel', invoicePolicy: 'delivery' })
  // A lot of the product on the delivery, and one of a product that is not on it.
  await call('stock.createLot', { id: 'lot-cream', productId: 'cream:default', name: 'KD-2601' })
  await call('stock.createLot', { id: 'lot-pads', productId: 'pads:default', name: 'BT-2601' })
  await call('stock.createPicking', {
    id: 'delivery-cream',
    name: 'HCM/OUT/0001',
    pickingTypeId: 'wh:outgoing',
    scheduledDate: '2026-10-28T08:30:00.000Z',
  })
  await call('stock.addMove', {
    id: 'delivery-cream-move',
    name: 'Kem dưỡng có tồn',
    pickingId: 'delivery-cream',
    productId: 'cream:default',
    productUomId: 'pack',
    productUomQty: '2',
  })
  // C24 (K24, K30): a confirmed receipt of a product tracked by lot, kept a year, to take in on its page.
  await call('product.saveTemplate', {
    id: 'serum-lot',
    name: 'Serum theo lô',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'TM-024',
    listPrice: '150000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('stock.configureProduct', {
    templateId: 'serum-lot',
    isStorable: true,
    tracking: 'lot',
    shelfLifeMonths: 12,
  })
  await call('stock.createPicking', {
    id: 'receipt-serum',
    name: 'HCM/IN/0024',
    pickingTypeId: 'wh:incoming',
    scheduledDate: '2026-10-27T02:00:00.000Z',
  })
  await call('stock.addMove', {
    id: 'receipt-serum-move',
    name: 'Serum theo lô',
    pickingId: 'receipt-serum',
    productId: 'serum-lot:default',
    productUomId: 'pack',
    productUomQty: '4',
  })
  await call('stock.confirmPicking', { id: 'receipt-serum' })
  // C21 (D31b): a member's quotation, 360.000 ₫ before tax, that an automatic promotion reaches, with a
  // code and a points card. The programs take only the members' pricelist, so no other quotation gets them.
  await call(
    'user.createUser',
    { id: 'reader', login: 'reader', name: 'Kiểm toán', password: PASSWORD },
    null,
  )
  await call('user.grantCompany', { id: 'reader:company', userId: 'reader', companyId: tenant.companyId })
  await call('user.grantBranch', { id: 'reader:branch', userId: 'reader', branchId: tenant.branchId })
  await call('user.assignRole', {
    id: 'reader:commerce.tenant-auditor',
    userId: 'reader',
    roleId: 'commerce.tenant-auditor',
  })
  await call('pricing.savePricelist', { id: 'members', name: 'Giá thành viên' })
  await call('partner.savePartner', { id: 'member', kind: 'person', name: 'Chị Lan thành viên' })
  await call('partner.grantRole', { id: 'member:customer', partnerId: 'member', role: 'customer' })
  await call('loyalty_sale.saveProgram', {
    values: {
      name: 'Giảm 10% đơn từ 200.000',
      programType: 'promotion',
      minimumAmount: '200000',
      discount: '10',
      pricelistIds: ['members'],
    },
  })
  await call('loyalty_sale.saveProgram', {
    values: {
      name: 'Mã chào hè',
      programType: 'promo_code',
      code: 'CHAOHE',
      discountMode: 'per_order',
      discount: '15000',
      pricelistIds: ['members'],
    },
  })
  const card = await call('loyalty_sale.saveProgram', {
    values: {
      name: 'Thẻ thành viên',
      programType: 'loyalty',
      requiredPoints: '50',
      pointStep: '10000',
      discountMode: 'per_order',
      discount: '20000',
      pricelistIds: ['members'],
    },
  })
  await call('loyalty.wallet.create', {
    id: 'member-card',
    programId: card.id,
    partnerId: 'member',
    initialBalance: '120',
  })
  await call('sale.createOrder', {
    id: 'quote-benefits',
    partnerId: 'member',
    warehouseId: 'wh',
    pricelistId: 'members',
  })
  await call('sale.addLine', {
    id: 'quote-benefits:cream',
    orderId: 'quote-benefits',
    productId: 'cream:default',
    productUomId: 'pack',
    productUomQty: '3',
    priceUnit: '120000',
  })
  // C22 (D32): the spa's quotation of a cream, and a cancelled one that shows no warning. Warnings are
  // off until the spec turns them on.
  for (const id of ['quote-warning', 'quote-warning-cancelled']) {
    await call('sale.createOrder', { id, partnerId: 'spa', warehouseId: 'wh' })
    await call('sale.addLine', {
      id: `${id}:cream`,
      orderId: id,
      productId: 'cream:default',
      productUomId: 'pack',
      productUomQty: '2',
      priceUnit: '120000',
    })
  }
  await call('sale.cancelOrder', { id: 'quote-warning-cancelled' })
  // C23 (D33): a confirmed order of a product invoiced as delivered (with stock) and one invoiced as
  // ordered, whose delivery ships more than was ordered.
  await call('product.saveTemplate', {
    id: 'mask',
    name: 'Mặt nạ giao theo số giao',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'MN-01',
    listPrice: '50000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('stock.configureProduct', { templateId: 'mask', isStorable: true, tracking: 'none' })
  await call('sale.setInvoicePolicy', { templateId: 'mask', invoicePolicy: 'delivery' })
  await call('stock.adjustInventory', {
    id: 'count-mask',
    productId: 'mask:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjust',
    countedQuantity: '10',
    productUomId: 'pack',
  })
  await call('sale.createOrder', { id: 'order-over', partnerId: 'spa', warehouseId: 'wh' })
  for (const [line, productId, qty, price] of [
    ['mask', 'mask:default', '2', '50000'],
    ['cream', 'cream:default', '1', '120000'],
  ])
    await call('sale.addLine', {
      id: `order-over:${line}`,
      orderId: 'order-over',
      productId,
      productUomId: 'pack',
      productUomQty: qty,
      priceUnit: price,
    })
  await call('sale.confirmOrder', { id: 'order-over' })
  // C25 (D33b): a confirmed order whose mask went out on its delivery; the gel and the lotion still
  // wait on the backorder, so its grid may remove one and give the other another product.
  // Its products are its own, so no other spec counts what it adds or cancels (replenishment does).
  for (const [id, name, code, price] of [
    ['lotion', 'Sữa dưỡng thể chờ giao', 'SD-01', '80000'],
    ['scrub', 'Tẩy tế bào chết thay thế', 'TB-01', '95000'],
    ['oil', 'Dầu tẩy trang thêm sau', 'DT-01', '150000'],
  ])
    await call('product.saveTemplate', {
      id,
      name,
      type: 'goods',
      uomId: 'pack',
      defaultCode: code,
      listPrice: price,
      saleOk: true,
      purchaseOk: true,
    })
  await call('sale.createOrder', { id: 'order-grid', partnerId: 'spa', warehouseId: 'wh' })
  for (const [line, productId, qty, price] of [
    ['mask', 'mask:default', '1', '50000'],
    ['gel', 'gel:default', '1', '120000'],
    ['lotion', 'lotion:default', '2', '80000'],
  ])
    await call('sale.addLine', {
      id: `order-grid:${line}`,
      orderId: 'order-grid',
      productId,
      productUomId: 'pack',
      productUomQty: qty,
      priceUnit: price,
    })
  await call('sale.confirmOrder', { id: 'order-grid' })
  await call('stock.confirmPicking', { id: 'order-grid:delivery' })
  const shipped = (await call('stock.getPicking', { id: 'order-grid:delivery' })).moves.find(
    (move) => move.productId === 'mask:default',
  )
  await call('stock.reserveMove', { id: shipped.id })
  const [maskLine] = (await call('stock.getPicking', { id: 'order-grid:delivery' })).moves.find(
    (move) => move.id === shipped.id,
  ).lines
  await call('stock.completePicking', {
    id: 'order-grid:delivery',
    quantities: [{ moveLineId: maskLine.id, quantity: 1 }],
    createBackorder: true,
  })
  // C26 (K22–K26): 10 packs counted at 100.000 ₫; an order of 4 sends 2, the other 2 wait on the
  // backorder; then 2 come in at 200.000 ₫, so the average is 1.200.000 ₫ ÷ 10 = 120.000 ₫.
  await call('product.saveTemplate', {
    id: 'serum-cost',
    name: 'Serum giá vốn bình quân',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'SV-01',
    listPrice: '250000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('stock.configureProduct', { templateId: 'serum-cost', isStorable: true, tracking: 'none' })
  await call('product.setCost', { productId: 'serum-cost:default', standardPrice: '100000' })
  await call('stock.adjustInventory', {
    id: 'count-serum-cost',
    productId: 'serum-cost:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjust',
    countedQuantity: '10',
    productUomId: 'pack',
  })
  await call('sale.createOrder', { id: 'order-cost', partnerId: 'spa', warehouseId: 'wh' })
  await call('sale.addLine', {
    id: 'order-cost:serum',
    orderId: 'order-cost',
    productId: 'serum-cost:default',
    productUomId: 'pack',
    productUomQty: '4',
    priceUnit: '250000',
  })
  await call('sale.confirmOrder', { id: 'order-cost' })
  await call('stock.confirmPicking', { id: 'order-cost:delivery' })
  const [serumMove] = (await call('stock.getPicking', { id: 'order-cost:delivery' })).moves
  await call('stock.reserveMove', { id: serumMove.id })
  const [serumLine] = (await call('stock.getPicking', { id: 'order-cost:delivery' })).moves[0].lines
  const { backorderId } = await call('stock.completePicking', {
    id: 'order-cost:delivery',
    quantities: [{ moveLineId: serumLine.id, quantity: 2 }],
    createBackorder: true,
  })
  // The two left are held on the backorder, ready to complete on its page.
  await call('stock.reserveMove', { id: (await call('stock.getPicking', { id: backorderId })).moves[0].id })
  await call('stock.createPicking', {
    id: 'receipt-cost',
    name: 'HCM/IN/0026',
    pickingTypeId: 'wh:incoming',
  })
  await call('stock.addMove', {
    id: 'receipt-cost-move',
    name: 'Serum giá vốn bình quân',
    pickingId: 'receipt-cost',
    productId: 'serum-cost:default',
    productUomId: 'pack',
    productUomQty: '2',
  })
  await call('stock.confirmPicking', { id: 'receipt-cost' })
  await call('stock.saveMoveLine', { id: 'receipt-cost-line', moveId: 'receipt-cost-move', quantity: '2' })
  await call('stock.setReceiptUnitCost', { id: 'receipt-cost-line', unitCost: '200000' })
  await call('stock.completePicking', { id: 'receipt-cost', createBackorder: false })
  // C26 (R5): a delivery holding 2 gift boxes, completed with nothing ticked; and one of the gel, which
  // has no stock, so nothing is held to complete.
  await call('product.saveTemplate', {
    id: 'gift',
    name: 'Hộp quà giao ngay',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'GH-01',
    listPrice: '90000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('stock.configureProduct', { templateId: 'gift', isStorable: true, tracking: 'none' })
  await call('product.setCost', { productId: 'gift:default', standardPrice: '60000' })
  await call('stock.adjustInventory', {
    id: 'count-gift',
    productId: 'gift:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjust',
    countedQuantity: '3',
    productUomId: 'pack',
  })
  for (const [id, name, productId, product] of [
    ['delivery-held', 'HCM/OUT/0026', 'gift:default', 'Hộp quà giao ngay'],
    ['delivery-idle', 'HCM/OUT/0027', 'gel:default', 'Gel rửa mặt chưa có tồn'],
  ]) {
    await call('stock.createPicking', { id, name, pickingTypeId: 'wh:outgoing' })
    await call('stock.addMove', {
      id: `${id}-move`,
      name: product,
      pickingId: id,
      productId,
      productUomId: 'pack',
      productUomQty: '2',
    })
    await call('stock.confirmPicking', { id })
  }
  await call('stock.reserveMove', { id: 'delivery-held-move' })
  // M12 (#1389, #1400, #1404): goods counted 4 at 50.000 ₫ for the move analysis and the aging; a done
  // receipt of 2 masks at 100.000 ₫ whose value is adjusted; an accountant, and a confirmed order of a
  // product invoiced as ordered for them to invoice, cancel and invoice again.
  for (const [id, name, code, cost] of [
    ['aged', 'Nước hoa hồng tồn kho', 'NH-01', '50000'],
    ['reval', 'Mặt nạ điều chỉnh giá', 'MN-40', '100000'],
    ['billed', 'Son dưỡng lập hoá đơn', 'SD-40', '40000'],
  ]) {
    await call('product.saveTemplate', {
      id,
      name,
      type: 'goods',
      uomId: 'pack',
      defaultCode: code,
      listPrice: '150000',
      saleOk: true,
      purchaseOk: true,
    })
    await call('stock.configureProduct', { templateId: id, isStorable: true, tracking: 'none' })
    await call('product.setCost', { productId: `${id}:default`, standardPrice: cost })
  }
  await call('stock.adjustInventory', {
    id: 'count-aged',
    productId: 'aged:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjust',
    countedQuantity: '4',
    productUomId: 'pack',
  })
  await call('stock.createPicking', {
    id: 'receipt-reval',
    name: 'HCM/IN/0040',
    pickingTypeId: 'wh:incoming',
  })
  await call('stock.addMove', {
    id: 'receipt-reval-move',
    name: 'Mặt nạ điều chỉnh giá',
    pickingId: 'receipt-reval',
    productId: 'reval:default',
    productUomId: 'pack',
    productUomQty: '2',
  })
  await call('stock.confirmPicking', { id: 'receipt-reval' })
  await call('stock.saveMoveLine', { id: 'receipt-reval-line', moveId: 'receipt-reval-move', quantity: '2' })
  await call('stock.completePicking', { id: 'receipt-reval', createBackorder: false })
  await call('user.createUser', { id: 'ketoan', login: 'ketoan', name: 'Kế toán', password: PASSWORD }, null)
  await call('user.grantCompany', { id: 'ketoan:company', userId: 'ketoan', companyId: scope.company })
  await call('user.grantBranch', { id: 'ketoan:branch', userId: 'ketoan', branchId: scope.branch })
  await call('user.assignRole', {
    id: 'ketoan:commerce.accountant',
    userId: 'ketoan',
    roleId: 'commerce.accountant',
  })
  await call('sale.createOrder', { id: 'order-billed', partnerId: 'spa', warehouseId: 'wh' })
  await call('sale.addLine', {
    id: 'order-billed:balm',
    orderId: 'order-billed',
    productId: 'billed:default',
    productUomId: 'pack',
    productUomQty: '2',
    priceUnit: '150000',
  })
  await call('sale.confirmOrder', { id: 'order-billed' })
  // C27 (K19): 5 TH-01 counted; order-return delivered all 3 it sold, so the customer may send them back.
  await call('product.saveTemplate', {
    id: 'returned',
    name: 'Tinh dầu khách trả',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'TH-01',
    listPrice: '150000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('stock.configureProduct', { templateId: 'returned', isStorable: true, tracking: 'none' })
  await call('product.setCost', { productId: 'returned:default', standardPrice: '80000' })
  await call('stock.adjustInventory', {
    id: 'count-returned',
    productId: 'returned:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjust',
    countedQuantity: '5',
    productUomId: 'pack',
  })
  await call('sale.createOrder', { id: 'order-return', partnerId: 'spa', warehouseId: 'wh' })
  await call('sale.addLine', {
    id: 'order-return:oil',
    orderId: 'order-return',
    productId: 'returned:default',
    productUomId: 'pack',
    productUomQty: '3',
    priceUnit: '150000',
  })
  await call('sale.confirmOrder', { id: 'order-return' })
  await call('stock.confirmPicking', { id: 'order-return:delivery' })
  const [oilMove] = (await call('stock.getPicking', { id: 'order-return:delivery' })).moves
  await call('stock.reserveMove', { id: oilMove.id })
  const [oilLine] = (await call('stock.getPicking', { id: 'order-return:delivery' })).moves[0].lines
  await call('stock.completePicking', {
    id: 'order-return:delivery',
    quantities: [{ moveLineId: oilLine.id, quantity: 3 }],
    createBackorder: false,
  })
  // C29 (K-CONSU): gift bags are not kept in stock; order-unstocked sold 4 and its delivery waits.
  await call('product.saveTemplate', {
    id: 'unstocked',
    name: 'Túi giấy quà tặng',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'TG-01',
    listPrice: '5000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('stock.configureProduct', { templateId: 'unstocked', isStorable: false, tracking: 'none' })
  await call('sale.createOrder', { id: 'order-unstocked', partnerId: 'spa', warehouseId: 'wh' })
  await call('sale.addLine', {
    id: 'order-unstocked:bag',
    orderId: 'order-unstocked',
    productId: 'unstocked:default',
    productUomId: 'pack',
    productUomQty: '4',
    priceUnit: '5000',
  })
  await call('sale.confirmOrder', { id: 'order-unstocked' })
  await call('stock.confirmPicking', { id: 'order-unstocked:delivery' })
  // C30 (K21): order-bound sold 2 gift bags; its delivery is confirmed and follows the order.
  await call('sale.createOrder', { id: 'order-bound', partnerId: 'spa', warehouseId: 'wh' })
  await call('sale.addLine', {
    id: 'order-bound:bag',
    orderId: 'order-bound',
    productId: 'unstocked:default',
    productUomId: 'pack',
    productUomQty: '2',
    priceUnit: '5000',
  })
  await call('sale.confirmOrder', { id: 'order-bound' })
  await call('stock.confirmPicking', { id: 'order-bound:delivery' })
  // M13 (#1405–#1413): a cleanser not kept in stock; Nhà thuốc Bình An owes 300.000 ₫ on a confirmed
  // order against a limit of 100.000 ₫ and has a quotation open; a VIP pricelist 20% off for a draft
  // quotation to take; Salon Ngọc Trâm's confirmed order of 300.000 ₫ for an accountant's deposit.
  await call('product.saveTemplate', {
    id: 'm13',
    name: 'Sữa rửa mặt bán hàng',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'SR-13',
    listPrice: '150000',
    saleOk: true,
  })
  await call('stock.configureProduct', { templateId: 'm13', isStorable: false, tracking: 'none' })
  for (const [id, name] of [
    ['debtor', 'Nhà thuốc Bình An'],
    ['depositor', 'Salon Ngọc Trâm'],
  ]) {
    await call('partner.savePartner', { id, kind: 'company', name })
    await call('partner.grantRole', { id: `${id}:customer`, partnerId: id, role: 'customer' })
  }
  await call('sale.saveCustomerCredit', { partnerId: 'debtor', expectedRevision: 0, creditLimit: '100000' })
  // D9: a bank journal a deposit is collected into.
  await call('account.saveAccount', {
    id: 'acc-112',
    code: '112',
    name: 'Tiền gửi ngân hàng',
    accountType: 'asset_cash',
  })
  await call('account.saveJournal', {
    id: 'journal-bank',
    name: 'Ngân hàng',
    code: 'BNK',
    type: 'bank',
    defaultAccountId: 'acc-112',
  })
  await call('pricing.savePricelist', { id: 'vip', name: 'Bảng giá VIP', sequence: 50 })
  await call('pricing.savePricelistItem', {
    id: 'vip-percent',
    pricelistId: 'vip',
    appliedOn: '3_global',
    computePrice: 'percentage',
    percentPrice: '20',
  })
  for (const [id, partnerId, quantity, confirm] of [
    ['order-credit', 'debtor', '2', true],
    ['quote-credit', 'debtor', '1', false],
    ['quote-reprice', 'spa', '1', false],
    ['order-deposit', 'depositor', '2', true],
  ]) {
    // No pricelist: the members' one, first in the company, would bring C21's promotion (D14).
    await call('sale.createOrder', { id, partnerId, warehouseId: 'wh', pricelistId: null })
    await call('sale.addLine', {
      id: `${id}:cleanser`,
      orderId: id,
      productId: 'm13:default',
      productUomId: 'pack',
      productUomQty: quantity,
      priceUnit: '150000',
    })
    if (confirm) await call('sale.confirmOrder', { id })
  }
  // M14 (#1414–#1421): a serum kept by lot, SL-HET expired ten days ago and SL-CON good for a year;
  // an empty draft transfer; a confirmed one of a toner with no stock, to cancel; a done receipt of 2
  // sunscreens at 100.000 ₫ for a landed cost.
  const day = 24 * 60 * 60 * 1000
  for (const [id, name, code, tracking] of [
    ['m14-lot', 'Serum hạn dùng', 'SL-14', 'lot'],
    ['m14-cancel', 'Toner hủy phiếu', 'TH-14', 'none'],
    ['landed', 'Kem chống nắng chi phí', 'CN-64', 'none'],
  ]) {
    await call('product.saveTemplate', {
      id,
      name,
      type: 'goods',
      uomId: 'pack',
      defaultCode: code,
      listPrice: '150000',
      saleOk: true,
      purchaseOk: true,
    })
    await call('stock.configureProduct', { templateId: id, isStorable: true, tracking })
  }
  for (const [id, name, offset, counted] of [
    ['lot-expired', 'SL-HET', -10, '3'],
    ['lot-fresh', 'SL-CON', 365, '5'],
  ]) {
    // A civil day, as the lot's date field keeps it.
    const expirationDate = `${new Date(Date.now() + offset * day).toISOString().slice(0, 10)}T00:00:00Z`
    await call('stock.createLot', { id, productId: 'm14-lot:default', name, expirationDate })
    await call('stock.adjustInventory', {
      id: `count-${id}`,
      productId: 'm14-lot:default',
      locationId: 'wh:stock',
      inventoryLocationId: 'adjust',
      countedQuantity: counted,
      productUomId: 'pack',
      lotId: id,
    })
  }
  await call('stock.createPicking', {
    id: 'picking-empty',
    name: 'HCM/INT/0901',
    pickingTypeId: 'wh:internal',
  })
  await call('stock.createPicking', {
    id: 'picking-cancel',
    name: 'HCM/INT/0902',
    pickingTypeId: 'wh:internal',
  })
  await call('stock.addMove', {
    id: 'picking-cancel-move',
    name: 'Toner hủy phiếu',
    pickingId: 'picking-cancel',
    productId: 'm14-cancel:default',
    productUomId: 'pack',
    productUomQty: '1',
  })
  await call('stock.confirmPicking', { id: 'picking-cancel' })
  await call('product.setCost', { productId: 'landed:default', standardPrice: '100000' })
  await call('stock.createPicking', {
    id: 'receipt-landed',
    name: 'HCM/IN/0064',
    pickingTypeId: 'wh:incoming',
  })
  await call('stock.addMove', {
    id: 'receipt-landed-move',
    name: 'Kem chống nắng chi phí',
    pickingId: 'receipt-landed',
    productId: 'landed:default',
    productUomId: 'pack',
    productUomQty: '2',
  })
  await call('stock.confirmPicking', { id: 'receipt-landed' })
  await call('stock.saveMoveLine', {
    id: 'receipt-landed-line',
    moveId: 'receipt-landed-move',
    quantity: '2',
  })
  await call('stock.completePicking', { id: 'receipt-landed', createBackorder: false })
  // M9 (#1363): a request for quotation from Đông Á with one line of TM-001, edited in its line grid.
  await call('purchase.createOrder', {
    id: 'rfq-grid',
    partnerId: 'vendor-east',
    pickingTypeId: 'wh:incoming',
  })
  await call('purchase.addLine', {
    id: 'rfq-grid-pads',
    orderId: 'rfq-grid',
    productId: 'pads:default',
    productQty: '100',
    productUomId: 'pack',
    priceUnit: '17200',
  })
  // M15 (#1431, K7 K45–K49): shipping with the company's own carriers. The shipping accounts, GHN (the
  // default: 20.000 ₫ the first kilogram, 5.000 ₫ each one after, 1,5% of COD) and Viettel Post, a seller,
  // and deliveries of 2 GH-15 (300.000 ₫, paid on delivery), each to its own customer: Khách giao A to send
  // from its page, B and C in the queue, D booked, E failed, F a draft to cancel, G brought back by Viettel
  // Post and H delivered by GHN.
  for (const [id, code, name, accountType] of [
    ['acc-641', '641', 'Chi phí bán hàng', 'expense'],
    ['acc-1388', '1388', 'Phải thu khác', 'asset_receivable'],
    ['acc-3311', '3311', 'Phải trả đơn vị vận chuyển', 'liability_payable'],
  ])
    await call('account.saveAccount', { id, code, name, accountType, reconcile: true })
  await call('stock.saveAccountingSetting', {
    journalId: 'journal-kho',
    valuationAccountId: 'acc-156',
    supplierAccountId: 'acc-151',
    productionAccountId: 'acc-1541',
    cogsAccountId: 'acc-632',
    gainAccountId: 'acc-33811',
    lossAccountId: 'acc-13811',
    deliveryFeeAccountId: 'acc-641',
    carrierPayableAccountId: 'acc-3311',
    carrierCodAccountId: 'acc-1388',
    receivableAccountId: 'acc-131',
  })
  for (const [id, code, name, baseFee, extraKgFee, codFeeRate, isDefault] of [
    ['ghn', 'GHN', 'Giao Hàng Nhanh', '20000', '5000', '1.5', true],
    ['vtp', 'VTP', 'Viettel Post', '22000', '4000', '1', false],
  ])
    await call('stock.saveCarrier', { id, code, name, baseFee, extraKgFee, codFeeRate, isDefault })
  await call(
    'user.createUser',
    { id: 'banhang', login: 'banhang', name: 'Bán hàng', password: PASSWORD },
    null,
  )
  await call('user.grantCompany', { id: 'banhang:company', userId: 'banhang', companyId: scope.company })
  await call('user.grantBranch', { id: 'banhang:branch', userId: 'banhang', branchId: scope.branch })
  await call('user.assignRole', {
    id: 'banhang:commerce.sales-representative',
    userId: 'banhang',
    roleId: 'commerce.sales-representative',
  })
  await call('account.savePaymentTerm', { id: 'term-now', name: 'Thanh toán khi nhận hàng' })
  await call('account.savePaymentTermLine', {
    id: 'term-now:line',
    paymentId: 'term-now',
    value: 'percent',
    valueAmount: '100',
    delayType: 'days_after',
    nbDays: 0,
  })
  await call('product.saveTemplate', {
    id: 'm15',
    name: 'Sữa rửa mặt giao hàng',
    type: 'goods',
    uomId: 'pack',
    defaultCode: 'GH-15',
    listPrice: '150000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('stock.configureProduct', { templateId: 'm15', isStorable: true, tracking: 'none' })
  await call('stock.adjustInventory', {
    id: 'count-m15',
    productId: 'm15:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjust',
    countedQuantity: '50',
    productUomId: 'pack',
  })
  for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const id = `ship-${letter}`
    await call('partner.savePartner', {
      id: `gh-${letter}`,
      kind: 'person',
      name: `Khách giao ${letter.toUpperCase()}`,
    })
    await call('partner.grantRole', {
      id: `gh-${letter}:customer`,
      partnerId: `gh-${letter}`,
      role: 'customer',
    })
    await call('sale.createOrder', {
      id,
      partnerId: `gh-${letter}`,
      warehouseId: 'wh',
      pricelistId: null,
      paymentTermId: 'term-now',
    })
    await call('sale.addLine', {
      id: `${id}:line`,
      orderId: id,
      productId: 'm15:default',
      productUomId: 'pack',
      productUomQty: '2',
      priceUnit: '150000',
    })
    await call('sale.confirmOrder', { id })
    await call('stock.confirmPicking', { id: `${id}:delivery` })
    for (const move of (await call('stock.getPicking', { id: `${id}:delivery` })).moves)
      await call('stock.reserveMove', { id: move.id })
  }
  for (const [id, carrierId, steps] of [
    ['parcel-d', 'ghn', ['book']],
    ['parcel-e', 'ghn', ['book', 'handOver', 'fail']],
    ['parcel-f', 'ghn', []],
    ['parcel-g', 'vtp', ['book', 'handOver', 'fail', 'return']],
    ['parcel-h', 'ghn', ['book', 'handOver', 'deliver']],
  ]) {
    const order = `ship-${id.at(-1)}`
    await call('stock.createShipment', { id, pickingId: `${order}:delivery` })
    if (carrierId !== 'ghn') await call('stock.saveShipment', { id, carrierId })
    for (const step of steps)
      if (step === 'book') await call('stock.bookShipment', { id })
      else if (step === 'handOver') await call('stock.handOverShipment', { id })
      else if (step === 'fail') await call('stock.failShipment', { id, reason: 'Khách hẹn lại ngày khác' })
      else if (step === 'deliver') await call('stock.deliverShipment', { id })
      else await call('stock.returnShipment', { id })
  }
  // M16 (#1432 D14, #1433 D7): a quotation to Spa Hoa Mai of 1 SR-13 at its list price, to type a price into.
  await call('sale.createOrder', {
    id: 'quote-manual',
    partnerId: 'spa',
    warehouseId: 'wh',
    pricelistId: null,
  })
  await call('sale.addLine', {
    id: 'quote-manual:line',
    orderId: 'quote-manual',
    productId: 'm13:default',
    productUomId: 'pack',
    productUomQty: '1',
  })
  // M16 (#1435 K15): a second warehouse, Kho Hà Nội. Everyone the other cases sign in as works in Kho Hồ Chí
  // Minh, so their new documents still preselect it; Bán hàng Hà Nội works only in Hà Nội, Bán hàng mới and
  // Trưởng bán hàng in neither.
  for (const [id, name, roleId] of [
    ['banhanghn', 'Bán hàng Hà Nội', 'commerce.sales-representative'],
    ['banhangmoi', 'Bán hàng mới', 'commerce.sales-representative'],
    ['truongban', 'Trưởng bán hàng', 'commerce.sales-manager'],
  ]) {
    await call('user.createUser', { id, login: id, name, password: PASSWORD }, null)
    await call('user.grantCompany', { id: `${id}:company`, userId: id, companyId: scope.company })
    await call('user.grantBranch', { id: `${id}:branch`, userId: id, branchId: scope.branch })
    await call('user.assignRole', { id: `${id}:${roleId}`, userId: id, roleId })
  }
  await call('stock.saveWarehouse', {
    id: 'wh',
    name: 'Kho Hồ Chí Minh',
    code: 'HCM',
    userIds: [tenant.userId, 'thukho', 'ketoan', 'banhang', 'reader'],
  })
  await call('stock.saveWarehouse', { id: 'hn', name: 'Kho Hà Nội', code: 'HN', userIds: ['banhanghn'] })
  // M16 (#1436 K18): a confirmed internal transfer for the storekeeper to cancel.
  await call('stock.createPicking', {
    id: 'picking-cancel-keeper',
    name: 'HCM/INT/0903',
    pickingTypeId: 'wh:internal',
  })
  await call('stock.addMove', {
    id: 'picking-cancel-keeper-move',
    name: 'Toner thủ kho hủy',
    pickingId: 'picking-cancel-keeper',
    productId: 'm14-cancel:default',
    productUomId: 'pack',
    productUomQty: '1',
  })
  await call('stock.confirmPicking', { id: 'picking-cancel-keeper' })
  await adapter.close()
}

await seed()
// The seed runs quietly; the server logs as the person running the tests asked.
const { KET_LOG: _quiet, ...serveEnv } = env
const child = spawn(
  process.execPath,
  ['packages/ketsuite/dist/cli.js', 'serve', '--deployment', 'commerce'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...serveEnv, PORT: String(PORT), KET_LOG_LEVEL: process.env.KET_LOG_LEVEL ?? 'warn' },
  },
)

let stopping = false
const stop = (signal) => {
  if (stopping) return
  stopping = true
  child.kill(signal)
}
child.on('exit', (code) => {
  rmSync(runtimeDir, { recursive: true, force: true })
  process.exit(stopping ? 0 : (code ?? 1))
})
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
