import assert from 'node:assert/strict'
import { setMaxListeners } from 'node:events'
import { Readable } from 'node:stream'
import { test, type TestContext } from 'node:test'
import { bootDeployment, callFn, translator } from '@ketvietlab/ketjs'
import type { Row, ServeContext } from '@ketvietlab/ketjs'
import { effect, renderToString } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { uomModalDefinition } from '../packages/ketsuite/src/modules/product_backend/modal/uom-modal-view.tsx'
import {
  parseQuantity,
  typedQuantity,
  type UnitAnswer,
  type UnitModalData,
} from '../packages/ketsuite/src/modules/product_backend/units.ts'
import {
  unitList,
  type UnitListLabels,
} from '../packages/ketsuite/src/modules/product_backend/units/island.tsx'

// Units of measure (Sản phẩm › Đơn vị tính): the domain rules behind the record, the list's
// read, the record's read and save, the list island and the record modal.

const scope = { company: 'acme', companies: ['acme'], branch: 'root:acme', branches: ['root:acme'] }

const boot = async (t: TestContext) => {
  const booted = await bootDeployment(ketsuite, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'product-units' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  const adapter = booted.adapter!
  const manifest = booted.manifest
  const call = async (fn: string, args: Record<string, unknown> = {}, actor: string | null = 'root') => {
    const result = await callFn(fn, args, { adapter, manifest, scope, actor })
    if (!result.ok) throw Object.assign(new Error(`${fn} refused`), { result })
    return result.value as Row
  }
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, null)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, null)
  await call(
    'user.createUser',
    { id: 'root', login: 'root', password: 'correct horse', name: 'Root', superuser: true },
    null,
  )
  // "viewer" may see units but not change them.
  await call('user.createUser', { id: 'viewer', login: 'viewer', name: 'Viewer' }, null)
  await call('user.grantCompany', { id: 'viewer:acme', userId: 'viewer', companyId: 'acme' })
  await call('user.saveRole', { id: 'unit-reader', name: 'Unit reader' })
  for (const fnKey of ['product_backend.searchUnits', 'product_backend.unitContext'])
    await call('user.grantFunction', { id: `unit-reader:${fnKey}`, roleId: 'unit-reader', fnKey })
  await call('user.assignRole', { id: 'viewer:unit-reader', userId: 'viewer', roleId: 'unit-reader' })

  // Chai ← Hộp 6 chai (6) ← Thùng 24 chai (4 hộp); kg ← g (0.001, archived).
  await call('uom.saveUnit', { id: 'bottle', name: 'Chai', relativeFactor: '1' })
  await call('uom.saveUnit', { id: 'box', name: 'Hộp 6 chai', relativeUomId: 'bottle', relativeFactor: '6' })
  await call('uom.saveUnit', {
    id: 'carton',
    name: 'Thùng 24 chai',
    relativeUomId: 'box',
    relativeFactor: '4',
  })
  await call('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' })
  await call('uom.saveUnit', {
    id: 'g',
    name: 'g',
    relativeUomId: 'kg',
    relativeFactor: '0.001',
    active: false,
  })
  await call('product.saveTemplate', { id: 'serum', name: 'Serum', type: 'goods', uomId: 'bottle' })
  await call('product.saveTemplate', { id: 'toner', name: 'Toner', type: 'goods', uomId: 'bottle' })
  await call('product.saveTemplate', { id: 'old', name: 'Old', type: 'goods', uomId: 'bottle' })
  const old = await call('product.getTemplate', { id: 'old' })
  await call('product.archiveTemplate', {
    id: 'old',
    active: false,
    expectedRevisionId: old.revisionId ?? 'initial',
    confirmed: true,
  })
  // Packing a product in a carton fixes the carton's conversion.
  await call('product.addTemplateUom', { templateId: 'serum', uomId: 'carton' })

  const routeOf = (path: string, actor: string) => {
    const entry = manifest.routes[path]
    if (!entry) throw new Error(`${path} is not composed`)
    return entry.make({
      call: (name: string, input: Record<string, unknown>) => call(name, input, actor),
      translate: (locale: string) => translator(manifest, locale),
      localeOf: (url: URL) => url.searchParams.get('lang') ?? 'vi',
    } as unknown as ServeContext)
  }
  const post = async (
    body: Record<string, unknown>,
    options: { actor?: string; origin?: string; lang?: string } = {},
  ) => {
    const raw = JSON.stringify(body)
    const req = Object.assign(Readable.from([Buffer.from(raw, 'utf8')]), {
      method: 'POST',
      headers: {
        host: 'ket.local',
        'content-type': 'application/json',
        ...(options.origin ? { origin: options.origin } : {}),
      },
    })
    const route = routeOf('/admin/product/uoms/command', options.actor ?? 'root')
    const result = await route(
      new URL(`http://ket.local/admin/product/uoms/command?lang=${options.lang ?? 'vi'}`),
      req as never,
      {},
    )
    const text = String(result.body)
    return { status: result.status ?? 200, body: (text.startsWith('{') ? JSON.parse(text) : text) as Row }
  }
  const unit = async (id: string) =>
    ((await call('product_backend.searchUnits', { status: 'all', pageSize: 100 })) as UnitAnswer).rows.find(
      (row) => row.id === id,
    )
  return { call, post, unit }
}

const errorsOf = (value: unknown) =>
  ((value as { errors?: Array<{ field: string; code?: string }> }).errors ?? []).map((error) => [
    error.field,
    error.code,
  ])

test('uom: one name per unit, three decimals, and a counted unit stays active', async (t) => {
  const { call } = await boot(t)
  const save = (input: Record<string, unknown>) => call('uom.saveUnit', input)
  assert.deepEqual(errorsOf(await save({ id: 'x', name: '  ', relativeFactor: '1' })), [
    ['name', 'uom.error.nameRequired'],
  ])
  // Names are compared without case or surrounding spaces, against other units only.
  assert.deepEqual(errorsOf(await save({ id: 'x', name: ' CHAI ', relativeFactor: '1' })), [
    ['name', 'uom.error.nameTaken'],
  ])
  assert.equal(
    (await save({ id: 'bottle', name: 'Chai', relativeFactor: '1' })).ok,
    true,
    'a unit keeps its own name',
  )
  assert.deepEqual(
    errorsOf(await save({ id: 'x', name: 'Lốc', relativeUomId: 'bottle', relativeFactor: '0.0001' })),
    [['relativeFactor', 'uom.error.factorDigits']],
  )
  assert.equal(
    (await save({ id: 'x', name: 'Lốc', relativeUomId: 'bottle', relativeFactor: '0.125' })).ok,
    true,
  )
  // The box counts in bottles, so bottles cannot go; the archived gram does not hold kg back.
  assert.deepEqual(errorsOf(await save({ id: 'bottle', name: 'Chai', relativeFactor: '1', active: false })), [
    ['active', 'uom.error.archiveCounted'],
  ])
  assert.equal((await save({ id: 'kg', name: 'kg', relativeFactor: '1', active: false })).ok, true)
})

test('uom: every refusal of a save carries a code a screen can word', async (t) => {
  const { call } = await boot(t)
  const save = (input: Record<string, unknown>) => call('uom.saveUnit', input)
  assert.deepEqual(
    errorsOf(await save({ id: 'x', name: 'Zero', relativeUomId: 'bottle', relativeFactor: '0' })),
    [['relativeFactor', 'uom.error.factorPositive']],
  )
  assert.deepEqual(
    errorsOf(await save({ id: 'box', name: 'Hộp 6 chai', relativeUomId: 'box', relativeFactor: '6' })),
    [['relativeUomId', 'uom.error.referenceLoop']],
  )
  assert.deepEqual(errorsOf(await save({ id: 'kg', name: 'kg', relativeUomId: 'g', relativeFactor: '2' })), [
    ['relativeUomId', 'uom.error.referenceLoop'],
  ])
  // Even a loop is first a conversion change, and the bottle's carton is packed.
  assert.deepEqual(
    errorsOf(await save({ id: 'bottle', name: 'Chai', relativeUomId: 'carton', relativeFactor: '2' })),
    [['relativeFactor', 'uom.error.conversionUsedBelow']],
  )
  // The carton is packed, so its conversion is fixed, and so is the box it counts in.
  assert.deepEqual(
    errorsOf(await save({ id: 'carton', name: 'Thùng 24 chai', relativeUomId: 'box', relativeFactor: '5' })),
    [['relativeFactor', 'uom.error.conversionLocked']],
  )
  const below = (await save({
    id: 'box',
    name: 'Hộp 6 chai',
    relativeUomId: 'bottle',
    relativeFactor: '8',
  })) as {
    errors: Array<{ code: string; params: Record<string, unknown> }>
  }
  assert.equal(below.errors[0]!.code, 'uom.error.conversionUsedBelow')
  assert.deepEqual(below.errors[0]!.params, { unit: 'Thùng 24 chai' })
  assert.equal(
    (await save({ id: 'carton', name: 'Thùng 4 hộp', relativeUomId: 'box', relativeFactor: '4' })).ok,
    true,
    'a name is not a conversion',
  )
})

test('units list read: families smallest first, kinds, statuses, accent-free search and usage', async (t) => {
  const { call } = await boot(t)
  const read = (input: Record<string, unknown> = {}) =>
    call('product_backend.searchUnits', input) as Promise<UnitAnswer>
  const all = await read({ status: 'all' })
  assert.deepEqual(
    all.rows.map((row) => [row.id, row.family, row.rootQuantity]),
    [
      ['bottle', 'Chai', 1],
      ['box', 'Chai', 6],
      ['carton', 'Chai', 24],
      ['kg', 'kg', 1],
      ['g', 'kg', 0.001],
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1])) || Number(a[2]) - Number(b[2])),
  )
  const bottle = all.rows.find((row) => row.id === 'bottle')!
  assert.deepEqual([bottle.products, bottle.packagings], [2, 0], 'the archived product does not count')
  const carton = all.rows.find((row) => row.id === 'carton')!
  assert.deepEqual(
    [carton.packagings, carton.locked, carton.reference, carton.factor],
    [1, true, 'Hộp 6 chai', '4'],
  )

  const active = await read()
  assert.deepEqual(
    active.rows.map((row) => row.id),
    ['bottle', 'box', 'carton', 'kg'],
  )
  assert.deepEqual(active.counts, { active: 4, archived: 1 })
  assert.deepEqual(
    (await read({ status: 'archived' })).rows.map((row) => row.id),
    ['g'],
  )
  assert.deepEqual(
    (await read({ kind: 'reference' })).rows.map((row) => row.id),
    ['bottle', 'kg'],
  )
  assert.deepEqual(
    (await read({ kind: 'derived', status: 'all' })).rows.map((row) => row.id),
    ['box', 'carton', 'g'],
  )
  // "hop" finds "Hộp"; a family name finds its units; the counts follow the search.
  const hop = await read({ q: 'hop' })
  assert.deepEqual(
    hop.rows.map((row) => row.id),
    ['box'],
  )
  assert.deepEqual(
    (await read({ q: 'KG', status: 'all' })).rows.map((row) => row.id),
    ['g', 'kg'],
  )
  assert.deepEqual(hop.counts, { active: 1, archived: 0 })
  const nothing = await read({ q: 'pallet' })
  assert.deepEqual([nothing.total, nothing.isEmpty], [0, false], 'no match is not an empty catalogue')
  const paged = await read({ pageSize: 3, page: 9 })
  assert.deepEqual([paged.page, paged.pages, paged.rows.map((row) => row.id)], [2, 2, ['kg']])
})

test('unit record read: choices never loop back, archived units are marked, the viewer may only look', async (t) => {
  const { call } = await boot(t)
  const read = async (input: Record<string, unknown>, actor = 'root') =>
    ((await call('product_backend.unitContext', input, actor)) as { data: UnitModalData } | null)?.data ??
    null
  const box = (await read({ id: 'box' }))!
  assert.deepEqual(
    box.references.map((choice) => choice.value),
    ['bottle', 'kg'],
    'not itself, not the carton counting it',
  )
  assert.deepEqual(box.record, {
    id: 'box',
    name: 'Hộp 6 chai',
    referenceId: 'bottle',
    factor: '6',
    active: true,
  })
  assert.deepEqual(box.derived, ['Thùng 24 chai'])
  assert.deepEqual(box.conversion, { quantity: 6, root: 'Chai' })
  assert.equal(box.editable, true)
  const kg = (await read({ id: 'kg', locale: 'en' }))!
  assert.deepEqual(kg.derived, ['g (archived)'])
  assert.equal(kg.conversion, null)
  assert.deepEqual(
    kg.references.find((choice) => choice.value === 'carton'),
    { value: 'carton', label: 'Thùng 24 chai · 24 Chai' },
    'a choice says what it holds',
  )
  // An archived reference is offered only to the unit already counting in it.
  const g = (await read({ id: 'g' }))!
  assert.equal(
    g.references.some((choice) => choice.value === 'kg'),
    true,
  )
  assert.equal(
    box.references.some((choice) => choice.value === 'g'),
    false,
  )
  const carton = (await read({ id: 'carton' }))!
  assert.deepEqual(carton.usage, { products: 0, packagings: 1, locked: true })
  const fresh = (await read({}))!
  assert.deepEqual(fresh.record, { id: '', name: '', referenceId: '', factor: '', active: true })
  assert.equal(fresh.references.length, 4)
  assert.equal(await read({ id: 'missing' }), null)

  const looking = (await read({ id: 'box' }, 'viewer'))!
  assert.equal(looking.editable, false)
  assert.equal(await read({}, 'viewer'), null, 'creating needs the right to save')
})

test('unit quantities read as each language writes them', () => {
  const cases: Array<[string, 'vi' | 'en', string | null]> = [
    ['12', 'vi', '12'],
    ['0,5', 'vi', '0.5'],
    ['1.000', 'vi', '1000'],
    ['1.000,5', 'vi', '1000.5'],
    ['1.5', 'vi', '1.5'],
    ['0,125', 'vi', '0.125'],
    [' 24 ', 'vi', '24'],
    ['1,000', 'en', '1000'],
    ['0.5', 'en', '0.5'],
    ['0', 'vi', null],
    ['-1', 'vi', null],
    ['abc', 'en', null],
    ['', 'vi', null],
  ]
  for (const [typed, lang, expected] of cases)
    assert.equal(parseQuantity(typed, lang), expected, `${typed} (${lang})`)
  assert.equal(typedQuantity('0.5', 'vi'), '0,5')
  assert.equal(typedQuantity('0.5', 'en'), '0.5')
})

test('unit save route: the form becomes uom.saveUnit, refusals come back in the viewer’s words', async (t) => {
  const { post, unit } = await boot(t)
  const created = await post({
    id: null,
    name: 'Lốc 4 chai',
    referenceId: 'bottle',
    factor: '4',
    active: true,
  })
  assert.equal(created.status, 200)
  const value = created.body.value as { ok: boolean; id: string }
  assert.equal(value.ok, true)
  const stored = (await unit(value.id))!
  assert.deepEqual([stored.name, stored.referenceId, Number(stored.factor)], ['Lốc 4 chai', 'bottle', 4])
  // A Vietnamese "1.000" is a thousand; a reference unit counts 1 whatever the field said.
  const ton = (await post({ id: null, name: 'Tấn', referenceId: 'kg', factor: '1.000', active: true })).body
    .value as Row
  assert.equal(Number((await unit(String(ton.id)))!.factor), 1000)
  const litre = (await post({ id: null, name: 'Lít', referenceId: '', factor: 'abc', active: true })).body
    .value as Row
  assert.deepEqual(
    [(await unit(String(litre.id)))!.referenceId, (await unit(String(litre.id)))!.rootQuantity],
    [null, 1],
  )
  const fields = async (body: Record<string, unknown>, lang = 'vi') =>
    (
      (await post(body, { lang })).body.value as { errors: Array<{ field: string; message: string }> }
    ).errors.map((error) => [error.field, error.message])
  assert.deepEqual(await fields({ id: null, name: 'chai', referenceId: '', factor: '', active: true }), [
    ['name', 'Đã có đơn vị mang tên này.'],
  ])
  assert.deepEqual(
    await fields({ id: 'box', name: 'Hộp 6 chai', referenceId: 'bottle', factor: '0', active: true }),
    [['factor', 'Nhập số lượng lớn hơn 0, ví dụ 12 hoặc 0,5.']],
  )
  assert.deepEqual(
    await fields({ id: 'box', name: 'Hộp 6 chai', referenceId: 'carton', factor: '2', active: true }),
    [['referenceId', 'Đơn vị tham chiếu không còn. Chọn đơn vị khác.']],
  )
  assert.deepEqual(
    await fields({ id: 'box', name: 'Hộp 6 chai', referenceId: 'bottle', factor: '8', active: true }, 'en'),
    [
      [
        'factor',
        'Thùng 24 chai counts in this unit and is in use (a packaging, stock or documents), so the conversion stays.',
      ],
    ],
  )
  // Two active products are in bottles: archiving them is refused before the domain is asked.
  assert.deepEqual(await fields({ id: 'bottle', name: 'Chai', referenceId: '', factor: '', active: false }), [
    [
      'active',
      'Còn 2 sản phẩm đang dùng đơn vị này làm đơn vị tính. Đổi đơn vị của chúng trước khi lưu trữ.',
    ],
  ])
  const renamed = await post({ id: 'g', name: 'gam', referenceId: 'kg', factor: '0,001', active: false })
  assert.equal((renamed.body.value as Row).ok, true)
  assert.equal((await unit('g'))!.name, 'gam')

  assert.equal(
    (
      await post(
        { id: 'box', name: 'Hộp', referenceId: 'bottle', factor: '6', active: true },
        { actor: 'viewer' },
      )
    ).status,
    403,
  )
  assert.equal((await unit('box'))!.name, 'Hộp 6 chai')
  assert.equal(
    (
      await post(
        { id: 'box', name: 'Hộp', referenceId: 'bottle', factor: '6', active: true },
        { origin: 'https://evil.example' },
      )
    ).status,
    403,
  )
  assert.equal(
    (await post({ id: 'missing', name: 'Mới', referenceId: '', factor: '', active: true })).status,
    403,
  )
})

// ── The list island ─────────────────────────────────────────────────────────────

class ElementFixture extends EventTarget {
  querySelector() {
    return null
  }
  closest(_selector: string): unknown {
    return null
  }
}
class AnchorFixture extends ElementFixture {
  readonly href: string
  constructor(href: string) {
    super()
    this.href = href
  }
  override closest(selector: string) {
    return selector === 'a[href]' ? this : null
  }
}

const labels = {
  ...Object.fromEntries(
    [
      'search',
      'searchPlaceholder',
      'searchSubmit',
      'status',
      'active',
      'archived',
      'all',
      'kind',
      'kindAll',
      'kindReference',
      'kindDerived',
      'name',
      'conversion',
      'root',
      'products',
      'packagings',
      'state',
      'reference',
      'locked',
      'noMatch',
      'noMatchHint',
      'create',
      'pager',
      'selectAll',
      'selectRow',
      'sortedAscending',
      'sortedDescending',
      'previousPage',
      'nextPage',
      'loading',
      'loadError',
      'retry',
      'empty',
      'emptyHint',
      'clearFilters',
      'offline',
      'retryHint',
      'deniedTitle',
      'deniedMessage',
      'announceNone',
    ].map((key) => [key, `<${key}>`]),
  ),
  announce: '{from}–{to}/{total}',
} as UnitListLabels

const answer = (
  rows: Array<Partial<UnitAnswer['rows'][number]> & { id: string }>,
  extra: Partial<UnitAnswer> = {},
): UnitAnswer => ({
  query: { q: '', status: 'active', kind: 'all', page: 1, pageSize: 50 },
  total: rows.length,
  page: 1,
  pages: 1,
  rows: rows.map((row) => ({
    name: row.id,
    referenceId: null,
    reference: null,
    factor: null,
    familyId: row.id,
    family: row.id,
    rootQuantity: 1,
    products: 0,
    packagings: 0,
    active: true,
    locked: false,
    ...row,
  })),
  counts: { active: rows.length, archived: 0 },
  isEmpty: false,
  ...extra,
})

/** What a read answers: an answer, a refusal as the server sends it, or `null` for a dropped connection. */
type Reply = (input: Row) => UnitAnswer | Response | null | Promise<UnitAnswer | Response | null>

const harness = (t: TestContext, start = '/admin/product/uoms', first?: Reply) => {
  const origin = 'http://ket.local'
  let current = new URL(start, origin)
  const writes: string[] = []
  const reads: Row[] = []
  let reply: Reply =
    first ??
    ((_input: Row): UnitAnswer =>
      answer([
        { id: 'bottle', name: 'Chai', family: 'Chai', familyId: 'bottle', products: 2 },
        {
          id: 'box',
          name: 'Hộp 6',
          reference: 'Chai',
          referenceId: 'bottle',
          factor: '6',
          family: 'Chai',
          familyId: 'bottle',
          rootQuantity: 6,
          locked: true,
        },
      ]))
  const doc = new EventTarget()
  const win = new EventTarget()
  const online = { onLine: true }
  const globals: Record<string, unknown> = {
    document: doc,
    window: win,
    navigator: online,
    location: {
      get href() {
        return current.href
      },
      get origin() {
        return origin
      },
    },
    history: {
      state: null,
      pushState(_state: unknown, _title: string, url: string) {
        current = new URL(url, origin)
        writes.push(`${current.pathname}${current.search}`)
      },
      replaceState(_state: unknown, _title: string, url: string) {
        current = new URL(url, origin)
        writes.push(`replace ${current.pathname}${current.search}`)
      },
    },
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, '/_ket/fn/product_backend.searchUnits')
      const input = JSON.parse(String(init.body)) as Row
      reads.push(input)
      const value = await reply(input)
      if (value === null) throw new TypeError('Failed to fetch')
      return value instanceof Response ? value : Response.json({ ok: true, value })
    },
  }
  const previous = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const lifetime = new AbortController()
  setMaxListeners(20, lifetime.signal)
  const root = new ElementFixture()
  const island = unitList({
    href: start,
    lang: 'vi',
    pageSize: 50,
    labels,
    createHref: '/admin/product/uoms?record=product.uom:new',
  })
  let markup = ''
  const stop = effect(() => {
    markup = renderToString(island.view())
  })
  t.after(() => {
    lifetime.abort()
    stop()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  island.mount!({ root: root as never, lifetime: lifetime.signal } as never)
  const click = (href: string) => {
    const event = Object.assign(new Event('click', { cancelable: true, bubbles: true }), { button: 0 })
    Object.defineProperty(event, 'target', { value: new AnchorFixture(new URL(href, origin).href) })
    root.dispatchEvent(event)
    return { prevented: event.defaultPrevented, bubbled: !event.cancelBubble }
  }
  const type = (value: string) => {
    const event = new Event('input', { bubbles: true })
    Object.defineProperty(event, 'target', {
      value: { name: 'q', value, form: { action: `${origin}/admin/product/uoms` } },
    })
    root.dispatchEvent(event)
  }
  /** Back or Forward to `path`, as the shell announces it. */
  const back = (path: string) => {
    current = new URL(path, origin)
    const event = new CustomEvent('ket:popstate', { cancelable: true })
    doc.dispatchEvent(event)
    return event.defaultPrevented
  }
  const retry = () => {
    const event = new Event('click', { cancelable: true, bubbles: true })
    const button = Object.assign(new ElementFixture(), {
      closest: (selector: string) => (selector === '[name="units-retry"]' ? button : null),
    })
    Object.defineProperty(event, 'target', { value: button })
    root.dispatchEvent(event)
  }
  return {
    html: () => markup,
    reads,
    writes,
    click,
    type,
    back,
    retry,
    online,
    win,
    reply: (next: Reply) => {
      reply = next
    },
  }
}

const settled = () => new Promise<void>((resolve) => setImmediate(resolve))
const shownRows = (markup: string) =>
  [...markup.matchAll(/data-ui="kt-row" data-row="([^"]+)"/g)].map((match) => match[1])

test('units list island: one read per query, families as groups, a row opens the record', async (t) => {
  const list = harness(t, '/admin/product/uoms?kind=derived&q=h%E1%BB%99p')
  assert.match(list.html(), /aria-busy="true"|data-loading/, 'the first render is the loading frame')
  await settled()
  assert.deepEqual(list.reads, [{ q: 'hộp', status: 'active', kind: 'derived', page: 1, pageSize: 50 }])
  assert.deepEqual(shownRows(list.html()), ['bottle', 'box'])
  assert.doesNotMatch(
    list.html().replace(/<!--[\s\S]*?-->/g, ''),
    /<span><\/span>/,
    'no empty item takes a gap',
  )
  assert.match(list.html(), /1 Hộp 6 = 6 Chai/)
  assert.match(
    list.html(),
    /role="status" aria-live="polite">.*1–2\/2/s,
    'the live region announces the range',
  )
  assert.match(list.html(), /&lt;locked&gt;/, 'a fixed conversion is badged')
  assert.match(list.html(), /&lt;kind&gt;: &lt;kindDerived&gt;/, 'the kind menu names the kind in force')
  assert.match(
    list.html(),
    /href="\/admin\/product\/uoms\?kind=derived&amp;q=h%E1%BB%99p&amp;record=product\.uom%3Abox"/,
  )

  // A kind is followed in place, keeps the search and starts on page 1; the click still bubbles.
  const kind = list.click('/admin/product/uoms?q=h%E1%BB%99p&kind=reference')
  assert.deepEqual(kind, { prevented: true, bubbled: true })
  await settled()
  assert.deepEqual(list.writes, ['/admin/product/uoms?q=h%E1%BB%99p&kind=reference'])
  assert.equal(list.reads.at(-1)!.kind, 'reference')

  // A record link is the record runtime's to open.
  assert.deepEqual(list.click('/admin/product/uoms?record=product.uom:box'), {
    prevented: false,
    bubbled: true,
  })
  assert.equal(list.reads.length, 2)

  // A saved unit: the list reads itself again and tells the shell to leave the page alone.
  const saved = new CustomEvent('ket:records-changed', {
    cancelable: true,
    detail: { kind: 'product.uom', ids: ['box'] },
  })
  ;(globalThis.document as EventTarget).dispatchEvent(saved)
  assert.equal(saved.defaultPrevented, true)
  await settled()
  assert.equal(list.reads.length, 3)
})

test('units list island: typing filters after a pause, once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const list = harness(t)
  await settled()
  list.type('c')
  list.type('ch')
  list.type('cha')
  t.mock.timers.tick(249)
  assert.equal(list.reads.length, 1)
  t.mock.timers.tick(1)
  await settled()
  assert.deepEqual(list.writes, ['/admin/product/uoms?q=cha'])
  assert.deepEqual(
    list.reads.map((read) => read.q),
    ['', 'cha'],
  )
  // The same text again reads nothing.
  list.type('cha ')
  t.mock.timers.tick(250)
  await settled()
  assert.equal(list.reads.length, 2)
  // Refining the search replaces the entry the first pause pushed: Back skips the keystrokes.
  list.type('chai')
  t.mock.timers.tick(250)
  await settled()
  assert.deepEqual(list.writes, ['/admin/product/uoms?q=cha', 'replace /admin/product/uoms?q=chai'])
})

test('units list island: Back shows the page it left at once and reads it again behind it', async (t) => {
  const list = harness(t)
  await settled()
  list.reply(() => answer([{ id: 'kg', name: 'kg' }]))
  list.click('/admin/product/uoms?kind=reference')
  await settled()
  assert.deepEqual(shownRows(list.html()), ['kg'])
  // The next read never answers: what shows is the cached page, not a skeleton or dimmed rows.
  list.reply(() => new Promise(() => {}))
  assert.equal(list.back('/admin/product/uoms'), true)
  assert.deepEqual(shownRows(list.html()), ['bottle', 'box'])
  assert.equal(list.reads.length, 3, 'and it is read again')
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.doesNotMatch(list.html(), /data-ui="ket-table"[^>]*aria-busy="true"|kt-scroll[^>]*aria-busy="true"/)
})

test('units list island: closing a record reads nothing more than a save asked for', async (t) => {
  const list = harness(t, '/admin/product/uoms?kind=derived')
  await settled()
  assert.equal(list.reads.length, 1)
  // The record runtime pushed `?record=`; Back closes it onto the query already shown.
  assert.equal(list.back('/admin/product/uoms?kind=derived'), true)
  await settled()
  assert.equal(list.reads.length, 1, 'closing a record does not read the list again')
  // A save reads the list once; the Back that closes the modal joins that read.
  ;(globalThis.document as EventTarget).dispatchEvent(
    new CustomEvent('ket:records-changed', {
      cancelable: true,
      detail: { kind: 'product.uom', ids: ['box'] },
    }),
  )
  assert.equal(list.back('/admin/product/uoms?kind=derived'), true)
  await settled()
  assert.equal(list.reads.length, 2, 'one read for the save, none for the Back')
  // Back to another query still reads it.
  list.back('/admin/product/uoms')
  await settled()
  assert.equal(list.reads.length, 3)
  // A failed page is read again when Back lands on it.
  list.reply(() => null)
  list.click('/admin/product/uoms?kind=reference')
  await settled()
  list.back('/admin/product/uoms?kind=reference')
  await settled()
  assert.equal(list.reads.length, 5, 'Back retries a page that failed')
})

test('units list island: a failed read keeps the rows, drops the counts and offers a retry', async (t) => {
  const list = harness(t)
  await settled()
  assert.match(list.html(), /data-ui="list-facet-count"/)
  list.reply(() => Response.json({ ok: false }, { status: 500 }))
  list.click('/admin/product/uoms?status=all')
  await settled()
  assert.match(list.html(), /data-tone="danger"[\s\S]*?&lt;loadError&gt;/)
  assert.doesNotMatch(list.html(), /data-ui="list-facet-count"/, 'stale figures are not shown as current')
  list.reply(() => answer([{ id: 'g', name: 'g', active: false }], { counts: { active: 2, archived: 1 } }))
  list.retry()
  await settled()
  assert.deepEqual(shownRows(list.html()), ['g'])
  assert.doesNotMatch(list.html(), /&lt;loadError&gt;/)
})

test('units list island: offline waits for the connection; a refusal says so in the list’s place', async (t) => {
  const offline = harness(t, '/admin/product/uoms', () => null)
  offline.online.onLine = false
  await settled()
  assert.match(offline.html(), /data-tone="warning"[\s\S]*?&lt;offline&gt;/)
  offline.online.onLine = true
  offline.reply(() => answer([{ id: 'kg', name: 'kg' }]))
  offline.win.dispatchEvent(new Event('online'))
  await settled()
  assert.deepEqual(shownRows(offline.html()), ['kg'])
})

test('units list island: a reader without the right sees why, not an empty list', async (t) => {
  const denied = harness(t, '/admin/product/uoms', () => Response.json({ ok: false }, { status: 403 }))
  await settled()
  assert.match(denied.html(), /&lt;deniedTitle&gt;/)
  assert.deepEqual(shownRows(denied.html()), [])
  assert.doesNotMatch(denied.html(), /&lt;loadError&gt;/)
})

test('units list island: an empty catalogue invites the first unit, no match says so', async (t) => {
  const list = harness(t, '/admin/product/uoms', () =>
    answer([], { isEmpty: true, counts: { active: 0, archived: 0 } }),
  )
  await settled()
  assert.match(list.html(), /&lt;empty&gt;/)
  assert.match(list.html(), /href="\/admin\/product\/uoms\?record=product\.uom:new"/)
  list.reply(() => answer([], { counts: { active: 0, archived: 0 } }))
  list.click('/admin/product/uoms?q=pallet&kind=derived')
  await settled()
  assert.match(list.html(), /&lt;noMatch&gt;/)
  assert.match(
    list.html(),
    /href="\/admin\/product\/uoms"[^>]*>[\s\S]*?&lt;clearFilters&gt;/,
    'clearing starts over',
  )
})

// ── The record modal ───────────────────────────────────────────────────────────

const data = (overrides: Partial<UnitModalData> = {}): UnitModalData => ({
  lang: 'vi',
  editable: true,
  record: { id: 'box', name: 'Hộp 6 chai', referenceId: 'bottle', factor: '0.5', active: true },
  references: [
    { value: 'bottle', label: 'Chai' },
    { value: 'kg', label: 'kg' },
  ],
  usage: { products: 3, packagings: 1, locked: false },
  derived: ['Thùng 24 chai'],
  conversion: { quantity: 6, root: 'Chai' },
  ...overrides,
})

const modal = (
  value: UnitModalData,
  options: { creating?: boolean; state?: Record<string, string> } = {},
): RecordModalContext<UnitModalData> => ({
  kind: 'product.uom',
  id: options.creating ? 'new' : value.record.id,
  creating: options.creating === true,
  tab: '',
  data: value,
  t: (key, params) => (params ? `${key}${JSON.stringify(params)}` : key),
  outcome: () => null,
  fieldError: () => null,
  draft: (_name, fallback = '') => fallback,
  draftChecked: (_name, _value, fallback = false) => fallback,
  busy: false,
  dialog: null,
  href: () => '',
  presentation: 'modal',
  state: (key, fallback = '') => options.state?.[key] ?? fallback,
})

const render = (child: unknown) => renderToString(child as TemplateResult).replace(/<!--[\s\S]*?-->/g, '')

test('unit modal: the form, its facts, and what the save sends', () => {
  const c = modal(data())
  const body = render(uomModalDefinition.body!(c))
  assert.equal(uomModalDefinition.title(c), 'product_backend.uom.editTitle')
  assert.match(body, /name="factor"[^>]*value="0,5"/, 'a Vietnamese reader sees a decimal comma')
  assert.match(body, /product_backend\.uom\.factorHelp\{&quot;reference&quot;:&quot;Chai&quot;\}/)
  assert.doesNotMatch(body, /<span><\/span>/, 'no empty item takes a gap')
  assert.match(body, /product_backend\.uom\.factProducts/)
  assert.match(body, /Thùng 24 chai/)
  assert.doesNotMatch(body, /data-ui="notice"/)
  // A reference unit has no quantity to ask for.
  assert.doesNotMatch(
    render(uomModalDefinition.body!(modal(data(), { state: { referenceId: '' } }))),
    /name="factor"/,
  )

  const form = new FormData()
  form.set('name', ' Hộp 6 ')
  form.set('referenceId', 'bottle')
  form.set('factor', '6')
  assert.deepEqual(uomModalDefinition.commands!.save!.input(form, c, {} as never), {
    id: 'box',
    name: ' Hộp 6 ',
    referenceId: 'bottle',
    factor: '6',
    active: false,
  })
  assert.equal((uomModalDefinition.commands!.save as { route?: string }).route, '/admin/product/uoms/command')
  const fresh = modal(data({ record: { id: '', name: '', referenceId: '', factor: '', active: true } }), {
    creating: true,
  })
  assert.equal(uomModalDefinition.commands!.save!.input(new FormData(), fresh, {} as never).id, null)
  assert.equal(uomModalDefinition.title(fresh), 'product_backend.uom.createTitle')
  assert.doesNotMatch(render(uomModalDefinition.body!(fresh)), /factProducts/, 'a new unit has no facts yet')
})

test('unit modal: Help opens the screen’s guide inside the modal; the way out comes before the command', () => {
  for (const lang of ['vi', 'en'] as const) {
    const c = modal(data({ lang }))
    const body = render(uomModalDefinition.body!(c))
    assert.match(body, /<dialog(?=[^>]*data-ui="help-drawer")(?=[^>]*id="product-uom-record-help")/)
    assert.match(
      body,
      lang === 'vi' ? /Đơn vị tính không chia theo nhóm/ : /Units of measure have no categories/,
    )
    assert.match(body, /data-ui="mermaid/, 'the diagram renders as the DS draws it')
    const actions = render(uomModalDefinition.actions!(c))
    const order = [
      actions.indexOf('data-ui="app-switcher-help"'),
      actions.indexOf('product_backend.uom.cancel'),
      actions.indexOf('type="submit"'),
    ]
    assert.ok(
      order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]!)),
      `Help, then Cancel, then Save: ${order}`,
    )
    assert.match(actions, lang === 'vi' ? /aria-label="Hướng dẫn màn hình"/ : /aria-label="Screen help"/)
    assert.match(actions, /data-variant="secondary"[^>]*>[\s\S]*?product_backend\.uom\.cancel/)
  }
})

test('unit modal: a fixed conversion travels as saved, and a viewer only reads', () => {
  const locked = render(
    uomModalDefinition.body!(modal(data({ usage: { products: 1, packagings: 0, locked: true } }))),
  )
  assert.match(locked, /data-ui="notice"/)
  assert.match(locked, /<input type="hidden" name="referenceId" value="bottle"/)
  assert.match(locked, /<input type="hidden" name="factor" value="0.5"/)
  assert.match(locked, /<select[^>]*name="referenceId"[^>]*disabled/)

  const reader = modal(data({ editable: false }))
  const shown = render(uomModalDefinition.body!(reader))
  assert.doesNotMatch(shown, /<form/)
  assert.match(shown, /data-ui="description-list"/)
  assert.equal(uomModalDefinition.title(reader), 'product_backend.uom.viewTitle')
  assert.doesNotMatch(render(uomModalDefinition.actions!(reader)), /type="submit"/)
})
