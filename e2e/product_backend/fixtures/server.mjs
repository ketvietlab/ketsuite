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

const call = async (name, input) => {
  const result = await callFn(name, input, { adapter, manifest, scope })
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
    barcode: '8938501230012',
    weight: '0.12',
    volume: '0.0001',
  })
  await call('product.setCost', { productId: 'serum:default', standardPrice: '150000' })
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
