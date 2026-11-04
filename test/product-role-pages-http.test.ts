// Commerce through the job roles a tenant assigns, over real HTTP: every screen a
// role's shell links to opens, and so do the records it lists (a product, its variant,
// a customer). A page that also reads another module's list (units, countries,
// pricelists) the role lacks drops those choices; it never refuses the whole screen.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import type { Row, Scope } from '@ketvietlab/ketjs'
import { commerce } from '../packages/ketsuite/src/deployment.ts'

// Each record, opened when the role's shell links to the list it sits on.
const records = {
  '/admin/product/templates': [
    '/admin/product/templates/serum',
    '/admin/product/templates/serum/variants/serum:default',
  ],
  '/admin/partner/partners': ['/admin/partner/partners/customer'],
}

test('every commerce role opens each screen its shell links to, and the records on them', async (t) => {
  const app = await createTestDeployment(commerce, { worker: false })
  t.after(() => app.close())
  const run = async <T = Row>(fn: string, input: Row, actor: string | null, scope?: Scope) =>
    (await app.fixture.call<T>(fn, input, { actor, ...(scope ? { scope } : {}) })).value
  const tenant = await run<{ ok: boolean; companyId: string; branchId: string; userId: string }>(
    'user.provisionAdmin',
    {
      companyName: 'An Việt',
      companyCode: 'AV',
      currency: 'VND',
      adminLogin: 'owner',
      adminName: 'Owner',
      adminPassword: 'correct horse battery',
    },
    'system:provision',
  )
  assert.equal(tenant.ok, true)
  assert.equal((await run('user.syncRoleTemplates', {}, 'system:role-templates')).ok, true)
  const scope: Scope = { company: tenant.companyId, companies: [tenant.companyId], branch: tenant.branchId }
  const admin = async (fn: string, input: Row) => {
    const row = await run(fn, input, tenant.userId, scope)
    assert.equal(row.ok, true, `${fn}: ${JSON.stringify(row)}`)
  }
  await admin('uom.saveUnit', { id: 'unit', name: 'Chai', relativeFactor: '1' })
  await admin('product.saveTemplate', {
    id: 'serum',
    name: 'Serum B5',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100',
    saleOk: true,
  })
  await admin('partner.savePartner', { id: 'customer', name: 'Spa Hoa Mai', kind: 'company' })

  // Every job role the Commerce deployment ships, as the sync installed them.
  const roles = (await run<Row[]>('user.listRoles', {}, tenant.userId, scope))
    .map((row) => String(row.id))
    .filter((id) => id.startsWith('commerce.'))
  assert.ok(roles.length >= 9, roles.join())
  for (const role of roles) {
    const userId = role.replace('commerce.', '')
    await run(
      'user.createUser',
      { id: userId, login: userId, name: userId, password: 'role-pages-pass' },
      null,
    )
    await admin('user.grantCompany', { id: `${userId}:company`, userId, companyId: tenant.companyId })
    await admin('user.assignRole', { id: `${userId}:${role}`, userId, roleId: role })
    const client = app.client.anonymous().with({ followRedirects: true })
    await client.login({ login: userId, password: 'role-pages-pass' })
    const home = await client.get('/admin')
    const shell = await home.text()
    assert.equal(home.status, 200, `${role} lands somewhere: ${shell.slice(0, 200)}`)
    const links = new Set([...shell.matchAll(/href="(\/admin\/[^"?#]*)/g)].map((match) => match[1]!))
    const permitted = await run<{ functions: Array<{ key: string } | string> }>(
      'user.permitted',
      { userId },
      tenant.userId,
      scope,
    )
    const readsUnits = permitted.functions.some(
      (entry) => (typeof entry === 'string' ? entry : entry.key) === 'uom.listUnits',
    )
    const opened: string[] = []
    const listed = Object.entries(records).flatMap(([list, paths]) => (links.has(list) ? paths : []))
    for (const path of [...links, ...listed]) {
      const response = await client.get(path)
      const body = await response.text()
      if (response.status !== 200 || body.includes('E_FN_NOT_PERMITTED'))
        opened.push(`${path} ${response.status} ${/may not call \\?"([^"\\]+)/.exec(body)?.[1] ?? ''}`)
      // The list bar offers a unit field only with units to choose from.
      if (path === '/admin/product/templates')
        assert.equal(
          body.includes('&quot;value&quot;:&quot;uomId&quot;'),
          readsUnits,
          `${role}: unit field in the list bar`,
        )
    }
    assert.deepEqual(opened, [], `${role} is refused on screens its shell offers`)
  }
})
