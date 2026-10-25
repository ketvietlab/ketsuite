import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import type { VariantEditorSetup } from '../packages/ketsuite/src/ui/client/variant-editor-view.tsx'
import {
  configureInput,
  parseNumber,
  templateModalDefinition,
  type TemplateModalData,
  type TemplateRecord,
  type WarehouseRow,
} from '../packages/ketsuite/src/modules/product_backend/modal/product-modal-view.tsx'
import { workspaceMessages } from '../packages/ketsuite/src/modules/product_backend/workspace-messages.ts'

// The product page (product_backend/modal/product-modal-view.tsx): what it renders
// for whom, and what each command sends.

type Options = {
  creating?: boolean
  dialog?: { name: string; params: Record<string, string> } | null
  state?: Record<string, string>
}

const contextOf = (
  data: TemplateModalData,
  options: Options = {},
): RecordModalContext<TemplateModalData> => ({
  kind: 'product.template',
  id: options.creating ? 'new' : data.record.id,
  creating: options.creating === true,
  tab: '',
  data,
  t: (key, params) => (params ? `${key}${JSON.stringify(params)}` : key),
  outcome: () => null,
  fieldError: () => null,
  draft: (_name, fallback = '') => fallback,
  draftChecked: (_name, _value, fallback = false) => fallback,
  busy: false,
  dialog: options.dialog ?? null,
  href: () => '',
  presentation: 'page',
  state: (key, fallback = '') => options.state?.[key] ?? fallback,
})

const record = (overrides: Partial<TemplateRecord> = {}): TemplateRecord => ({
  id: 'tpl-1',
  revisionId: 'rev-1',
  name: 'Serum',
  type: 'goods',
  categoryId: null,
  brandId: null,
  uomId: 'bottle',
  origin: null,
  description: null,
  listPrice: '250000',
  compareAtPrice: null,
  hsCode: null,
  saleOk: true,
  purchaseOk: true,
  defaultCode: 'SR-01',
  barcode: null,
  weight: null,
  volume: null,
  costPrice: '100000',
  defaultVariantId: 'tpl-1:default',
  updatedAt: null,
  active: true,
  isStorable: true,
  tracking: 'none',
  ...overrides,
})

const warehouse = (overrides: Partial<WarehouseRow> = {}): WarehouseRow => ({
  id: 'wh',
  name: 'Kho chính',
  code: 'WH',
  onHand: 10,
  reserved: 2,
  available: 8,
  incoming: 5,
  outgoing: 0,
  forecasted: 15,
  orderpoints: [],
  ...overrides,
})

const setup = (): VariantEditorSetup => ({
  templateId: 'tpl-1',
  listPrice: '250000',
  lines: [
    {
      attributeId: 'size',
      name: 'Dung tích',
      createVariant: 'always',
      displayType: 'select',
      values: [
        { valueId: '30', name: '30 ml', priceExtra: '0' },
        { valueId: '50', name: '50 ml', priceExtra: '80000' },
      ],
    },
  ],
  catalogue: [
    {
      attributeId: 'size',
      name: 'Dung tích',
      createVariant: 'always',
      values: [
        { valueId: '30', name: '30 ml' },
        { valueId: '50', name: '50 ml' },
        { valueId: '100', name: '100 ml' },
      ],
    },
    { attributeId: 'color', name: 'Màu', createVariant: 'always', values: [{ valueId: 'red', name: 'Đỏ' }] },
  ],
  variants: [
    {
      id: 'v30',
      valueIds: { size: '30' },
      defaultCode: 'SR-30',
      barcode: '8930000000301',
      weight: '0.1',
      volume: '0',
      active: true,
      images: [],
    },
    {
      id: 'v50',
      valueIds: { size: '50' },
      defaultCode: 'SR-50',
      barcode: null,
      weight: '0',
      volume: '0',
      active: true,
      images: [],
    },
  ],
})

const data = (overrides: Partial<TemplateModalData> = {}): TemplateModalData => ({
  record: record(),
  images: [],
  hasVariants: false,
  variantSetup: { ...setup(), lines: [], variants: [] },
  types: ['goods', 'service'],
  categories: [{ value: 'care', label: 'Chăm sóc da' }],
  uoms: [
    { value: 'bottle', label: 'Chai' },
    { value: 'box6', label: 'Hộp 6 · 6 Chai' },
  ],
  uomName: 'Chai',
  brands: [],
  stockEnabled: true,
  permissions: {
    save: true,
    archive: true,
    duplicate: true,
    money: true,
    setCost: true,
    configureStock: true,
    uploadImage: true,
    removeImage: true,
    saveVariantSetup: true,
    configureAttributes: true,
    orderpoints: true,
  },
  lang: 'vi',
  extensionTabs: [
    { id: 'cosmetic_usage_care', label: 'Chu kỳ sử dụng', island: 'cosmetic-care.product-cycle' },
  ],
  collaboration: [{ id: 'product_mail_backend', island: 'mail.chatter' }],
  packagings: [{ id: 'box6', name: 'Hộp 6', quantity: 6 }],
  variants: [],
  stock: {
    tracked: true,
    tracking: 'none',
    warehouses: [warehouse()],
    totals: { onHand: 10, reserved: 2, available: 8, incoming: 5, outgoing: 0, forecasted: 15 },
    inUse: true,
  },
  sales: { days: 30, quantity: 4, revenue: 1000000, orders: 3, lastAt: null },
  vendors: [],
  margin: { profit: 150000, percent: 60 },
  uomLocked: false,
  issues: [],
  completeness: {
    score: 50,
    items: [
      { key: 'image', done: false },
      { key: 'categoryId', done: true },
    ],
  },
  links: {
    forecast: '/admin/stock/forecast?productId=tpl-1%3Adefault',
    orders: '/admin/sales/orders?q=Serum',
    vendorPricelists: '/admin/purchase/vendor-pricelists?q=Serum',
    list: '/admin/product/templates',
  },
  ...overrides,
})

const render = (child: JSXChild | undefined): string => renderToString(child as TemplateResult)
const form = (values: Record<string, string | string[]>): FormData => {
  const body = new FormData()
  for (const [name, value] of Object.entries(values))
    for (const item of Array.isArray(value) ? value : [value]) body.append(name, item)
  return body
}
const commands = templateModalDefinition.commands!
const dialogs = templateModalDefinition.dialogs!
/** The opening tag of the control a field renders, by its name. */
const control = (html: string, name: string): string =>
  new RegExp(`<(?:input|select|textarea)[^>]*name="${name.replace(/[.[\]]/gu, '\\$&')}"[^>]*>`, 'u').exec(
    html,
  )?.[0] ?? ''

test('product page: one form spans the record cards; cards other modules add follow it with their own islands', () => {
  const html = render(templateModalDefinition.body!(contextOf(data())))
  const formStart = html.indexOf('id="product-record"')
  const formEnd = html.indexOf('</form>', formStart)
  assert.ok(formStart > 0, 'the record form renders')
  for (const title of ['ws.general', 'ws.media', 'ws.pricing', 'ws.inventory', 'ws.variants', 'ws.vendors']) {
    const at = html.indexOf(title)
    assert.ok(at > formStart && at < formEnd, `${title} sits inside the record form`)
  }
  // The usage-cycle joint keeps its card, outside the form: its island carries forms of its own.
  const cycle = html.indexOf('data-island="cosmetic-care.product-cycle"')
  assert.ok(cycle > formEnd, 'the usage cycle card follows the form')
  assert.match(
    html,
    /data-island="cosmetic-care.product-cycle" data-props="\{&quot;templateId&quot;:&quot;tpl-1&quot;,&quot;locale&quot;:&quot;vi&quot;\}"/,
  )
  assert.match(html, />Chu kỳ sử dụng</)
  assert.match(
    html,
    /data-island="mail.chatter" data-props="\{&quot;resModel&quot;:&quot;product.Template&quot;,&quot;resId&quot;:&quot;tpl-1&quot;/,
  )
})

test('product page: a reader who may not save sees facts, not controls, and no save or duplicate', () => {
  const c = contextOf(data({ permissions: { money: true } }))
  const html = render(templateModalDefinition.body!(c))
  assert.doesNotMatch(html, /id="product-record"/)
  assert.doesNotMatch(html, /name="listPrice"/)
  assert.match(html, /data-ui="description-list"/)
  const actions = render(templateModalDefinition.pageActions!(c))
  assert.doesNotMatch(actions, /ws\.save|ws\.duplicate|ws\.archive/)
  assert.match(actions, /ws\.back/)
})

test('product page: a product with variants edits identity, measures and cost per variant, not on the template', () => {
  const variants = setup()
  const html = render(
    templateModalDefinition.body!(
      contextOf(
        data({
          hasVariants: true,
          variantSetup: variants,
          variants: [
            {
              id: 'v30',
              label: '30 ml',
              defaultCode: 'SR-30',
              barcode: '8930000000301',
              weight: '0.1',
              volume: null,
              active: true,
              price: '250000',
              costPrice: '90000',
              image: null,
              available: 3,
            },
            {
              id: 'v50',
              label: '50 ml',
              defaultCode: 'SR-50',
              barcode: null,
              weight: null,
              volume: null,
              active: true,
              price: '330000',
              costPrice: null,
              image: null,
              available: 0,
            },
          ],
        }),
      ),
    ),
  )
  for (const name of ['defaultCode', 'barcode', 'weight', 'volume', 'costPrice'])
    assert.equal(control(html, name), '', `${name} is per variant`)
  assert.match(html, /ws\.identityVariants/)
  assert.match(html, /ws\.measureVariants/)
  assert.match(html, /ws\.costVariants/)
  assert.match(html, /50 ml \(\+/, 'the attribute line shows its extra')
  assert.match(html, /ws\.missing/, 'a selling variant without barcode is flagged')
  assert.match(
    html,
    /data-ui="row-link" href="[^"]*\?dialog=editVariant&amp;dialogId=v50"/,
    'the whole variant row opens its editor',
  )
  assert.doesNotMatch(html, /data-record-dialog="editVariant"/, 'no separate edit button')
  assert.match(
    html,
    /<th data-ui="col" data-col="label" data-align="start" data-kind="text" data-width="medium"/,
    'the variant name is a text column with room to read, not a picture-wide media column',
  )
  assert.doesNotMatch(html, /ws\.editNamed/)
  const reader = render(
    templateModalDefinition.body!(
      contextOf(
        data({
          hasVariants: true,
          variantSetup: variants,
          permissions: { ...data().permissions, saveVariantSetup: false },
        }),
      ),
    ),
  )
  assert.doesNotMatch(reader, /dialog=editVariant/, 'a role that may not edit variants gets plain rows')
})

test('product page: the image dialog shows the chosen picture before it is sent', () => {
  const empty = render(dialogs.addImage!.view(contextOf(data())))
  assert.match(empty, /name="image"/)
  assert.doesNotMatch(empty, /data-ui="upload-preview"/, 'nothing is chosen yet')
  const chosen = render(
    dialogs.addImage!.view(
      contextOf(data(), {
        state: { 'file:image': 'blob:http://ket.local/1', 'file:image:name': 'serum.png' },
      }),
    ),
  )
  assert.match(chosen, /<img data-ui="upload-preview" src="blob:http:\/\/ket\.local\/1" alt="serum\.png"/)
  assert.match(chosen, /data-ui="upload-status"[^>]*>(?:<!--k\[-->)?serum\.png</)
})

test('product page: fields another role or the stock own are locked with the reason, and left out of the save', () => {
  const c = contextOf(
    data({
      uomLocked: true,
      permissions: { ...data().permissions, configureStock: false, setCost: false },
    }),
  )
  const html = render(templateModalDefinition.body!(c))
  for (const name of ['uomId', 'isStorable', 'tracking'])
    assert.match(control(html, name), /disabled/, `${name} is locked`)
  assert.match(html, /ws\.uomLocked/)
  assert.match(html, /ws\.stockSetup/)
  assert.match(control(html, 'type'), /disabled/, 'the type is chosen once, at creation')
  const input = commands.save!.input(form({ name: 'Serum', listPrice: '250.000' }), c, {})
  assert.equal(Object.hasOwn(input, 'uomId'), false, 'a locked unit is not sent, so it is kept')
  for (const name of ['costPrice']) assert.match(control(html, name), /disabled/, `${name} is locked`)
  const skipped = commands.save!.also!.filter(
    (step) => step.when && !step.when(c, form({ costPrice: '1', isStorable: '1' })),
  )
  assert.deepEqual(
    skipped.map((step) => step.fn),
    ['product.setCost', 'stock.configureProduct'],
  )
})

test('product page: the sales tax is left to accounting, so no field shows it and no step writes it', () => {
  const html = render(templateModalDefinition.body!(contextOf(data())))
  assert.doesNotMatch(html, /name="taxId"/)
  // A save that sent an empty tax would clear the one accounting set.
  for (const name of ['create', 'save', 'duplicate'] as const)
    assert.deepEqual(
      (commands[name]!.also ?? []).filter((step) => step.fn.startsWith('account.')),
      [],
      `${name} writes nothing of accounting`,
    )
})

test('product page: save reads numbers as the reader typed them and sets the cost only when it changed', () => {
  const c = contextOf(data())
  const typed = form({
    name: 'Serum',
    type: 'goods',
    uomId: 'bottle',
    listPrice: '250.000',
    compareAtPrice: '300.000',
    weight: '0,25',
    hsCode: '3304.99',
    saleOk: '1',
    costPrice: '100.000',
  })
  const input = commands.save!.input(typed, c, {})
  assert.equal(input.listPrice, '250000')
  assert.equal(input.compareAtPrice, '300000')
  assert.equal(input.weight, '0.25')
  assert.equal(input.expectedRevisionId, 'rev-1')
  assert.equal(input.saleOk, true)
  assert.equal(input.purchaseOk, false)
  const cost = commands.save!.also!.find((step) => step.fn === 'product.setCost')!
  assert.equal(cost.when!(c, typed), false, 'the same cost is not written again')
  assert.equal(cost.when!(c, form({ name: 'Serum' })), false, 'a form without the cost leaves it alone')
  assert.equal(
    cost.when!(c, form({ costPrice: '' })),
    true,
    'clearing a saved cost is sent, and refused on its field',
  )
  const changed = form({ costPrice: '120.000' })
  assert.equal(cost.when!(c, changed), true)
  assert.deepEqual(cost.input(changed, c, {}), { productId: 'tpl-1:default', standardPrice: '120000' })
  assert.equal(commands.save!.issueField!('standardPrice', changed, c), 'costPrice')
})

test('product page: numbers parse in the reader’s language', () => {
  assert.equal(parseNumber('1.250.000', 'vi'), '1250000')
  assert.equal(parseNumber('0,25', 'vi'), '0.25')
  assert.equal(parseNumber('0.25', 'vi'), '0.25', 'a dot that groups no thousands is a decimal point')
  assert.equal(parseNumber('1.250,5', 'vi'), '1250.5')
  assert.equal(parseNumber('1,250,000', 'en'), '1250000')
  assert.equal(parseNumber('  ', 'vi'), null)
  assert.equal(parseNumber('120.000 ₫', 'vi'), '120000')
})

test('product page: stock by warehouse shows the min/max rules and sets them per warehouse', () => {
  const ruled = warehouse({
    orderpoints: [{ id: 'op', productId: 'tpl-1:default', minQuantity: 12, maxQuantity: 30, available: 8 }],
  })
  const c = contextOf(
    data({ stock: { ...data().stock!, warehouses: [ruled, warehouse({ id: 'wh2', name: 'Kho 2' })] } }),
  )
  const html = render(templateModalDefinition.body!(c))
  assert.match(html, /ws\.minStock/)
  assert.match(html, />12</)
  assert.match(html, />30</)
  assert.match(html, /ws\.levelsNone/, 'a warehouse without a rule says so')
  assert.match(html, /data-record-dialog="levels" data-record-param-id="wh2"/)
  const readOnly = render(
    templateModalDefinition.body!(
      contextOf(data({ permissions: { ...data().permissions, orderpoints: false } })),
    ),
  )
  assert.doesNotMatch(readOnly, /data-record-dialog="levels"/)

  const dialog = contextOf(c.data, { dialog: { name: 'levels', params: { id: 'wh' } } })
  const view = render(dialogs.levels!.view(dialog))
  assert.match(control(view, 'min.tpl-1:default'), /value="12"/)
  const input = commands.levels!.input(
    form({ 'min.tpl-1:default': '10', 'max.tpl-1:default': '' }),
    dialog,
    {},
  )
  assert.deepEqual(input, {
    templateId: 'tpl-1',
    warehouseId: 'wh',
    rules: [{ productId: 'tpl-1:default', minQuantity: '10', maxQuantity: null }],
  })
  assert.equal(commands.levels!.issueField!('rules.0.maxQuantity', form({}), dialog), 'max.tpl-1:default')
})

test('product page: configuring attributes sends every row at once and maps refusals back to their controls', () => {
  const c = contextOf(data({ hasVariants: true, variantSetup: setup() }), {
    dialog: { name: 'configureAttributes', params: {} },
    state: { lines: 'size,new-1', 'added.size': '1' },
  })
  const view = render(dialogs.configureAttributes!.view(c))
  assert.match(view, /name="lines" value="size,new-1"/)
  assert.match(view, /name="attributeName\.new-1"/)
  assert.match(view, /name="newValue\.size\.0"/)
  assert.match(view, /name="extra\.50"[^>]*value="80\.000"/, 'a chosen value shows its saved extra')
  const submitted = form({
    lines: 'size,new-1',
    'values[size][]': ['30', '100'],
    'extra.30': '0',
    'extra.100': '150.000',
    'newValue.size.0': '200 ml',
    'newExtra.size.0': '-20.000',
    'attributeName.new-1': 'Màu',
    'newValue.new-1.0': 'Hồng',
  })
  const { lines, paths } = configureInput(submitted, c)
  assert.deepEqual(lines, [
    {
      attributeId: 'size',
      values: [
        { valueId: '30', priceExtra: '0' },
        { valueId: '100', priceExtra: '150000' },
        { name: '200 ml', priceExtra: '-20000' },
      ],
    },
    { name: 'Màu', values: [{ name: 'Hồng', priceExtra: '0' }] },
  ])
  assert.equal(paths.get('lines.0.values.2.name'), 'newValue.size.0')
  assert.equal(paths.get('lines.0.values.1.priceExtra'), 'extra.100')
  assert.equal(commands.configureAttributes!.issueField!('lines.1.name', submitted, c), 'attributeName.new-1')
  assert.deepEqual(commands.configureAttributes!.input(submitted, c, {}), { templateId: 'tpl-1', lines })
})

test('product page: editing a variant sends the whole setup with only that variant changed', () => {
  const variants = setup()
  const c = contextOf(
    data({
      hasVariants: true,
      variantSetup: variants,
      variants: [
        {
          id: 'v30',
          label: '30 ml',
          defaultCode: 'SR-30',
          barcode: '8930000000301',
          weight: '0.1',
          volume: null,
          active: true,
          price: '250000',
          costPrice: '90000',
          image: null,
        },
        {
          id: 'v50',
          label: '50 ml',
          defaultCode: 'SR-50',
          barcode: null,
          weight: null,
          volume: null,
          active: true,
          price: '330000',
          costPrice: null,
          image: null,
        },
      ],
    }),
    { dialog: { name: 'editVariant', params: { id: 'v50' } } },
  )
  const submitted = form({
    defaultCode: 'SR-50',
    barcode: '8930000000509',
    weight: '0,15',
    volume: '',
    costPrice: '110.000',
  })
  const input = commands.editVariant!.input(submitted, c, {}) as {
    variants: Array<Record<string, unknown>>
    lines: unknown[]
  }
  assert.deepEqual(input.lines, [
    {
      attributeId: 'size',
      values: [
        { valueId: '30', priceExtra: '0' },
        { valueId: '50', priceExtra: '80000' },
      ],
    },
  ])
  assert.deepEqual(input.variants[0], {
    id: 'v30',
    valueIds: { size: '30' },
    defaultCode: 'SR-30',
    barcode: '8930000000301',
    weight: '0.1',
    volume: '0',
    active: true,
  })
  assert.deepEqual(input.variants[1], {
    id: 'v50',
    valueIds: { size: '50' },
    defaultCode: 'SR-50',
    barcode: '8930000000509',
    weight: '0.15',
    volume: '0',
    active: false,
  })
  assert.equal(commands.editVariant!.issueField!('variants.1.barcode', submitted, c), 'barcode')
  assert.equal(commands.editVariant!.issueField!('variants.0.barcode', submitted, c), 'variants.0.barcode')
  const cost = commands.editVariant!.also![0]!
  assert.equal(cost.when!(c, submitted), true)
  assert.deepEqual(cost.input(submitted, c, {}), { productId: 'v50', standardPrice: '110000' })
})

test('product page: create and duplicate keep the id they minted until they succeed', () => {
  const creating = contextOf(data({ record: record({ id: '', defaultVariantId: null }) }), { creating: true })
  const route = templateModalDefinition.context
  assert.ok('route' in route)
  route.route('new', true)
  const first = commands.create!.input(
    form({
      name: 'Toner',
      type: 'goods',
      uomId: 'bottle',
      listPrice: '90.000',
      costPrice: '40.000',
    }),
    creating,
    {},
  )
  const retry = commands.create!.input(
    form({ name: 'Toner', type: 'goods', uomId: 'bottle', listPrice: '90.000' }),
    creating,
    {},
  )
  assert.equal(retry.id, first.id, 'a retry after a refused side step addresses the same product')
  const cost = commands.create!.also!.find((step) => step.fn === 'product.setCost')!
  assert.deepEqual(cost.input(form({ costPrice: '40.000' }), creating, {}), {
    productId: `${first.id}:default`,
    standardPrice: '40000',
  })
  assert.equal(
    commands.create!.created!({ ok: true, id: 'cost-row' }),
    first.id,
    'the created id is the template, not a side step’s value',
  )
  const next = commands.create!.input(form({ name: 'Mask' }), creating, {})
  assert.notEqual(next.id, first.id, 'the next create mints a new id')

  const open = contextOf(data(), {
    dialog: { name: 'duplicate', params: {} },
  })
  const copy = commands.duplicate!.input(form({ name: 'Serum (bản sao)' }), open, {})
  assert.equal(copy.sourceId, 'tpl-1')
  const stock = commands.duplicate!.also!.find((step) => step.fn === 'stock.configureProduct')!
  assert.equal(stock.input(form({}), open, {}).templateId, copy.id, 'the copy keeps the stock setup')
  assert.equal(commands.duplicate!.navigate!({}, open), `/admin/product/templates/${copy.id}`)
})

test('product page: archive and image removal ask in a small confirmation; a role without the right is told why', () => {
  const archive = dialogs.archive!
  const c = contextOf(data(), { dialog: { name: 'archive', params: {} } })
  assert.equal(archive.confirmation!.variant, 'destructive')
  assert.equal(archive.confirmation!.message(c), 'product_backend.ws.archiveBody')
  assert.equal(archive.confirmation!.disabled!(c), false)
  const denied = contextOf(data({ permissions: { save: true } }), { dialog: { name: 'archive', params: {} } })
  assert.equal(archive.confirmation!.message(denied), 'product_backend.ws.denied')
  assert.equal(archive.confirmation!.disabled!(denied), true)
  const restore = commands.restore!.input(
    form({}),
    contextOf(data({ record: record({ active: false }) })),
    {},
  )
  assert.equal(restore.active, true)
  const removing = contextOf(data(), { dialog: { name: 'removeImage', params: { id: 'media-2' } } })
  assert.deepEqual(commands.removeImage!.input(form({}), removing, {}), { id: 'media-2' })
  const blocked = render(dialogs.configureAttributes!.view(contextOf(data({ permissions: { save: true } }))))
  assert.match(blocked, /ws\.denied/)
})

test('product page: the rail words each issue and links what is missing to its control', () => {
  const c = contextOf(
    data({
      issues: [
        {
          code: 'belowMinimum',
          tone: 'warning',
          params: { warehouse: 'Kho chính', available: 8, minimum: 12, others: 0 },
        },
        { code: 'belowCost', tone: 'critical' },
        { code: 'variantBarcodes', tone: 'warning', params: { count: 2 } },
      ],
      completeness: {
        score: 60,
        items: [
          { key: 'image', done: false },
          { key: 'description', done: false },
          { key: 'categoryId', done: true },
        ],
      },
    }),
  )
  const html = render(templateModalDefinition.pageAside!(c))
  assert.match(
    html,
    /ws\.issue\.belowMinimumHelp\{&quot;warehouse&quot;:&quot;Kho chính&quot;,&quot;available&quot;:&quot;8&quot;,&quot;minimum&quot;:&quot;12&quot;/,
  )
  assert.doesNotMatch(html, /belowMinimumMore/, 'one warehouse short names it alone')
  const many = render(
    templateModalDefinition.pageAside!(
      contextOf(
        data({
          issues: [
            {
              code: 'belowMinimum',
              tone: 'warning',
              params: { warehouse: 'Kho chính', available: 8, minimum: 12, others: 2 },
            },
          ],
        }),
      ),
    ),
  )
  assert.match(
    many,
    /ws\.issue\.belowMinimumMore\{&quot;count&quot;:2\}/,
    'the other short warehouses are counted',
  )
  assert.match(html, /ws\.issue\.belowCost</)
  assert.match(html, /ws\.issue\.variantBarcodesHelp\{&quot;count&quot;:2/)
  assert.doesNotMatch(html, /variantBarcodesMore/, 'a counted issue has no line for others')
  assert.match(html, /data-record-dialog="addImage"/)
  assert.match(html, /href="#product-record-description"/)
  assert.equal(templateModalDefinition.pageAside!(contextOf(data(), { creating: true })), undefined)
})

test('product page: a fact each variant holds points at the variants card, so the list keeps one edge', () => {
  const missing = {
    score: 40,
    items: [
      { key: 'description', done: false },
      { key: 'barcode', done: false },
      { key: 'costPrice', done: false },
    ],
  }
  const withVariants = data({
    hasVariants: true,
    variantSetup: setup(),
    variants: [
      {
        id: 'v30',
        label: '30 ml',
        defaultCode: null,
        barcode: null,
        listPrice: '100000',
        costPrice: null,
        active: true,
      } as never,
    ],
    completeness: missing,
  })
  const rail = render(templateModalDefinition.pageAside!(contextOf(withVariants)))
  assert.match(rail, /href="#product-record-description"/)
  assert.equal([...rail.matchAll(/href="#product-record-variants"/g)].length, 2, 'barcode and cost')
  assert.doesNotMatch(rail, /href="#product-record-(barcode|costPrice)"/)
  // Every entry is the same compact link: none falls back to bare text beside them.
  const section = rail.slice(rail.indexOf('ws.missing'))
  assert.equal([...section.matchAll(/data-ui="action"[^>]*data-size="compact"/g)].length, 3)
  const page = render(templateModalDefinition.body!(contextOf(withVariants)))
  assert.match(
    page,
    /data-ui="surface"[^>]*id="product-record-variants"|id="product-record-variants"[^>]*data-ui="surface"/,
  )
  // Without the right to change variants there is nowhere to send the reader: plain words.
  const reader = render(
    templateModalDefinition.pageAside!(
      contextOf({ ...withVariants, permissions: { ...withVariants.permissions, saveVariantSetup: false } }),
    ),
  )
  assert.doesNotMatch(reader, /href="#product-record-variants"/)
})

test('product page: a stock figure is not named like the flag that lets a product sell', () => {
  // "Có thể bán" once named both, so the figure read as a yes/no about selling.
  for (const lang of ['vi', 'en'] as const) {
    const words = workspaceMessages[lang]
    for (const key of ['ws.available', 'ws.metricAvailable'] as const)
      assert.notEqual(words[key], words['ws.field.saleOk'], `${lang} ${key}`)
  }
  assert.equal(workspaceMessages.vi['ws.metricAvailable'], 'Tồn kho')
  assert.equal(workspaceMessages.vi['ws.available'], 'Tồn kho')
})

test('product page: the margin slot stays without a cost, and a role without costs sees no money', () => {
  const noCost = render(
    templateModalDefinition.body!(contextOf(data({ margin: null, record: record({ costPrice: null }) }))),
  )
  assert.match(noCost, /ws\.detailNoCost/)
  assert.match(noCost, /href="#product-record-costPrice"/)
  const noMoney = contextOf(
    data({
      margin: null,
      sales: { days: 30, quantity: 4, revenue: null, orders: 3, lastAt: null },
      permissions: { ...data().permissions, money: false },
    }),
  )
  const html = render(templateModalDefinition.body!(noMoney))
  assert.equal(control(html, 'costPrice'), '')
  assert.doesNotMatch(html, /ws\.detailNoCost|ws\.metricMargin/)
  assert.match(html, /ws\.detailSoldQty/)
  assert.match(html, /ws\.noMoney/)
})

test('product page: packagings list their units and barcodes, and add, edit and remove them through dialogs', () => {
  const packed = data({
    permissions: {
      ...data().permissions,
      addPackaging: true,
      removePackaging: true,
      packagingBarcodes: true,
    },
    packagings: [{ id: 'box6', name: 'Hộp 6', quantity: 6, active: true, barcode: '8930000000024' }],
    packagingChoices: [{ value: 'carton', label: 'Thùng 24 · 24 Chai' }],
    links: { ...data().links!, uoms: '/admin/product/uoms' },
  })
  const c = contextOf(packed)
  const html = render(templateModalDefinition.body!(c)).replace(/<!--[\s\S]*?-->/g, '')
  assert.match(
    html,
    /href="\/admin\/product\/uoms"[^>]*>[\s\S]*?ws\.manageUoms/,
    'the units screen is one link away',
  )
  assert.match(html, /data-record-dialog="addPackaging"/)
  assert.match(html, /6 Chai/, 'a packaging counts the product’s unit')
  assert.match(html, /8930000000024/, 'a product without variants shows its packaging barcode')
  assert.match(html, /data-record-dialog="packagingBarcode" data-record-param-id="box6"/)
  assert.match(html, /data-record-dialog="removePackaging" data-record-param-id="box6"/)

  const reader = render(
    templateModalDefinition.body!(
      contextOf({
        ...packed,
        permissions: {
          ...packed.permissions,
          addPackaging: false,
          removePackaging: false,
          packagingBarcodes: false,
        },
      }),
    ),
  )
  assert.doesNotMatch(reader, /data-record-dialog="(addPackaging|packagingBarcode|removePackaging)"/)
  const empty = render(templateModalDefinition.body!(contextOf(data({ packagings: [] }))))
  assert.match(empty, /ws\.noPackagings\{&quot;uom&quot;:&quot;Chai&quot;\}/)

  const adding = contextOf(packed, { dialog: { name: 'addPackaging', params: {} } })
  const dialog = render(dialogs.addPackaging!.view(adding)).replace(/<!--[\s\S]*?-->/g, '')
  assert.match(dialog, /<option value="carton"[^>]*>Thùng 24 · 24 Chai<\/option>/)
  assert.match(dialog, /name="barcode"/, 'a product without variants names the barcode as it adds the unit')
  const submitted = form({ uomId: 'carton', barcode: '8930000000031' })
  assert.deepEqual(commands.addPackaging!.input(submitted, adding, {}), {
    templateId: 'tpl-1',
    uomId: 'carton',
  })
  const barcode = commands.addPackaging!.also![0]!
  assert.equal(barcode.when!(adding, submitted), true)
  assert.deepEqual(barcode.input(submitted, adding, {}), {
    productId: 'tpl-1:default',
    barcodes: [{ uomId: 'carton', barcode: '8930000000031' }],
  })
  assert.equal(barcode.when!(adding, form({ uomId: 'carton', barcode: '' })), false)
  assert.equal(commands.addPackaging!.issueField!('barcodes.0.barcode', submitted, adding), 'barcode')
  assert.match(
    render(dialogs.addPackaging!.view(contextOf({ ...packed, packagingChoices: [] }))),
    /ws\.noPackagingChoice/,
    'with every unit added the dialog says where new units are made',
  )

  const editing = contextOf(packed, { dialog: { name: 'packagingBarcode', params: { id: 'box6' } } })
  assert.match(render(dialogs.packagingBarcode!.view(editing)), /value="8930000000024"/)
  assert.deepEqual(commands.packagingBarcode!.input(form({ barcode: '' }), editing, {}), {
    productId: 'tpl-1:default',
    barcodes: [{ uomId: 'box6', barcode: null }],
  })
  const removing = contextOf(packed, { dialog: { name: 'removePackaging', params: { id: 'box6' } } })
  assert.deepEqual(commands.removePackaging!.input(form({}), removing, {}), {
    templateId: 'tpl-1',
    uomId: 'box6',
  })
})

test('product page: a variant sets its barcode in each packaging in its own dialog', () => {
  const variant = {
    id: 'v50',
    label: '50 ml',
    defaultCode: 'SR-50',
    barcode: null,
    weight: null,
    volume: null,
    active: true,
    price: '330000',
    costPrice: null,
    image: null,
    packagingBarcodes: { box6: '8930000000024' },
  }
  const c = contextOf(
    data({
      hasVariants: true,
      permissions: { ...data().permissions, packagingBarcodes: true },
      variantSetup: setup(),
      variants: [variant],
      packagings: [
        { id: 'box6', name: 'Hộp 6', quantity: 6, active: true, barcode: null },
        { id: 'carton', name: 'Thùng 24', quantity: 24, active: true, barcode: null },
      ],
    }),
    { dialog: { name: 'editVariant', params: { id: 'v50' } } },
  )
  const html = render(dialogs.editVariant!.view(c))
  assert.match(
    html,
    /name="packaging\.box6"[^>]*value="8930000000024"|value="8930000000024"[^>]*name="packaging\.box6"/,
  )
  assert.match(html, /name="packaging\.carton"/)
  const body = render(templateModalDefinition.body!(c))
  assert.match(body, /ws\.packagingVariantHelp/, 'with variants the barcodes live with each variant')
  assert.doesNotMatch(body, /data-record-dialog="packagingBarcode"/)

  const step = commands.editVariant!.also!.find((one) => one.fn === 'product.setPackagingBarcodes')!
  const unchanged = form({ 'packaging.box6': '8930000000024', 'packaging.carton': '' })
  assert.equal(step.when!(c, unchanged), false, 'an untouched barcode is not written again')
  const changed = form({ 'packaging.box6': '8930000000024', 'packaging.carton': '8930000000031' })
  assert.equal(step.when!(c, changed), true)
  assert.deepEqual(step.input(changed, c, {}), {
    productId: 'v50',
    barcodes: [
      { uomId: 'box6', barcode: '8930000000024' },
      { uomId: 'carton', barcode: '8930000000031' },
    ],
  })
  assert.equal(commands.editVariant!.issueField!('barcodes.1.barcode', changed, c), 'packaging.carton')
})
