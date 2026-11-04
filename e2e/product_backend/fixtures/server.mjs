// Seeds a small cosmetics catalogue into a throwaway SQLite file, then serves the
// KetSuite deployment over it for the product browser tests. Every record a test
// changes is its own, so the specs can run in any order against one server.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  callFn,
  compose,
  localStorage,
  migrateOne,
  namespacedStorage,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import { ketsuite } from '../../../.build/apps/ketsuite/deployment.js'
import { PASSWORD, PORT } from './users.mjs'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const here = fileURLToPath(new URL('.', import.meta.url))
const runtime = mkdtempSync(join(tmpdir(), 'ketsuite-product-e2e-'))
const database = join(runtime, 'product.sqlite')
const storage = join(runtime, 'storage')
const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : []), ...(ketsuite.themes ?? [])]
// Composed as the served workspace composes it, permission bundles included, so the seed
// grants exactly what the server will read.
const manifest = compose(modules, {
  headless: ketsuite.headless ?? false,
  modulePermissionDeclarations: ketsuite.permissions?.modules,
  roleTemplates: ketsuite.permissions?.roleTemplates,
  companies: true,
})
const adapter = sqliteAdapter(database)
const objects = namespacedStorage(localStorage({ dir: storage }), ketsuite.name)
const scope = {
  company: 'default',
  companies: ['default'],
  branch: 'root:default',
  branches: ['root:default'],
}

const call = async (name, input, actor) => {
  const result = await callFn(name, input, { adapter, manifest, scope, ...(actor ? { actor } : {}) })
  if (result.ok === false || result.value?.ok === false)
    throw new Error(`${name}: ${JSON.stringify(result.value?.errors ?? result.error ?? result.value)}`)
  return result.value
}

const image = async ({ id, file, templateId, productId, alt, primary = false, sequence }) => {
  const bytes = readFileSync(join(here, file))
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const storeKey = `blobs/default/${checksum.slice(0, 2)}/${checksum}`
  await objects.put(
    storeKey,
    (async function* () {
      yield bytes
    })(),
    { type: 'image/png', size: bytes.length },
  )
  await call('storage.createAttachment', {
    id: `${id}-file`,
    name: `${id}.png`,
    resModel: productId ? 'product.Product' : 'product.Template',
    resId: productId ?? templateId,
    resField: 'media',
    kind: 'stored',
    storeKey,
    mimetype: 'image/png',
    size: bytes.length,
    checksum,
    public: false,
    createdAt: '2026-10-01T08:00:00.000Z',
  })
  await call('product_media.attachMedia', {
    id,
    attachmentId: `${id}-file`,
    ...(productId ? { productId } : { templateId }),
    alt,
    primary,
    sequence,
  })
}

const person = async ({ id, login, name, superuser = false }) => {
  await call('partner.savePartner', { id: `${id}-partner`, kind: 'person', name })
  await call('user.createUser', {
    id,
    login,
    password: PASSWORD,
    name,
    partnerId: `${id}-partner`,
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser,
  })
  await call('user.grantCompany', { id: `${id}:default`, userId: id, companyId: 'default' })
  await call('user.grantBranch', { id: `${id}:root:default`, userId: id, branchId: 'root:default' })
}

const product = async (input) =>
  call('product.saveTemplate', { type: 'goods', uomId: 'unit', saleOk: true, purchaseOk: true, ...input })

const stock = async (templateId, onHand) => {
  await call('stock.configureProduct', { templateId, isStorable: true, tracking: 'none' })
  if (!onHand) return
  await call('stock.adjustInventory', {
    id: `count-${templateId}`,
    productId: `${templateId}:default`,
    locationId: 'wh-main:stock',
    inventoryLocationId: 'inventory-loss',
    countedQuantity: String(onHand),
    productUomId: 'unit',
  })
}

const archive = async (id) => {
  const found = await call('product.getTemplate', { id })
  await call('product.archiveTemplate', {
    id,
    active: false,
    confirmed: true,
    expectedRevisionId: found?.revisionId ?? 'initial',
    reason: 'Ngừng kinh doanh mặt hàng mẫu',
  })
}

const seed = async () => {
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)

  await call('partner.savePartner', {
    id: 'company-party',
    kind: 'company',
    name: 'Mỹ phẩm Lá Xanh',
    ref: 'LX',
  })
  await call('company.saveCompany', {
    id: 'default',
    code: 'LX',
    partnerId: 'company-party',
    currency: 'VND',
  })
  await person({ id: 'admin', login: 'admin', name: 'Quản trị sản phẩm', superuser: true })
  await person({ id: 'viewer', login: 'viewer', name: 'Nhân viên xem danh mục' })
  await person({ id: 'outsider', login: 'outsider', name: 'Nhân viên kho ngoài' })
  await person({ id: 'reader', login: 'reader', name: 'Cộng tác viên xem giá' })

  // Who may read the catalogue but not change it: the view areas an administrator ticks.
  await call('user.saveRole', { id: 'catalogue-viewer', name: 'Xem danh mục sản phẩm' })
  const { revision } = await call('user.authorizationState', {})
  await call('user.setRoleBundles', {
    roleId: 'catalogue-viewer',
    bundleKeys: [
      'product.view',
      'product_backend.view',
      'product_media.view',
      'stock.view',
      'stock_backend.view',
      'uom.view',
    ],
    reason: 'product e2e',
    expectedAuthorizationRevision: revision,
    idempotencyKey: 'catalogue-viewer-bundles',
  })
  await call('user.assignRole', {
    id: 'viewer:catalogue-viewer',
    userId: 'viewer',
    roleId: 'catalogue-viewer',
  })
  // Who reads the catalogue without stock: the list falls back to the catalogue's own read.
  await call('user.saveRole', { id: 'catalogue-reader', name: 'Xem danh mục, không xem kho' })
  await call('user.setRoleBundles', {
    roleId: 'catalogue-reader',
    bundleKeys: ['product.view', 'product_backend.view', 'uom.view'],
    reason: 'product e2e',
    expectedAuthorizationRevision: (await call('user.authorizationState', {})).revision,
    idempotencyKey: 'catalogue-reader-bundles',
  })
  await call('user.assignRole', {
    id: 'reader:catalogue-reader',
    userId: 'reader',
    roleId: 'catalogue-reader',
  })

  // P17: who edits only the stock setup of a product, and who edits only its cost. They
  // hold the Commerce job roles a tenant assigns, not roles built for the test, so a page
  // that reads more than those roles grant fails here as it would for the tenant.
  await call('user.syncRoleTemplates', {}, 'system:role-templates')
  for (const [login, name, roleId] of [
    ['stockkeeper', 'Quản lý kho sản phẩm', 'commerce.warehouse-manager'],
    ['bookkeeper', 'Kế toán sản phẩm', 'commerce.accountant'],
  ]) {
    await person({ id: login, login, name })
    await call('user.assignRole', { id: `${login}:${roleId}`, userId: login, roleId })
  }
  // Every other Commerce job role that reads products, signed in as `role-<key>` (roles.spec.ts).
  for (const key of [
    'company-administrator',
    'tenant-auditor',
    'sales-manager',
    'sales-representative',
    'purchasing-manager',
    'purchasing-operator',
    'warehouse-operator',
    // M2: holds no catalogue screen; `/admin` must not send it to one (access.spec.ts).
    'tenant-security-administrator',
  ]) {
    await person({ id: `role-${key}`, login: `role-${key}`, name: `Commerce ${key}` })
    await call('user.assignRole', {
      id: `role-${key}:commerce.${key}`,
      userId: `role-${key}`,
      roleId: `commerce.${key}`,
    })
  }

  // P22/P41: the posting accounts a product inherits from the company, and one it may choose.
  for (const [id, code, name, accountType] of [
    ['acc-511', '511', 'Doanh thu bán hàng', 'income'],
    ['acc-5111', '5111', 'Doanh thu bán hàng hoá', 'income'],
    ['acc-5118', '5118', 'Doanh thu khác', 'income'],
    ['acc-156', '156', 'Hàng hoá', 'asset_current'],
    ['acc-642', '642', 'Chi phí quản lý doanh nghiệp', 'expense'],
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

  // Units: two families with a packaging unit, a weight family and an archived unit.
  await call('uom.saveUnit', { id: 'unit', name: 'Cái', relativeFactor: '1' })
  await call('uom.saveUnit', { id: 'box-6', name: 'Hộp 6 cái', relativeFactor: '6', relativeUomId: 'unit' })
  await call('uom.saveUnit', { id: 'bottle', name: 'Chai', relativeFactor: '1' })
  await call('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' })
  await call('uom.saveUnit', { id: 'g', name: 'g', relativeFactor: '0.001', relativeUomId: 'kg' })
  await call('uom.saveUnit', {
    id: 'crate-old',
    name: 'Thùng cũ',
    relativeFactor: '24',
    relativeUomId: 'unit',
    active: false,
  })

  await call('product.saveCategory', { id: 'skincare', name: 'Chăm sóc da' })
  await call('product.saveCategory', { id: 'ingredients', name: 'Nguyên liệu' })
  await call('product.saveBrand', { id: 'derma', name: 'Derma Việt' })

  await call('stock.saveWarehouse', { id: 'wh-main', name: 'Kho Hồ Chí Minh', code: 'HCM' })
  await call('stock.saveLocation', { id: 'inventory-loss', name: 'Điều chỉnh tồn', usage: 'inventory' })

  // Attributes: one that makes variants, one with colours, one that only describes.
  await call('product.saveAttribute', {
    id: 'capacity',
    name: 'Dung tích',
    sequence: 10,
    displayType: 'select',
    createVariant: 'always',
    active: true,
  })
  for (const [index, name] of ['15ml', '30ml', '50ml'].entries())
    await call('product.saveAttributeValue', {
      id: `capacity-${name}`,
      attributeId: 'capacity',
      name,
      sequence: (index + 1) * 10,
    })
  await call('product.saveAttributeDraft', {
    id: 'shade',
    name: 'Tông màu',
    sequence: 20,
    displayType: 'color',
    createVariant: 'always',
    values: [
      { id: 'shade-1', name: 'Hồng đất', sequence: 10, htmlColor: '#c97b7b' },
      { id: 'shade-2', name: 'Nâu trầm', sequence: 20, htmlColor: '#7a4e3a' },
    ],
  })
  await call('product.saveAttribute', {
    id: 'scent',
    name: 'Mùi hương',
    sequence: 30,
    displayType: 'pills',
    createVariant: 'no_variant',
    active: true,
  })

  // The product most specs read: full identity, stock, cost and two images.
  await product({
    id: 'serum',
    name: 'Serum B5 phục hồi 30ml',
    categoryId: 'skincare',
    brandId: 'derma',
    origin: 'Việt Nam',
    description: 'Serum phục hồi da chứa B5, dùng ban đêm.',
    listPrice: '350000',
    defaultCode: 'SR-B5-30',
    barcode: '8938501230010',
    weight: '0.12',
    volume: '0.0001',
  })
  await call('product.setCost', { productId: 'serum:default', standardPrice: '150000' })
  await product({
    id: 'cost-refresh',
    name: 'Cost refresh specimen',
    defaultCode: 'COST-REFRESH',
    listPrice: '250000',
  })
  await call('product.setCost', { productId: 'cost-refresh:default', standardPrice: '100000' })
  await stock('serum', 40)
  await image({
    id: 'serum-front',
    file: 'serum-front.png',
    templateId: 'serum',
    alt: 'Chai serum',
    primary: true,
    sequence: 10,
  })
  await image({ id: 'serum-box', file: 'serum-box.png', templateId: 'serum', alt: 'Hộp serum', sequence: 20 })

  // A product with variants, generated from capacity.
  await product({
    id: 'cream',
    name: 'Kem dưỡng ẩm ban đêm',
    categoryId: 'skincare',
    brandId: 'derma',
    listPrice: '420000',
  })
  await call('product.saveAttributeLine', {
    id: 'cream:capacity',
    templateId: 'cream',
    attributeId: 'capacity',
    valueIds: ['capacity-30ml', 'capacity-50ml'],
  })
  await call('product.generateVariants', { templateId: 'cream' })

  // Rows the list filters tell apart.
  await product({
    id: 'cotton',
    name: 'Bông tẩy trang 120 miếng',
    categoryId: 'skincare',
    listPrice: '39000',
    defaultCode: 'TM-001',
  })
  await stock('cotton', 0)
  await product({
    id: 'niacinamide',
    name: 'Niacinamide nguyên liệu',
    categoryId: 'ingredients',
    listPrice: '2400000',
    saleOk: false,
    defaultCode: 'NL-010',
  })
  await product({
    id: 'skin-check',
    name: 'Dịch vụ soi da',
    type: 'service',
    listPrice: '150000',
    purchaseOk: false,
  })
  await product({ id: 'old-mask', name: 'Mặt nạ ngừng bán', categoryId: 'skincare', listPrice: '25000' })
  await archive('old-mask')

  // Records that one spec each changes.
  await product({
    id: 'toner-edit',
    name: 'Toner cân bằng (sửa)',
    categoryId: 'skincare',
    listPrice: '210000',
  })
  await product({
    id: 'toner-archive',
    name: 'Toner cân bằng (lưu trữ)',
    categoryId: 'skincare',
    listPrice: '210000',
  })
  await product({
    id: 'toner-groups',
    name: 'Toner chia nhóm trường',
    categoryId: 'skincare',
    listPrice: '230000',
    barcode: '8938501230034',
  })
  await call('product.setCost', { productId: 'toner-groups:default', standardPrice: '90000' })
  await product({ id: 'lotion-bulk', name: 'Lotion hàng loạt', categoryId: 'skincare', listPrice: '180000' })
  await product({
    id: 'mist-variants',
    name: 'Xịt khoáng nhiều dung tích',
    categoryId: 'skincare',
    listPrice: '160000',
  })
  await product({ id: 'balm-media', name: 'Son dưỡng có ảnh', categoryId: 'skincare', listPrice: '90000' })
  await image({
    id: 'balm-front',
    file: 'serum-front.png',
    templateId: 'balm-media',
    alt: 'Son dưỡng mặt trước',
    primary: true,
    sequence: 10,
  })
  await image({
    id: 'balm-side',
    file: 'serum-box.png',
    templateId: 'balm-media',
    alt: 'Son dưỡng mặt bên',
    sequence: 20,
  })
  await product({ id: 'balm-remove', name: 'Son dưỡng bỏ ảnh', categoryId: 'skincare', listPrice: '95000' })
  await image({
    id: 'balm-remove-front',
    file: 'serum-front.png',
    templateId: 'balm-remove',
    alt: 'Ảnh giữ lại',
    primary: true,
    sequence: 10,
  })
  await image({
    id: 'balm-remove-side',
    file: 'serum-box.png',
    templateId: 'balm-remove',
    alt: 'Ảnh cần gỡ',
    sequence: 20,
  })
  await product({ id: 'soap-upload', name: 'Xà phòng cần ảnh', categoryId: 'skincare', listPrice: '55000' })
  await product({ id: 'toner-copy', name: 'Toner để nhân bản', categoryId: 'skincare', listPrice: '220000' })
  await product({
    id: 'gel-variants',
    name: 'Gel rửa mặt hai dung tích',
    categoryId: 'skincare',
    listPrice: '190000',
  })
  await call('product.saveAttributeLine', {
    id: 'gel-variants:capacity',
    templateId: 'gel-variants',
    attributeId: 'capacity',
    valueIds: ['capacity-15ml', 'capacity-30ml'],
  })
  await call('product.generateVariants', { templateId: 'gel-variants' })

  // C1 (P17): a product the administrator changes in all three field groups with one save.
  await product({ id: 'toner-all', name: 'Toner đủ ba nhóm', categoryId: 'skincare', listPrice: '230000' })
  await call('product.setCost', { productId: 'toner-all:default', standardPrice: '90000' })

  // C2 (P20/P23): lots with a shelf life, its own income account, and an open quotation that
  // keeps it from being archived, alone or with another product in one bulk archive.
  await product({
    id: 'sunscreen-quote',
    name: 'Kem chống nắng có báo giá',
    categoryId: 'skincare',
    listPrice: '420000',
    defaultCode: 'KCN-01',
  })
  await call('stock.configureProduct', {
    templateId: 'sunscreen-quote',
    isStorable: true,
    tracking: 'lot',
    shelfLifeMonths: 24,
    alertDays: 30,
  })
  await call('account.setProductAccounts', { templateId: 'sunscreen-quote', incomeAccountId: 'acc-5111' })
  await call('partner.savePartner', { id: 'spa-customer', kind: 'company', name: 'Spa Hoa Mai' })
  await call('sale.createOrder', { id: 'quote-open', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  await call('sale.addLine', {
    id: 'quote-open:1',
    orderId: 'quote-open',
    productId: 'sunscreen-quote:default',
    productUomQty: '2',
    productUomId: 'unit',
  })
  await product({
    id: 'sunscreen-gel',
    name: 'Gel chống nắng không báo giá',
    categoryId: 'skincare',
    listPrice: '310000',
  })
  // C3 (P41/K29): a lot already held, for who may only read lots.
  await call('stock.createLot', {
    id: 'lot-seeded',
    productId: 'sunscreen-quote:default',
    name: 'KCN-250601',
    manufacturingDate: '2025-06-01T00:00:00.000Z',
  })

  // C3 (P41): a category posting its revenue to 5118, and a product in it with no accounts of its own.
  await call('product.saveCategory', { id: 'gift-sets', name: 'Bộ quà tặng' })
  await call('account.saveCategoryAccount', { categoryId: 'gift-sets', incomeAccountId: 'acc-5118' })
  await product({ id: 'gift-box', name: 'Hộp quà dưỡng da', categoryId: 'gift-sets', listPrice: '520000' })

  // C4 (P25–P31): a size attribute whose L costs more, products configured with it for one
  // spec each, one size in stock and one on an open quotation, and two long attributes whose
  // combinations pass the fifty-variant ceiling.
  await call('product.saveAttribute', {
    id: 'robe-size',
    name: 'Kích cỡ áo',
    displayType: 'radio',
    createVariant: 'always',
  })
  for (const [sequence, [id, name, extra]] of [
    ['size-s', 'S', '0'],
    ['size-m', 'M', '0'],
    ['size-l', 'L', '30000'],
  ].entries())
    await call('product.saveAttributeValue', {
      id,
      attributeId: 'robe-size',
      name,
      defaultPriceExtra: extra,
      sequence,
    })
  await call('product.saveAttribute', {
    id: 'towel-material',
    name: 'Loại khăn',
    displayType: 'radio',
    createVariant: 'always',
  })
  for (const [sequence, [id, name]] of [
    ['material-cotton', 'Cotton'],
    ['material-bamboo', 'Tre'],
  ].entries())
    await call('product.saveAttributeValue', { id, attributeId: 'towel-material', name, sequence })
  for (const [attribute, name, count] of [
    ['grid-a', 'Lưới A', 8],
    ['grid-b', 'Lưới B', 7],
  ]) {
    await call('product.saveAttribute', {
      id: attribute,
      name,
      displayType: 'select',
      createVariant: 'always',
    })
    for (let index = 1; index <= count; index += 1)
      await call('product.saveAttributeValue', {
        id: `${attribute}-${index}`,
        attributeId: attribute,
        name: `${name} ${index}`,
        sequence: index,
      })
  }
  const sized = async (id, name, code, valueIds = ['size-s', 'size-m', 'size-l']) => {
    await product({ id, name, categoryId: 'skincare', listPrice: '250000', defaultCode: code })
    await call('product.saveAttributeLine', {
      id: `${id}:size`,
      templateId: id,
      attributeId: 'robe-size',
      valueIds,
    })
    await call('product.generateVariants', { templateId: id })
  }
  // The SKU a size landed on: the product's original one took the first combination.
  const sizeVariant = async (templateId, valueId) =>
    String(
      (
        await adapter.all(
          `SELECT pv."productId" AS id FROM product_product_value pv
             JOIN product_template_attribute_value tav ON tav.id = pv."templateAttributeValueId"
            WHERE tav."lineId" = ? AND tav."valueId" = ?`,
          [`${templateId}:size`, valueId],
        )
      )[0].id,
    )
  await sized('robe-drop', 'Áo choàng bỏ cỡ', 'ACD')
  await sized('robe-roles', 'Áo choàng chia nhóm', 'ACR')
  await sized('robe-stop', 'Áo choàng ngừng bán', 'ACS', ['size-s', 'size-m'])
  await sized('robe-copy', 'Áo choàng nhân bản', 'ACN')
  // On robe-drop M has stock on hand and L sits on a draft quotation: neither may leave the
  // setup or stop selling (P27/P28).
  await call('stock.configureProduct', { templateId: 'robe-drop', isStorable: true, tracking: 'none' })
  await call('stock.adjustInventory', {
    id: 'count-robe-drop-m',
    productId: await sizeVariant('robe-drop', 'size-m'),
    locationId: 'wh-main:stock',
    inventoryLocationId: 'inventory-loss',
    countedQuantity: '4',
    productUomId: 'unit',
  })
  await call('sale.createOrder', { id: 'quote-robe-drop', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  await call('sale.addLine', {
    id: 'quote-robe-drop:1',
    orderId: 'quote-robe-drop',
    productId: await sizeVariant('robe-drop', 'size-l'),
    productUomQty: '1',
    productUomId: 'unit',
  })
  // C6: two confirmed orders and a quotation for robe-sold (P32 counts the confirmed ones
  // only), and an empty quotation whose line picks a variant by its full name (P29).
  await sized('robe-sold', 'Áo choàng đã bán', 'ACX')
  for (const [orderId, lines, confirm] of [
    ['sold-1', [['size-s', '1']], true],
    [
      'sold-2',
      [
        ['size-s', '2'],
        ['size-m', '1'],
      ],
      true,
    ],
    ['sold-quote', [['size-l', '5']], false],
  ]) {
    await call('sale.createOrder', { id: orderId, partnerId: 'spa-customer', warehouseId: 'wh-main' })
    for (const [index, [valueId, qty]] of lines.entries())
      await call('sale.addLine', {
        id: `${orderId}:${index}`,
        orderId,
        productId: await sizeVariant('robe-sold', valueId),
        productUomQty: qty,
        productUomId: 'unit',
      })
    if (confirm) await call('sale.confirmOrder', { id: orderId })
  }
  // Sent quotations add lines one at a time in their table's last row (sales-links.spec.ts,
  // packaging-sales.spec.ts); a draft one edits them as a grid (quotation-page.spec.ts).
  await call('sale.createOrder', { id: 'quote-picker', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  await call('sale.sendQuotation', { id: 'quote-picker' })
  // C7 (P34, P36): a packaging unit on one product, which a quotation line may sell in and
  // which the units screen keeps from being archived.
  await call('uom.saveUnit', { id: 'pack-4', name: 'Lốc 4 cái', relativeFactor: '4', relativeUomId: 'unit' })
  await product({ id: 'water-pack', name: 'Nước suối lốc', listPrice: '50000', defaultCode: 'NSL' })
  await call('product.addTemplateUom', { templateId: 'water-pack', uomId: 'pack-4' })
  await call('sale.createOrder', { id: 'quote-pack', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  await call('sale.sendQuotation', { id: 'quote-pack' })
  // C8 (P37): a pricelist whose rule prices one packaging of a variant, a sent quotation that uses
  // it (pricelist-packaging.spec.ts), and an empty pricelist a rule is added to in the browser.
  // D14: a quotation that names no pricelist takes the company's first active one, so the company
  // lists its own prices first, as a shop does: the pricelists below price only what names them.
  await call('pricing.savePricelist', { id: 'list-price', name: 'Giá niêm yết', sequence: 1 })
  await call('pricing.savePricelist', { id: 'wholesale', name: 'Giá sỉ' })
  await call('pricing.savePricelistItem', {
    id: 'wholesale-pack',
    pricelistId: 'wholesale',
    appliedOn: '0_product_variant',
    productId: 'water-pack:default',
    uomId: 'pack-4',
    computePrice: 'fixed',
    fixedPrice: '180000',
  })
  await call('sale.createOrder', {
    id: 'quote-wholesale',
    partnerId: 'spa-customer',
    warehouseId: 'wh-main',
    pricelistId: 'wholesale',
  })
  await call('sale.sendQuotation', { id: 'quote-wholesale' })
  await call('pricing.savePricelist', { id: 'promo', name: 'Khuyến mãi lốc' })
  // C19 (D30): an empty pricelist a formula rule priced from Giá sỉ is added to, with a sent quotation
  // on it, and a list already priced from Giá sỉ, which Giá sỉ may neither price from nor stop
  // while it is active (pricelist-formulas.spec.ts).
  await call('pricing.savePricelist', { id: 'markup', name: 'Giá đại lý' })
  await call('sale.createOrder', {
    id: 'quote-markup',
    partnerId: 'spa-customer',
    warehouseId: 'wh-main',
    pricelistId: 'markup',
  })
  await call('sale.sendQuotation', { id: 'quote-markup' })
  await call('pricing.savePricelist', { id: 'retail', name: 'Giá cửa hàng' })
  await call('pricing.savePricelistItem', {
    id: 'retail-formula',
    pricelistId: 'retail',
    appliedOn: '3_global',
    computePrice: 'formula',
    base: 'pricelist',
    basePricelistId: 'wholesale',
    priceDiscount: '-10',
  })
  // C9 (P39–P42): a child category with a product of its own, two tags in use and an archived one
  // (catalogue-groups.spec.ts).
  await call('product.saveCategory', { id: 'cleansing', name: 'Làm sạch', parentId: 'skincare' })
  await call('product.saveTag', { id: 'tag-best', name: 'Bán chạy' })
  await call('product.saveTag', { id: 'tag-sensitive', name: 'Da nhạy cảm' })
  await call('product.saveTag', { id: 'tag-retired', name: 'Hàng cũ' })
  await product({
    id: 'foam-clean',
    name: 'Sữa rửa mặt tạo bọt',
    categoryId: 'cleansing',
    listPrice: '150000',
    defaultCode: 'SRM',
    tagIds: ['tag-best', 'tag-retired'],
  })
  const retired = (await call('product.listTags', { ids: ['tag-retired'] }))[0]
  await call('product.setTagActive', {
    id: 'tag-retired',
    active: false,
    expectedRevisionId: retired.revisionId,
  })
  // C10 (P44–P47): two combo choices a combo product sells, one choice nobody uses, and a draft
  // quotation to sell the combo on (combos.spec.ts).
  for (const [id, name, listPrice, defaultCode] of [
    ['cb-serum-a', 'Tinh dầu dưỡng sáng', '300000', 'SDA'],
    ['cb-serum-b', 'Tinh dầu dưỡng ẩm', '320000', 'SDB'],
    ['cb-bag', 'Túi quà vải', '50000', 'TQV'],
  ])
    await product({ id, name, listPrice, defaultCode })
  await call('product.saveCombo', {
    id: 'combo-serum',
    name: 'Tinh dầu dưỡng',
    items: [
      { productId: 'cb-serum-a:default', extraPrice: '0' },
      { productId: 'cb-serum-b:default', extraPrice: '60000' },
    ],
  })
  await call('product.saveCombo', {
    id: 'combo-gift',
    name: 'Quà kèm',
    items: [{ productId: 'cb-bag:default', extraPrice: '0' }],
  })
  await call('product.saveCombo', {
    id: 'combo-spare',
    name: 'Lựa chọn chưa dùng',
    items: [{ productId: 'cb-bag:default', extraPrice: '0' }],
  })
  await product({
    id: 'winter-combo',
    name: 'Combo dưỡng ẩm mùa đông',
    type: 'combo',
    defaultCode: 'CB-01',
    listPrice: '590000',
    comboIds: ['combo-serum', 'combo-gift'],
    purchaseOk: false,
  })
  await call('sale.createOrder', { id: 'quote-combo', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  // A quotation already selling the combo: confirmed, it delivers and invoices the items.
  await call('sale.createOrder', {
    id: 'quote-combo-sold',
    partnerId: 'spa-customer',
    warehouseId: 'wh-main',
  })
  await call('sale.addLine', {
    id: 'combo-sold-line',
    orderId: 'quote-combo-sold',
    productId: 'winter-combo:default',
    productUomId: 'unit',
    productUomQty: '1',
  })
  // C12 (P51): wipes delivered two days after the order, soap with none, on two quotations; one
  // quotation sells only a service (delivery-promises.spec.ts).
  await product({
    id: 'lead-wipes',
    name: 'Khăn ướt giao sau',
    listPrice: '48000',
    defaultCode: 'DL-02',
    saleDelay: 2,
  })
  await stock('lead-wipes', 0)
  await product({
    id: 'lead-tissue',
    name: 'Khăn giấy giao sau',
    listPrice: '42000',
    defaultCode: 'DL-01',
    saleDelay: 2,
  })
  await stock('lead-tissue', 0)
  await product({ id: 'lead-soap', name: 'Xà phòng có sẵn', listPrice: '45000', defaultCode: 'DL-00' })
  await stock('lead-soap', 5)
  // C14 (P55): two products only bulk-edits.spec.ts changes, a third it leaves alone.
  for (const [id, name, code, price] of [
    ['bulk-a', 'Sữa tắm sửa loạt A', 'BK-01', '52000'],
    ['bulk-b', 'Sữa tắm sửa loạt B', 'BK-02', '54000'],
    ['bulk-tracked', 'Sữa tắm sửa loạt có tồn', 'BK-03', '56000'],
  ])
    await product({ id, name, listPrice: price, defaultCode: code })
  await stock('bulk-tracked', 3)
  for (const id of ['quote-delivery', 'quote-delivery-sold']) {
    await call('sale.createOrder', { id, partnerId: 'spa-customer', warehouseId: 'wh-main' })
    for (const [suffix, productId] of [
      ['wipes', 'lead-wipes:default'],
      ['soap', 'lead-soap:default'],
    ])
      await call('sale.addLine', {
        id: `${id}-${suffix}`,
        orderId: id,
        productId,
        productUomId: 'unit',
        productUomQty: '1',
      })
  }
  await call('sale.createOrder', {
    id: 'quote-service-only',
    partnerId: 'spa-customer',
    warehouseId: 'wh-main',
  })
  await call('sale.addLine', {
    id: 'quote-service-only-line',
    orderId: 'quote-service-only',
    productId: 'skin-check:default',
    productUomQty: '1',
  })
  // A quotation opens as a page of its own (quotation-page.spec.ts): one customer of its own,
  // so its list row and the quotation created beside it stay apart from the other quotes.
  await call('partner.savePartner', { id: 'page-customer', kind: 'company', name: 'Nhà sách Trang' })
  await call('sale.createOrder', { id: 'quote-page', partnerId: 'page-customer', warehouseId: 'wh-main' })
  // A draft quotation's lines are edited as a grid and saved at once (quotation-page.spec.ts).
  await call('sale.createOrder', { id: 'quote-grid', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  // C17 (D24, D25): a quotation a free line is typed into, one already holding a free line for the
  // Require a product setting, and one with a section a seller marks optional (sale-lines.spec.ts).
  await call('sale.createOrder', { id: 'quote-free', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  await call('sale.createOrder', { id: 'quote-required', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  await call('sale.addLine', {
    id: 'quote-required:free',
    orderId: 'quote-required',
    name: 'Tư vấn tại chỗ',
    productUomQty: '1',
    priceUnit: '200000',
  })
  // C18 (D26): two serums at the list price over a cost of 150.000, whose price a margin typed sets.
  await call('sale.createOrder', { id: 'quote-margin', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  await call('sale.addLine', {
    id: 'quote-margin:serum',
    orderId: 'quote-margin',
    productId: 'serum:default',
    productUomId: 'unit',
    productUomQty: '2',
  })
  await call('sale.addLine', {
    id: 'quote-margin:advice',
    orderId: 'quote-margin',
    name: 'Tư vấn da',
    productUomQty: '1',
    priceUnit: '100000',
  })
  // C18 (D27): an empty quotation filled from its catalogue page.
  await call('sale.createOrder', { id: 'quote-catalogue', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  // C18 (D28): a robe sold through a quantity grid, and an empty quotation it is entered on.
  await product({
    id: 'robe-matrix',
    name: 'Áo choàng nhập lưới',
    categoryId: 'skincare',
    listPrice: '300000',
    defaultCode: 'ACL',
    saleVariantMode: 'matrix',
  })
  await call('product.saveAttributeLine', {
    id: 'robe-matrix:size',
    templateId: 'robe-matrix',
    attributeId: 'robe-size',
    valueIds: ['size-s', 'size-m', 'size-l'],
  })
  await call('product.generateVariants', { templateId: 'robe-matrix' })
  await call('sale.createOrder', { id: 'quote-matrix', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  // A robe still on the line picker, switched to the quantity grid from its page.
  await sized('robe-mode', 'Áo choàng đổi cách chọn', 'ACM')
  // C18 (D29): a section saved as a template from one quotation and added to another.
  await call('sale.createOrder', {
    id: 'quote-template-from',
    partnerId: 'spa-customer',
    warehouseId: 'wh-main',
  })
  await call('sale.addLine', {
    id: 'quote-template-from:section',
    orderId: 'quote-template-from',
    displayType: 'section',
    name: 'Bộ chăm sóc tối',
    sequence: 100,
    productUomQty: '0',
  })
  await call('sale.addLine', {
    id: 'quote-template-from:serum',
    orderId: 'quote-template-from',
    productId: 'serum:default',
    productUomId: 'unit',
    productUomQty: '2',
    priceUnit: '999000',
    sequence: 200,
  })
  await call('sale.createOrder', {
    id: 'quote-template-to',
    partnerId: 'spa-customer',
    warehouseId: 'wh-main',
  })
  await call('sale.createOrder', { id: 'quote-optional', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  for (const [id, displayType, name, sequence, quantity, price] of [
    ['main', null, 'Liệu trình chính', 100, '1', '500000'],
    ['section', 'section', 'Phụ kiện kèm theo', 200, '0', null],
    ['gift', null, 'Khăn quà tặng', 300, '2', '50000'],
  ])
    await call('sale.addLine', {
      id: `quote-optional:${id}`,
      orderId: 'quote-optional',
      ...(displayType ? { displayType } : {}),
      name,
      sequence,
      productUomQty: quantity,
      ...(price ? { priceUnit: price } : {}),
    })
  // C20 (D31a): a 10% and a 5% sales tax, a draft quotation with a line under each, and one with a
  // line its seller has not saved yet (sale-discounts.spec.ts).
  for (const [id, amount] of [
    ['vat-10', '10'],
    ['vat-5', '5'],
  ])
    await call('account.saveTax', {
      id,
      name: `VAT ${amount}%`,
      typeTaxUse: 'sale',
      amountType: 'percent',
      amount,
    })
  await call('sale.createOrder', { id: 'quote-discount', partnerId: 'spa-customer', warehouseId: 'wh-main' })
  for (const [id, productId, priceUnit, tax] of [
    ['foam', 'foam-clean:default', '150000', 'vat-10'],
    ['bag', 'cb-bag:default', '50000', 'vat-5'],
  ])
    await call('sale.addLine', {
      id: `quote-discount:${id}`,
      orderId: 'quote-discount',
      productId,
      productUomId: 'unit',
      productUomQty: '2',
      priceUnit,
      taxIds: [tax],
    })
  await product({
    id: 'towel-first',
    name: 'Khăn tắm cấu hình lần đầu',
    categoryId: 'skincare',
    listPrice: '120000',
    defaultCode: 'KT',
  })
  await product({ id: 'towel-many', name: 'Khăn quá nhiều cỡ', categoryId: 'skincare', listPrice: '90000' })
  await product({
    id: 'towel-face',
    name: 'Khăn mặt hai chất liệu',
    categoryId: 'skincare',
    listPrice: '60000',
  })
  await call('product.saveAttributeLine', {
    id: 'towel-face:material',
    templateId: 'towel-face',
    attributeId: 'towel-material',
    valueIds: ['material-cotton', 'material-bamboo'],
  })
  await call('product.generateVariants', { templateId: 'towel-face' })

  // Enough goods that the list pages: thirty-two plus the named rows above.
  for (let index = 1; index <= 32; index += 1) {
    const suffix = String(index).padStart(2, '0')
    await product({
      id: `sample-${suffix}`,
      name: `Sản phẩm mẫu ${suffix}`,
      categoryId: index % 2 ? 'skincare' : 'ingredients',
      listPrice: String(100000 + index * 1000),
      defaultCode: `MAU-${suffix}`,
    })
  }
  await adapter.close()
}

await seed()
const child = spawn(
  process.execPath,
  [
    'node_modules/@ketvietlab/ketjs/dist/cli.js',
    'serve',
    '--workspace',
    '.build/ket.workspace.js',
    '--port',
    String(PORT),
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      KET_SQLITE: database,
      KET_STORAGE_DIR: storage,
      KET_SECRET: 'product-e2e-secret-0123456789abcdef',
      KET_LOCALE: 'vi',
      KET_FALLBACK_LOCALE: 'vi',
      KET_LOG_LEVEL: process.env.KET_LOG_LEVEL ?? 'warn',
    },
  },
)

let stopping = false
const stop = (signal) => {
  if (stopping) return
  stopping = true
  child.kill(signal)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('exit', (code) => {
  rmSync(runtime, { recursive: true, force: true })
  process.exit(code ?? 0)
})
