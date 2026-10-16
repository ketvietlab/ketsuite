import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, type Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { address, partner } from '@ketvietlab/ketsuite'
import { adminUrl, live } from './postgres-live.ts'

test(
  'partner phone search PostgreSQL: legacy formats, active filter and shared address book',
  live,
  async () => {
    // These producer modules are both dependencies of Cosmetic; never connect to a tenant database.
    const modules = [address, partner]
    const manifest = compose(modules, { headless: true })
    const database = `ket_partner_search_${process.pid}_${Date.now()}`
    const url = new URL(adminUrl)
    url.pathname = `/${database}`
    const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
    const adapter = postgresAdapter(url.toString(), { max: 1 })
    let created = false
    await admin.open()
    try {
      await admin.exec(`CREATE DATABASE "${database}"`)
      created = true
      await adapter.open()
      await migrateOne(adapter, manifest)
      registerFunctions(modules)
      const call = async <T = Row>(name: string, input: Row = {}, company = 'search-test') =>
        (await callFn(name, input, { adapter, manifest, scope: { company, branches: null } })).value as T
      for (const id of ['canonical', 'legacy', 'archived'])
        await call('partner.savePartner', { id, kind: 'person', name: `Test ${id}`, phone: '0909000123' })
      await call(
        'partner.savePartner',
        { id: 'other-company', kind: 'person', name: 'Other customer', phone: '0909000123' },
        'other',
      )
      await adapter.run('UPDATE partner_partner SET phone = $1 WHERE id = $2', ['0909000123', 'legacy'])
      await call('partner.archivePartner', { id: 'archived', active: false })
      for (const search of ['0909000123', '+84909000123', '+84 909 000 123', '0909']) {
        const rows = await call<Row[]>('partner.listPartners', { search, limit: 80 })
        // Partner is shared across companies within a tenant, not company-scoped.
        assert.deepEqual(rows.map((row) => row.id).sort(), ['canonical', 'legacy', 'other-company'], search)
      }
      const otherCompanyRows = await call<Row[]>('partner.listPartners', { search: '0909000123' }, 'other')
      assert.deepEqual(otherCompanyRows.map((row) => row.id).sort(), ['canonical', 'legacy', 'other-company'])
      assert.equal((await call('partner.getPartner', { id: 'legacy' })).phone, '0909000123')
    } finally {
      await adapter.close().catch(() => {})
      try {
        if (created) await admin.exec(`DROP DATABASE "${database}"`)
      } finally {
        await admin.close()
      }
    }
  },
)
