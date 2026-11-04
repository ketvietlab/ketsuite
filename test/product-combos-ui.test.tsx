import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { boot } from './fixtures/sale/commerce.ts'
import type {
  ComboAnswer,
  ComboModalData,
} from '../packages/ketsuite/src/modules/product_backend/combos/shared.ts'
import { postedComboItems } from '../packages/ketsuite/src/modules/product_backend/combos/item-draft.ts'
import {
  comboGridConfig,
  comboModalDefinition as definition,
} from '../packages/ketsuite/src/modules/product_backend/modal/combo-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'

const held = [
  { id: 'one', productId: 'p1', extraPrice: '0' },
  { id: 'two', productId: 'p2', extraPrice: '5' },
]
test('P44 grid draft preserves exact prices and order and refuses inconsistent structures', () => {
  assert.deepEqual(
    postedComboItems(held, ''),
    held.map(({ productId, extraPrice }) => ({ productId, extraPrice })),
  )
  const changes = {
    removed: ['one'],
    updated: [{ id: 'two', values: { extraPrice: '0009' } }],
    added: [{ id: 'new', values: { productId: 'p3', extraPrice: ' 1.2 ' } }],
    order: ['new', 'two'],
  }
  assert.deepEqual(postedComboItems(held, JSON.stringify(changes)), [
    { productId: 'p3', extraPrice: ' 1.2 ' },
    { productId: 'p2', extraPrice: '0009' },
  ])
  for (const raw of [
    'no json',
    '[]',
    JSON.stringify({ order: ['one', 'one'] }),
    JSON.stringify({ order: ['one'] }),
    JSON.stringify({ removed: ['foreign'] }),
    JSON.stringify({ updated: [{ id: 'foreign', values: {} }] }),
    JSON.stringify({ added: [{ id: 'one', values: {} }] }),
    JSON.stringify({ added: 'wrong' }),
  ])
    assert.equal(postedComboItems(held, raw), null)
})

test('P44 modal keeps raw name/grid refusals and revision; read-only grid and lifecycle have separate contracts', () => {
  const draft = JSON.stringify({ updated: [{ id: 'one', values: { extraPrice: 'bad' } }] })
  const data: ComboModalData = {
    lang: 'en',
    record: { id: 'choice', name: 'Choice', revisionId: 'r1', active: true, items: held },
    choices: [
      { value: 'p1', label: 'Item one' },
      { value: 'p2', label: 'Item two' },
    ],
    permissions: { edit: true, lifecycle: true },
    usage: { products: 0, names: [] },
  }
  const c: RecordModalContext<ComboModalData> = {
    id: 'choice',
    kind: 'product.combo',
    creating: false,
    tab: '',
    data,
    t: (key) => key,
    outcome: () => null,
    fieldError: (name) =>
      name === 'items' ? 'Invalid item price' : name === 'expectedRevisionId' ? 'Reload first' : null,
    draft: (name, fallback = '') => (name === 'name' ? '  raw name  ' : name === 'items' ? draft : fallback),
    draftChecked: (_name, _value, fallback = false) => fallback,
    busy: false,
    dialog: null,
    href: () => '',
    state: (_key, fallback = '') => fallback,
  }
  const html = renderToString(definition.body!(c) as TemplateResult)
  assert.ok(html.includes('value="  raw name  "'))
  assert.match(html, /Invalid item price/)
  assert.match(html, /Reload first/)
  assert.equal(comboGridConfig(c).carry, draft)
  assert.equal(
    comboGridConfig({ ...c, draft: (_name, fallback = '') => fallback }).carry,
    JSON.stringify({ added: [], updated: [], removed: [], order: null }),
  )
  const form = new FormData()
  form.set('name', '  raw name  ')
  form.set('items', draft)
  assert.deepEqual(definition.commands!.save!.input!(form, c, {}), {
    id: 'choice',
    name: '  raw name  ',
    expectedRevisionId: 'r1',
    items: [
      { productId: 'p1', extraPrice: 'bad' },
      { productId: 'p2', extraPrice: '5' },
    ],
  })
  assert.deepEqual(definition.commands!.archive!.input!(new FormData(), c, {}), {
    id: 'choice',
    active: false,
    expectedRevisionId: 'r1',
  })
  c.data = { ...data, permissions: { edit: false, lifecycle: false } }
  assert.equal(comboGridConfig(c).readOnly, true)
  for (const key of ['name', 'form', 'carry', 'newRow', 'removable', 'reorderable'])
    assert.equal(Object.hasOwn(comboGridConfig(c), key), false, key)
  assert.equal(comboGridConfig(c).labels?.instructions, 'product_backend.combo.readOnlyInstructions')
  assert.doesNotMatch(
    renderToString(definition.actions!(c) as TemplateResult),
    /type="submit"|combo\.archive/,
  )
})

test('P44 paged reads, held SKU choices and role context use the real scoped Commerce catalogue', async (t) => {
  const run = await boot(t)
  for (const id of ['one', 'two'])
    await run.save('product.saveRecord', {
      id,
      name: id,
      type: 'goods',
      defaultCode: id.toUpperCase(),
      uomId: 'each',
    })
  await run.save('product.saveCombo', {
    id: 'choice',
    name: 'Dưỡng ẩm',
    items: [
      { productId: 'one:default', extraPrice: '0' },
      { productId: 'two:default', extraPrice: '60000' },
    ],
  })
  await run.save('product.saveCombo', {
    id: 'second',
    name: 'Second',
    items: [{ productId: 'two:default', extraPrice: '0' }],
  })
  const query = async (href: string) =>
    (await run.app.client.call<ComboAnswer>('product_backend.searchCombos', { href })).value
  const matched = await query('/admin/product/combos?q=duong&page=99&pageSize=1')
  assert.equal(matched.total, 1)
  assert.equal(matched.page, 1)
  assert.equal(matched.rows[0]?.itemCount, 2)
  assert.match(matched.rows[0]?.editHref ?? '', /record=product.combo/)
  assert.equal((await query('/admin/product/combos?sort=items&pageSize=1')).rows[0]?.id, 'second')
  const context = async (id?: string) =>
    (await run.call('product_backend.comboContext', { ...(id ? { id } : {}), locale: 'en' }))
      .data as ComboModalData
  let data = await context('choice')
  assert.equal(data.record.items[1]?.extraPrice, '60000')
  assert.equal(data.permissions.edit, true)
  assert.equal(await run.call('product_backend.comboContext', { id: 'foreign' }), null)
  const template = await run.call('product.getTemplate', { id: 'one' })
  await run.save('product.archiveTemplate', {
    id: 'one',
    active: false,
    reason: 'Discontinued',
    confirmed: true,
    expectedRevisionId: template.revisionId,
  })
  data = await context('choice')
  assert.ok(data.choices.some((choice) => choice.value === 'one:default'))
  assert.ok(!(await context()).choices.some((choice) => choice.value === 'one:default'))
  await run.save('product.setComboActive', {
    id: 'choice',
    active: false,
    expectedRevisionId: data.record.revisionId,
  })
  assert.equal((await context('choice')).permissions.edit, false)
  assert.equal((await query('/admin/product/combos?status=archived')).total, 1)
  await run.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await run.fixture('user.createUser', {
    id: 'accountant',
    login: 'accountant',
    password: 'test-password',
    name: 'Accountant',
    defaultCompanyId: 'acme',
  })
  await run.fixture('user.grantCompany', {
    id: 'accountant-company',
    userId: 'accountant',
    companyId: 'acme',
  })
  await run.fixture('user.assignRole', {
    id: 'accountant-role',
    userId: 'accountant',
    roleId: 'commerce.accountant',
  })
  await run.app.client.login({ login: 'accountant', password: 'test-password' })
  assert.equal(await run.call('product_backend.comboContext', {}), null)
  data = await context('second')
  assert.equal(data.permissions.edit, false)
  assert.equal(data.permissions.lifecycle, false)
  assert.equal((await query('/admin/product/combos')).total, 1)
})
