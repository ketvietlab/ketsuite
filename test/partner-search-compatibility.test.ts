import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, tableNameFor, type Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import partner from '../packages/ketsuite/src/modules/partner/index.ts'
import address from '../packages/ketsuite/src/modules/address/index.ts'
import { phoneSearchFragments } from '../packages/ketsuite/src/phone.ts'

test('partner search: canonical and national phone fragments retain legacy compatibility', () => {
  for (const input of ['0909000123', '+84 909 000 123', '0084909000123'])
    assert.deepEqual(phoneSearchFragments(input), ['+84909000123', '0909000123'])
  assert.deepEqual(phoneSearchFragments('0909'), ['+84909', '0909'])
  assert.deepEqual(phoneSearchFragments('580468'), ['580468'])
  assert.deepEqual(phoneSearchFragments('+6591234567'), ['+6591234567'])
  assert.deepEqual(phoneSearchFragments('Customer name'), [])
})

test('partner search: both phone formats find legacy and canonical rows without migration', async (t) => {
  // Focused producer contract for partner/address, both composed by Cosmetic.
  const deployment = defineDeployment({
    name: 'cosmetic',
    companies: true,
    modules: [address, partner],
  })
  const e2e = await createTestDeployment(deployment, { worker: false })
  t.after(() => e2e.close())
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await e2e.fixture.call<T>(name, input, { scope: { company: 'search-test', branches: null } })).value
  for (const id of ['canonical', 'legacy'])
    await call('partner.savePartner', { id, kind: 'person', name: `Test ${id}`, phone: '0909000123' })
  await call('partner.savePartner', {
    id: 'archived',
    kind: 'person',
    name: 'Test archived',
    phone: '0909000123',
  })
  const table = e2e.adapter!.quoteIdent(tableNameFor('partner.Partner'))
  await e2e.adapter!.exec(`UPDATE ${table} SET phone='0909000123' WHERE id='legacy'`)
  await call('partner.archivePartner', { id: 'archived', active: false })
  for (const search of ['0909000123', '+84909000123', '+84 909 000 123', '0909']) {
    const rows = await call<Row[]>('partner.listPartners', { search, limit: 80 })
    assert.deepEqual(rows.map((row) => row.id).sort(), ['canonical', 'legacy'], search)
  }
  const legacy = await call<Row>('partner.getPartner', { id: 'legacy' })
  assert.equal(legacy.phone, '0909000123', 'search never rewrites legacy data')
  assert.deepEqual(
    (await call<Row[]>('partner.listPartners', { search: 'Test legacy' })).map((r) => r.id),
    ['legacy'],
  )
})
