import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import {
  collectionSearchFunction,
  hospitalityCollections,
  projectHospitalityCollectionRow,
  stayRowProjection,
} from '../packages/ketsuite/src/modules/hospitality_core/functions/collection-search.ts'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true, companies: true })

// The reservation book and the in-house list have their own reads and rows (hospitality-reservation-book.test.ts,
// hospitality-stay-book.test.ts); the front desk's stay rows share this projection.
test('Hospitality list DTOs do not expose related contact details, credentials, or internal stay notes', () => {
  const definition = stayRowProjection
  const projected = projectHospitalityCollectionRow(
    {
      id: 'stay',
      code: 'S-001',
      departureNotes: 'private note',
      departedBy: 'internal-user',
      partner: {
        id: 'guest',
        name: 'Synthetic Guest',
        phone: 'not-for-list',
        email: 'private@example.invalid',
        passwordHash: 'not-a-real-hash',
      },
      roomType: { id: 'room-type', name: 'Deluxe' },
    },
    definition,
  )
  assert.equal(projected.id, 'stay')
  assert.equal(projected.departureNotes, undefined)
  assert.equal(projected.departedBy, undefined)
  assert.deepEqual(projected.partner, { id: 'guest', name: 'Synthetic Guest' })
  assert.deepEqual(projected.roomType, { id: 'room-type', name: 'Deluxe' })
})
const scope = { company: 'hotel-company', branches: null }
type Page = {
  query: Record<string, unknown>
  total: number
  page: number
  pages: number
  rows: Array<Record<string, unknown>>
  counts: { state: Record<string, number> }
  isEmpty: boolean
}
async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  for (const companyId of [scope.company, 'another-company']) {
    const selected = { company: companyId, branches: null }
    const party = await callFn(
      'partner.savePartner',
      { id: `${companyId}-party`, kind: 'company', name: companyId },
      { adapter, manifest, scope: selected },
    )
    assert.notEqual((party.value as { ok?: boolean }).ok, false)
    const company = await callFn(
      'company.saveCompany',
      { id: companyId, partnerId: `${companyId}-party`, currency: 'VND' },
      { adapter, manifest, scope: selected },
    )
    assert.notEqual((company.value as { ok?: boolean }).ok, false)
  }
  return adapter
}
async function call(
  adapter: Adapter,
  name: string,
  input: Record<string, unknown>,
  companyId = scope.company,
) {
  return (
    await callFn(`hospitality_core.${name}`, input, {
      adapter,
      manifest,
      scope: { ...scope, company: companyId },
    })
  ).value
}
async function property(adapter: Adapter, id: string, name: string, companyId?: string) {
  await call(
    adapter,
    'saveProperty',
    { id, code: id, name, accommodationType: 'hotel', timezone: 'Asia/Ho_Chi_Minh' },
    companyId,
  )
}

test('Hospitality collection reads return bounded stable pages, clamp old URLs, and preserve company isolation', async () => {
  const adapter = await boot()
  try {
    for (let i = 0; i < 106; i++)
      await property(adapter, `p-${String(i).padStart(3, '0')}`, `Hotel ${String(i).padStart(3, '0')}`)
    await property(adapter, 'foreign', 'Hotel 000 private', 'another-company')
    const scoped = (
      await callFn(
        'hospitality_core.searchProperties',
        {},
        {
          adapter,
          manifest,
          scope: { company: scope.company, companies: [scope.company, 'another-company'], branches: null },
        },
      )
    ).value as Page
    assert.equal(
      scoped.rows.some((row) => row.id === 'foreign'),
      false,
      'allowed companies do not override the active company',
    )
    const first = (await call(adapter, 'searchProperties', { page: 1, pageSize: 1000 })) as Page
    assert.equal(first.rows.length, 100)
    assert.equal(first.query.pageSize, 100)
    assert.equal(first.total, 106)
    assert.equal(first.isEmpty, false)
    assert.equal(
      first.rows.some((row) => row.id === 'foreign'),
      false,
    )
    const last = (await call(adapter, 'searchProperties', { page: 999, pageSize: 25 })) as Page
    assert.equal(last.page, 5)
    assert.equal(last.pages, 5)
    assert.equal(last.rows.length, 6)
    assert.equal(last.query.page, 5)
    assert.deepEqual(
      last.rows.map((row) => row.id),
      ['p-100', 'p-101', 'p-102', 'p-103', 'p-104', 'p-105'],
    )
    const reverse = (await call(adapter, 'searchProperties', {
      pageSize: 3,
      direction: 'desc',
      sort: 'name',
    })) as Page
    assert.deepEqual(
      reverse.rows.map((row) => row.id),
      ['p-105', 'p-104', 'p-103'],
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality collection search treats wildcard text literally and distinguishes filtered empty from first use', async () => {
  const adapter = await boot()
  try {
    await property(adapter, 'literal', '100%_Hotel')
    await property(adapter, 'ordinary', '1000Hotel')
    const found = (await call(adapter, 'searchProperties', { q: '%_' })) as Page
    assert.deepEqual(
      found.rows.map((row) => row.id),
      ['literal'],
    )
    const filtered = (await call(adapter, 'searchProperties', { q: 'not a hotel' })) as Page
    assert.equal(filtered.total, 0)
    assert.equal(filtered.isEmpty, false)
    assert.deepEqual(filtered.rows, [])
    const empty = (await call(adapter, 'searchProperties', {}, 'empty-company')) as Page
    assert.equal(empty.total, 0)
    assert.equal(empty.isEmpty, true)
    const normalized = (await call(adapter, 'searchProperties', {
      sort: 'unknown',
      state: 'unknown',
      direction: 'unknown',
      page: -1,
      pageSize: 0,
    })) as Page
    assert.equal(normalized.query.sort, 'name')
    assert.equal(normalized.query.state, 'all')
    assert.equal(normalized.query.direction, 'asc')
    assert.equal(normalized.query.page, 1)
    assert.equal(normalized.query.pageSize, 25)
  } finally {
    await adapter.close()
  }
})

test('Every Hospitality collection descriptor reads its real model and finite facet vocabulary', async () => {
  const adapter = await boot()
  try {
    for (const definition of hospitalityCollections) {
      const value = (await call(adapter, definition.name, {})) as Page
      assert.equal(value.total, 0, definition.name)
      assert.deepEqual(Object.keys(value.counts.state).sort(), [...definition.states].sort(), definition.name)
      assert.ok(value.rows.length <= 100, definition.name)
    }
  } finally {
    await adapter.close()
  }
})

test('Hospitality priority queues page grouped states globally with stable ties and an unknown-state tail', async () => {
  const probe = defineModule({
    name: 'hospitality_queue_probe',
    depends: ['hospitality_core'],
    functions: {
      search: collectionSearchFunction({
        name: 'search',
        model: 'hospitality_core.Property',
        fields: ['id', 'name', 'lifecycle'],
        search: ['name'],
        sort: ['attention', 'name'],
        defaultSort: 'attention',
        state: 'lifecycle',
        states: ['all', 'review', 'active'],
        stateGroups: { review: ['draft', 'stopped'] },
        stateAliases: { draft: 'review' },
        prioritySort: { name: 'attention', groups: [['draft'], ['draft', 'active']], within: 'name' },
      }),
    },
  })
  const queueModules = [...modules, probe]
  const queueManifest = compose(queueModules, { headless: true, companies: true })
  const adapter = await boot()
  registerFunctions(queueModules)
  const search = async (args: Record<string, unknown>) =>
    (await callFn('hospitality_queue_probe.search', args, { adapter, manifest: queueManifest, scope }))
      .value as Page
  try {
    for (let index = 0; index < 8; index++) {
      const id = `queue-${index}`
      await property(adapter, id, 'Queue')
      await adapter.run('UPDATE hospitality_core_property SET lifecycle = ? WHERE id = ?', [
        index < 3 ? 'draft' : index < 6 ? 'active' : 'stopped',
        id,
      ])
    }
    await property(adapter, 'foreign-queue', 'Queue', 'another-company')
    const first = await search({ pageSize: 4 })
    assert.deepEqual(
      first.rows.map((row) => row.id),
      ['queue-0', 'queue-1', 'queue-2', 'queue-3'],
    )
    assert.deepEqual(first.counts.state, { all: 8, review: 5, active: 3 })
    const second = await search({ pageSize: 4, page: 2 })
    assert.deepEqual(
      second.rows.map((row) => row.id),
      ['queue-4', 'queue-5', 'queue-6', 'queue-7'],
    )
    assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, 8)
    assert.deepEqual(
      (await search({ state: 'draft', pageSize: 4, page: 2 })).rows.map((row) => row.id),
      ['queue-7'],
    )
    assert.equal((await search({ state: 'draft' })).query.state, 'review')
    assert.deepEqual(
      (await search({ direction: 'desc', pageSize: 3 })).rows.map((row) => row.id),
      ['queue-6', 'queue-7', 'queue-3'],
    )
    assert.equal((await search({ page: 999, pageSize: 3 })).page, 3)
    assert.equal((await search({ q: 'missing' })).total, 0)
  } finally {
    await adapter.close()
  }
})
