import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { encodeListState } from '@ketvietlab/ketjs'
import type { FilterNode, Row } from '@ketvietlab/ketjs'
import { emptyProductListState } from '../packages/ketsuite/src/modules/product/search.ts'
import { boot } from './fixtures/sale/commerce.ts'
import { categoryDescendants } from '../packages/ketsuite/src/modules/product/category-tree.ts'
import type { ProductListAnswer } from '../packages/ketsuite/src/modules/product_backend/list/read.ts'
import type { VariantAnswer } from '../packages/ketsuite/src/modules/product_backend/variants/read.ts'

const equals = (value: string): FilterNode => ({
  kind: 'rule',
  field: 'categoryId',
  operator: 'equals',
  value,
})
const href = (filters: FilterNode[], page = 1) =>
  encodeListState(
    { ...emptyProductListState(), filters, page },
    new URL('http://local/admin/product/templates'),
  )
async function catalogue(t: TestContext) {
  const run = await boot(t)
  for (const [id, parentId] of [
    ['root', null],
    ['child', 'root'],
    ['leaf', 'child'],
    ['other', null],
  ] as const)
    await run.save('product.saveCategory', { id, name: id, parentId })
  for (const [id, categoryId] of [
    ['a', 'root'],
    ['b', 'child'],
    ['c', 'leaf'],
    ['d', 'other'],
  ])
    await run.save('product.saveRecord', {
      id,
      name: id,
      defaultCode: `P${id!.toUpperCase()}`,
      type: 'goods',
      uomId: 'each',
      categoryId,
      saleOk: true,
    })
  const templates = async (filters: FilterNode[], extra: Row = {}, fn = 'product_backend.searchTemplates') =>
    (await run.call(fn, { href: href(filters), ...extra })) as unknown as ProductListAnswer
  const variants = async (categoryId: string, extra: Row = {}, fn = 'product_backend.searchVariants') =>
    (await run.call(fn, { categoryId, ...extra })) as unknown as VariantAnswer
  return { ...run, templates, variants }
}

test('P40 template and variant collections include descendants with correct counts and paging', async (t) => {
  const { templates, variants } = await catalogue(t)
  for (const fn of ['product_backend.searchTemplates', 'stock_backend.searchProductTemplates']) {
    const first = await templates([equals('root')], { pageSize: 2 }, fn)
    assert.equal(first.total, 3)
    assert.deepEqual(
      first.rows.map((r) => r.id),
      ['a', 'b'],
    )
    assert.deepEqual(
      first.query.filters,
      [equals('root')],
      'expanded IDs must not replace the saved filter or URL state',
    )
    const second = await templates([equals('root')], { pageSize: 2, href: href([equals('root')], 2) }, fn)
    assert.deepEqual(
      second.rows.map((r) => r.id),
      ['c'],
    )
  }
  for (const fn of ['product_backend.searchVariants', 'stock_backend.searchProductVariants']) {
    const rows = await variants('root', { pageSize: 2 }, fn)
    assert.equal(rows.total, 3)
    assert.equal(rows.rows.length, 2)
    const next = await variants('root', { page: 2, pageSize: 2 }, fn)
    assert.deepEqual(
      next.rows.map((r) => r.templateId),
      ['c'],
    )
  }
})

test('P40 category predicates retain nested AND/OR, anyOf and exclusion semantics', async (t) => {
  const { templates } = await catalogue(t)
  const selected = await templates([
    { kind: 'rule', field: 'categoryId', operator: 'anyOf', value: ['child', 'other'] },
  ])
  assert.deepEqual(
    selected.rows.map((r) => r.id),
    ['b', 'c', 'd'],
  )
  const nested = await templates([
    {
      kind: 'group',
      op: 'or',
      children: [equals('child'), { kind: 'rule', field: 'name', operator: 'equals', value: 'd' }],
    },
  ])
  assert.deepEqual(
    nested.rows.map((r) => r.id),
    ['b', 'c', 'd'],
  )
  const excluded = await templates([
    { kind: 'rule', field: 'categoryId', operator: 'notEquals', value: 'child' },
  ])
  assert.deepEqual(
    excluded.rows.map((r) => r.id),
    ['a', 'd'],
  )
  const intersected = await templates([
    equals('root'),
    { kind: 'rule', field: 'name', operator: 'equals', value: 'c' },
  ])
  assert.deepEqual(
    intersected.rows.map((r) => r.id),
    ['c'],
  )
})

test('P40 saved category IDs follow rename and reparent without retaining a stale descendant set', async (t) => {
  const { templates, variants, save } = await catalogue(t)
  const saved = href([equals('root')])
  await save('product.saveCategory', { id: 'child', name: 'Renamed', parentId: 'root' })
  assert.equal((await templates([], { href: saved })).total, 3)
  await save('product.saveCategory', { id: 'child', name: 'Renamed', parentId: 'other' })
  assert.deepEqual(
    (await templates([], { href: saved })).rows.map((r) => r.id),
    ['a'],
  )
  assert.deepEqual(
    (await templates([equals('other')])).rows.map((r) => r.id),
    ['b', 'c', 'd'],
  )
  assert.equal((await variants('root')).total, 1)
  assert.equal((await variants('other')).total, 3)
})

test('P40 unknown or foreign category filters cannot expose another company catalogue', async (t) => {
  const { templates, variants, fixture } = await catalogue(t)
  await fixture('product.saveCategory', { id: 'foreign', name: 'Foreign' }, 'other')
  await fixture('uom.saveUnit', { id: 'foreign-each', name: 'Each', relativeFactor: '1' }, 'other')
  const foreign = await fixture(
    'product.saveRecord',
    {
      id: 'foreign-product',
      name: 'Foreign product',
      defaultCode: 'FOREIGN',
      type: 'goods',
      uomId: 'foreign-each',
      categoryId: 'foreign',
    },
    'other',
  )
  assert.equal(foreign.ok, true)
  for (const id of ['missing', 'foreign']) {
    assert.equal((await templates([equals(id)])).total, 0)
    assert.equal((await variants(id)).total, 0)
  }
  assert.equal((await templates([equals('root')])).total, 3)
})

test('P40 large subtrees do not consume the user filter-rule budget', async (t) => {
  const { templates, save } = await catalogue(t)
  for (let n = 0; n < 30; n++)
    await save('product.saveCategory', { id: `extra-${n}`, name: `Extra ${n}`, parentId: 'root' })
  assert.equal((await templates([equals('root')])).total, 3)
  assert.deepEqual(
    (await templates([{ kind: 'rule', field: 'categoryId', operator: 'notEquals', value: 'root' }])).rows.map(
      (r) => r.id,
    ),
    ['d'],
  )
})

test('Category traversal deduplicates overlapping roots and terminates on legacy cycles', () => {
  const rows = [
    { id: 'root', parentId: 'leaf' },
    { id: 'child', parentId: 'root' },
    { id: 'leaf', parentId: 'child' },
    { id: 'other', parentId: null },
  ]
  assert.deepEqual([...categoryDescendants(rows, ['root', 'child'])].sort(), ['child', 'leaf', 'root'])
  assert.deepEqual([...categoryDescendants(rows, ['missing'])], ['missing'])
})
