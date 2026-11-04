import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { encodeListState } from '@ketvietlab/ketjs'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import type { FilterNode, Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'
import { emptyProductListState } from '../packages/ketsuite/src/modules/product/search.ts'
import type { TagAnswer, TagModalData } from '../packages/ketsuite/src/modules/product_backend/tags/shared.ts'
import type { TemplateModalData } from '../packages/ketsuite/src/modules/product_backend/modal/product-modal-view.tsx'
import { templateModalDefinition } from '../packages/ketsuite/src/modules/product_backend/modal/product-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import type { ProductListAnswer } from '../packages/ketsuite/src/modules/product_backend/list/read.ts'
import type { VariantAnswer } from '../packages/ketsuite/src/modules/product_backend/variants/read.ts'

const rule = (operator = 'equals', value?: string | string[], field = 'tagId'): FilterNode =>
  ({ kind: 'rule', field, operator, ...(value === undefined ? {} : { value }) }) as FilterNode
const href = (filters: FilterNode[] = [], q?: string, page = 1) =>
  encodeListState(
    { ...emptyProductListState(), filters, q, page },
    new URL('http://local/admin/product/templates'),
  )
async function catalogue(t: TestContext) {
  const run = await boot(t)
  for (const [id, name] of [
    ['red', 'Đỏ'],
    ['hot', 'Bán chạy'],
    ['unused', 'Chưa dùng'],
  ])
    await run.save('product.saveTag', { id, name })
  await run.fixture('product.saveTag', { id: 'foreign', name: 'Bán chạy riêng' }, 'other')
  await run.save('product.saveCategory', { id: 'root', name: 'Root' })
  for (const [id, tagIds] of [
    ['a', ['hot', 'red']],
    ['b', ['red']],
    ['c', []],
  ] as const)
    await run.save('product.saveRecord', {
      id,
      name: `Product ${id}`,
      type: 'goods',
      uomId: 'each',
      defaultCode: `TAG${id.toUpperCase()}`,
      categoryId: id === 'a' ? 'root' : null,
      tagIds: [...tagIds],
    })
  return run
}
test('P42 product and SKU tag search preserves scoped compound filters, counts and paging', async (t) => {
  const { app, save, call } = await catalogue(t)
  for (const fn of ['product_backend.searchTemplates', 'stock_backend.searchProductTemplates']) {
    const read = async (filters: FilterNode[], q?: string, page = 1) =>
      (await app.client.call<ProductListAnswer>(fn, { href: href(filters, q, page), pageSize: 1 })).value
    assert.equal((await read([rule('equals', 'red')])).total, 2)
    const filtered = await read([rule('equals', 'root', 'categoryId')], 'Product', 2)
    const redChoice = filtered.tags!.find((tag) => tag.id === 'red')!
    const chosen = (await app.client.call<ProductListAnswer>(fn, { href: redChoice.href })).value
    assert.equal(chosen.total, 1)
    assert.equal(chosen.query.q, 'Product')
    assert.equal(chosen.query.page, 1)
    assert.ok(chosen.tags!.find((tag) => tag.id === 'red')?.active)
    assert.ok(chosen.query.filters.some((node) => node.kind === 'rule' && node.field === 'categoryId'))
    assert.equal((await read([rule('equals', 'red')], undefined, 2)).rows[0]?.id, 'b')
    assert.equal((await read([rule('equals', 'foreign')])).total, 0)
    assert.equal((await read([rule('notEquals', 'red')])).rows[0]?.id, 'c')
    assert.equal((await read([rule('isNotSet')])).rows[0]?.id, 'c')
    assert.equal((await read([rule('isSet')])).total, 2)
    assert.equal(
      (
        await read([
          {
            kind: 'group',
            op: 'and',
            children: [rule('equals', 'red'), rule('equals', 'root', 'categoryId')],
          },
        ])
      ).total,
      1,
    )
    assert.equal(
      (await read([{ kind: 'group', op: 'or', children: [rule('equals', 'hot'), rule('notEquals', 'red')] }]))
        .total,
      2,
    )
    assert.equal((await read([rule('anyOf', ['hot', 'unused'])])).total, 1)
    assert.equal((await read([], 'ban chay')).rows[0]?.id, 'a')
  }
  for (const fn of ['product_backend.searchVariants', 'stock_backend.searchProductVariants']) {
    const read = async (input: Row) => (await app.client.call<VariantAnswer>(fn, input)).value
    const page = await read({ tagId: 'red', pageSize: 1, page: 2 })
    assert.equal(page.total, 2)
    assert.equal(page.rows[0]?.templateId, 'b')
    assert.equal(page.counts.active, 2)
    assert.ok(!page.tags!.some((tag) => tag.id === 'foreign'))
    assert.equal((await read({ tagId: 'foreign' })).total, 0)
    assert.equal((await read({ tagId: 'red', categoryId: 'root' })).total, 1)
    assert.equal((await read({ q: 'ban chay' })).rows[0]?.templateId, 'a')
  }
  const context = (await call('product_backend.tagContext', { id: 'hot' })).data as TagModalData
  const favorite = await call('product_backend.saveSearchFavorite', {
    name: 'Tagged products',
    state: {
      returnTo: '/admin/product/templates',
      facets: [],
      groupBy: [],
      customFilters: [{ id: 'tag', field: 'tagId', operator: 'equals', value: 'hot' }],
    },
  })
  await save('product.saveTag', {
    id: 'hot',
    name: 'Đặc biệt',
    expectedRevisionId: context.record.revisionId,
  })
  const restored = await call('product_backend.applySearchFilter', {
    returnTo: '/admin/product/templates',
    favoriteId: favorite.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  const remembered = (
    await app.client.call<ProductListAnswer>('product_backend.searchTemplates', { href: restored.href })
  ).value
  assert.equal(remembered.total, 1)
  assert.equal(remembered.rows[0]?.id, 'a')
  assert.equal(remembered.tags!.find((tag) => tag.active)?.name, 'Đặc biệt')
  assert.equal(
    (
      await app.client.call<ProductListAnswer>('product_backend.searchTemplates', {
        href: href([], 'dac biet'),
      })
    ).value.total,
    1,
  )
  assert.equal(
    (
      await app.client.call<ProductListAnswer>('product_backend.searchTemplates', {
        href: href([], 'ban chay'),
      })
    ).value.total,
    0,
  )
})
test('P42 tag management and product context retain archived assignments without offering them to new products', async (t) => {
  const { app, call, save } = await catalogue(t)
  let context = (await call('product_backend.tagContext', { id: 'red', locale: 'en' })).data as TagModalData
  assert.equal(context.usage.products, 2)
  assert.equal(context.permissions.edit, true)
  assert.equal(await call('product_backend.tagContext', { id: 'foreign' }), null)
  await save('product.setTagActive', {
    id: 'red',
    active: false,
    expectedRevisionId: context.record.revisionId,
  })
  context = (await call('product_backend.tagContext', { id: 'red' })).data as TagModalData
  assert.equal(context.permissions.edit, false)
  assert.equal(context.permissions.lifecycle, true)
  const read = async (id?: string) =>
    (await call('product.templateModalContext', { ...(id ? { id } : {}), locale: 'en' }))
      .data as TemplateModalData
  const held = await read('a')
  assert.deepEqual(held.record.tagIds, ['hot', 'red'])
  assert.ok(held.tags!.some((tag) => tag.value === 'red'))
  assert.ok(!(await read('c')).tags!.some((tag) => tag.value === 'red'))
  assert.ok(!(await read()).tags!.some((tag) => tag.value === 'red'))
  const duplicate = (await call('product.templateModalContext', { sourceId: 'a' })).data as TemplateModalData
  assert.deepEqual(duplicate.record.tagIds, ['hot', 'red'])
  assert.equal(duplicate.duplicateSourceId, 'a')
  await save('product.saveRecord', {
    id: 'copy',
    name: 'Copy',
    type: 'goods',
    uomId: 'each',
    defaultCode: 'COPY',
    duplicateSourceId: 'a',
    tagIds: duplicate.record.tagIds,
  })
  assert.deepEqual((await call('product.getTemplate', { id: 'copy' })).tagIds, ['hot', 'red'])
  assert.equal(
    (
      await call('product.saveRecord', {
        id: 'foreign-copy',
        name: 'Foreign',
        type: 'goods',
        defaultCode: 'FOREIGN',
        duplicateSourceId: 'foreign',
        tagIds: ['red'],
      })
    ).ok,
    false,
  )
  const result = (
    await app.client.call<TagAnswer>('product_backend.searchTags', {
      href: '/admin/product/tags?status=all&q=do&page=99',
      pageSize: 1,
    })
  ).value
  assert.equal(result.total, 1)
  assert.equal(result.page, 1)
  assert.equal(result.rows[0]?.productCount, 3)
  assert.equal(result.counts.archived, 1)
  assert.match(result.rows[0]?.editHref, /product.tag/)
  assert.equal(
    (
      await app.client.call<ProductListAnswer>('product_backend.searchTemplates', {
        href: href([rule('equals', 'red')]),
      })
    ).value.total,
    3,
  )
  assert.equal(
    (await app.client.call<VariantAnswer>('product_backend.searchVariants', { q: 'do' })).value.total,
    3,
  )
})
test('P42 tag settings and general fields respect the real Commerce accountant role', async (t) => {
  const { app, fixture, call } = await catalogue(t)
  assert.equal(
    (await app.fixture.call<Row>('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })).value.ok,
    true,
  )
  await fixture('user.createUser', {
    id: 'accountant',
    login: 'accountant',
    name: 'Accountant',
    password: 'test-password',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'accountant-acme', userId: 'accountant', companyId: 'acme' })
  await fixture('user.assignRole', {
    id: 'accountant-role',
    userId: 'accountant',
    roleId: 'commerce.accountant',
  })
  await app.client.login({ login: 'accountant', password: 'test-password' })
  const context = (await call('product_backend.tagContext', { id: 'red' })).data as TagModalData
  assert.deepEqual(context.permissions, { edit: false, lifecycle: false })
  assert.equal(await call('product_backend.tagContext', {}), null)
  assert.equal((await call('product.templateModalContext', { id: 'a' })).data != null, true)
  await assert.rejects(() => call('product.saveTag', { id: 'red', name: 'Forged' }), { status: 403 })
  await assert.rejects(
    () =>
      call('product.setTagActive', {
        id: 'red',
        active: false,
        expectedRevisionId: context.record.revisionId,
      }),
    { status: 403 },
  )
})

test('P42 product multi-select submits the complete refused draft and omits locked general tags', async (t) => {
  const { call } = await catalogue(t)
  const data = (await call('product.templateModalContext', { id: 'a', locale: 'en' }))
    .data as TemplateModalData
  const context: RecordModalContext<TemplateModalData> = {
    id: 'a',
    kind: 'product.template',
    creating: false,
    tab: '',
    data,
    t: (key) => key,
    outcome: () => null,
    fieldError: (name) => (name === 'tagIds' ? 'Too many tags' : null),
    draft: (_name, fallback = '') => fallback,
    draftChecked: (_name, _value, fallback = false) => fallback,
    busy: false,
    dialog: null,
    href: () => '',
    state: (_key, fallback = '') => fallback,
  }
  const html = renderToString(templateModalDefinition.body!(context) as TemplateResult)
  assert.match(
    html,
    /data-ui="field"(?=[^>]*data-layout="inline")[^>]*>(?:(?!data-ui="field")[\s\S])*?product-record-tagIds/,
  )
  assert.match(html, /Too many tags/)
  const form = new FormData()
  form.set('name', 'Product a')
  const draft = Array.from({ length: 11 }, (_, i) => `tag-${i}`)
  form.set('tagIds', draft.join(','))
  const input = templateModalDefinition.commands!.save!.input!(form, context, {}) as Row
  assert.deepEqual(input.tagIds, draft)
  const locked = { ...context, data: { ...data, permissions: { ...data.permissions, save: false } } }
  const permitted = templateModalDefinition.commands!.save!.input!(form, locked, {}) as Row
  assert.equal(Object.hasOwn(permitted, 'tagIds'), false)
})
