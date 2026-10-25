import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import {
  address,
  company,
  createStaffChannelApi,
  createNativeFlowStaffChannel,
  livedoc,
  mail,
  openApiDocument,
  partner,
  user,
  userBackend,
} from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { refuse } from '../packages/ketsuite/src/modules/flow/native/policy.ts'
import { everyFunction } from './helpers/permissions.ts'

test('productivity native staff v2 forwards scope, CAS, replay, field validation and extension guards', async () => {
  let blocked = false
  const native = createFlowModule({
    extensions: [
      {
        name: 'staff-transition-guard',
        effects: [],
        beforeMutation: async (_ctx, mutation) => {
          if (blocked && mutation.name === 'flow.issue.move') refuse('blocked')
        },
      },
    ],
  })
  const app = await createTestDeployment(
    defineDeployment({
      name: 'productivity',
      companies: true,
      modules: [
        address,
        partner,
        company,
        user,
        userBackend,
        backend,
        mail,
        livedoc,
        createFlowStorageModule(),
        native,
        createStaffChannelApi(),
        createNativeFlowStaffChannel(),
      ],
      serve: { permissions: everyFunction, sessions: { anonymous: { company: 'staff-flow' } } },
    }),
    { worker: false },
  )
  const fixture = async (name: string, input: Row, actor: string | null = null) =>
    (await app.fixture.call<Row>(name, input, { actor, scope: { company: 'staff-flow', branches: null } }))
      .value
  const ok = (value: Row) => {
    assert.equal(value.ok, true, JSON.stringify(value))
    return value
  }
  try {
    await fixture('partner.savePartner', { id: 'staff-party', kind: 'company', name: 'Synthetic staff' })
    await fixture('company.saveCompany', { id: 'staff-flow', partnerId: 'staff-party', currency: 'VND' })
    for (const [id, superuser] of [
      ['staff-owner', true],
      ['staff-outsider', false],
    ] as const) {
      ok(
        await fixture('user.createUser', {
          id,
          login: id,
          name: id,
          password: 'synthetic-staff-password',
          superuser,
          defaultCompanyId: 'staff-flow',
        }),
      )
      ok(
        await fixture(
          'user.grantCompany',
          { id: id + ':company', userId: id, companyId: 'staff-flow' },
          'staff-owner',
        ),
      )
    }
    await fixture(
      'user.saveRole',
      { id: 'staff-technical', name: 'Synthetic technical access' },
      'staff-owner',
    )
    for (const key of Object.keys(native.functions!))
      await fixture(
        'user.grantFunction',
        { id: 'staff:' + key, roleId: 'staff-technical', fnKey: 'flow.' + key },
        'staff-owner',
      )
    await fixture(
      'user.assignRole',
      { id: 'outsider-role', userId: 'staff-outsider', roleId: 'staff-technical' },
      'staff-owner',
    )
    await app.client.login({ login: 'staff-owner', password: 'synthetic-staff-password' })
    const call = async (name: string, input: Row) => (await app.client.call<Row>(name, input)).value
    const context = () => call('flow.workspace.bootstrap', { route: 'settings' })
    const workspace = ok(
      await call('flow.workspace.create', {
        title: 'Staff workspace',
        access: 'restricted',
        expectedRevision: 0,
        idempotencyKey: 'workspace',
      }),
    )
    const project = ok(
      await call('flow.project.save', {
        workspaceId: workspace.id,
        title: 'A staff project',
        code: 'STF',
        access: 'private',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'project',
      }),
    )
    const second = ok(
      await call('flow.project.save', {
        workspaceId: workspace.id,
        title: 'B staff project',
        code: 'ST2',
        access: 'private',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'project2',
      }),
    )
    const boot = await context()
    const column = (boot.columns as Row[])[0]!.id
    const task = ok(
      await call('flow.issue.save', {
        projectId: project.id,
        title: 'Native staff task',
        idempotencyKey: 'task',
      }),
    )
    task.version = ((await call('flow.issue.detail', { id: task.id })).task as Row).version
    const root = '/api/staff/v1/flow/v2'
    const csrf = String((await app.client.json<{ data: Row }>('/api/staff/v1/bootstrap')).data.csrfToken)
    const post = async (path: string, key: string, input: Row) =>
      app.client.request(root + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
          'idempotency-key': 'native-staff-' + key,
        },
        body: JSON.stringify(input),
      })
    const page = (await app.client.json<{ data: Row }>(root + '/projects?limit=1')).data
    assert.equal(page.total, 2)
    assert.equal((page.items as Row[]).length, 1)
    assert.ok(page.cursor)
    const next = (
      await app.client.json<{ data: Row }>(
        root + '/projects?limit=1&cursor=' + encodeURIComponent(String(page.cursor)),
      )
    ).data
    assert.equal((next.items as Row[])[0]!.id, second.id)
    const list = (await app.client.json<{ data: Row }>(root + '/issues?projectId=' + project.id)).data
    assert.equal(list.total, 1)
    assert.equal((list.items as Row[])[0]!.id, task.id)
    assert.equal((await app.client.get(root + '/issues/' + task.id)).status, 200)
    const noCsrf = await app.client.request(root + '/issues/' + task.id + '/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'no-csrf' },
      body: JSON.stringify({ columnId: column, expectedVersion: task.version }),
    })
    assert.equal(noCsrf.status, 403)
    blocked = true
    const refusedMove = await post('/issues/' + task.id + '/move', 'blocked', {
      columnId: column,
      expectedVersion: task.version,
    })
    assert.equal(refusedMove.status, 422, await refusedMove.text())
    blocked = false
    const input = { columnId: column, expectedVersion: task.version }
    const moved = await post('/issues/' + task.id + '/move', 'move', input)
    assert.equal(moved.status, 200)
    const movedData = JSON.parse(await moved.text()).data
    assert.equal(movedData.title, 'Native staff task')
    const replay = await post('/issues/' + task.id + '/move', 'move', input)
    assert.deepEqual(JSON.parse(await replay.text()).data, movedData)
    assert.equal((await post('/issues/' + task.id + '/move', 'stale', input)).status, 409)
    assert.equal(
      (
        await post('/issues/' + task.id + '/assign', 'invalid-assignee', {
          assigneeIds: ['staff-outsider'],
          expectedVersion: 2,
        })
      ).status,
      422,
    )
    const comment = await post('/issues/' + task.id + '/comment', 'comment', { text: 'Actual staff comment' })
    assert.equal(comment.status, 200)
    assert.deepEqual(
      JSON.parse(
        await (
          await post('/issues/' + task.id + '/comment', 'comment', { text: 'Actual staff comment' })
        ).text(),
      ).data,
      JSON.parse(await comment.text()).data,
    )
    ok(
      await call('flow.project.save', {
        id: second.id,
        title: 'Renamed project',
        expectedVersion: second.version,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'rename',
      }),
    )
    assert.equal(
      (await app.client.get(root + '/projects?cursor=' + encodeURIComponent(String(page.cursor)))).status,
      409,
    )
    const outsider = app.client.anonymous()
    await outsider.login({ login: 'staff-outsider', password: 'synthetic-staff-password' })
    assert.deepEqual((await outsider.json<{ data: Row }>(root + '/projects')).data.items, [])
    assert.equal((await outsider.get(root + '/issues?projectId=' + project.id)).status, 403)
    assert.equal((await outsider.get(root + '/issues/' + task.id)).status, 403)
    assert.equal((await app.client.anonymous().get(root + '/issues')).status, 401)
    assert.equal(
      (await app.client.get('/api/customer/v1/account')).status,
      404,
      'staff-only composition exposes no customer API',
    )
  } finally {
    await app.close()
  }
})

test('productivity native staff v2 publishes a typed data envelope for every success', () => {
  const modules = [address, partner, company, user, userBackend, backend, mail, livedoc]
  const flow = [
    createFlowStorageModule(),
    createFlowModule(),
    createStaffChannelApi(),
    createNativeFlowStaffChannel(),
  ]
  const document = openApiDocument(
    compose([...modules, ...flow], { headless: true, companies: true }),
    'staff',
  )
  const operations = Object.entries(document.paths)
    .filter(([path]) => path.startsWith('/flow/v2/'))
    .flatMap(([path, entry]) =>
      Object.entries(entry as Record<string, Row>).map(([method, op]) => [`${method} ${path}`, op] as const),
    )
  assert.ok(operations.length > 0)
  for (const [name, operation] of operations) {
    const success = (operation.responses as Record<string, Row>)['200']
    const schema = ((success.content as Row)['application/json'] as Row).schema as Row
    assert.equal(schema.type, 'object', name)
    assert.ok((schema.properties as Row).data, `${name} has no data envelope`)
    // Generated clients need item types; an untyped array cannot be decoded.
    const untyped = JSON.stringify(schema).match(/\{"type":"array"\}/u)
    assert.equal(untyped, null, `${name} has an array without item schema`)
  }
})
