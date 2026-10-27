import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import { atlasFlowCommand, resolveFlowCommand } from '@ketvietlab/flow-client/command-contract.mjs'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { everyFunction } from './helpers/permissions.ts'

// The document Move dialog sends a compatibility action; the native backend has no
// `flow.page.move`. It must arrive as a page save that changes only the parent.
test('moving a document changes its parent through page save and keeps its content', async () => {
  const move = (id: string, parentId: string | null, expectedVersion: number) =>
    resolveFlowCommand('flow.entity.action', {
      collection: 'pages',
      entityId: id,
      action: 'move',
      parentId,
      expectedVersion,
      idempotencyKey: `move-${id}-${expectedVersion}`,
    })
  const resolved = move('doc', 'parent', 3)
  assert.equal(resolved.name, 'flow.page.save')
  assert.deepEqual(resolved.input, {
    id: 'doc',
    parentId: 'parent',
    expectedVersion: 3,
    idempotencyKey: 'move-doc-3',
  })
  // Atlas still receives its own Move action; an ordinary page save stays a save.
  const atlas = atlasFlowCommand(resolved.name, resolved.input)
  assert.equal(atlas.name, 'flow.entity.action')
  assert.equal(atlas.input.action, 'move')
  assert.equal(atlas.input.collection, 'pages')
  assert.equal(
    atlasFlowCommand('flow.page.save', { id: 'doc', parentId: null, title: 'Notes' }).name,
    'flow.entity.save',
  )

  const native = createFlowModule()
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
      ],
      serve: {
        permissions: everyFunction,
        sessions: { anonymous: { company: 'move-flow' } },
        openStore: async (config) => {
          if (!config.databaseUrl) return sqliteStore(config)
          const adapter = postgresAdapter(config.databaseUrl, { max: 2 })
          await adapter.open()
          return adapter
        },
      },
    }),
    {
      worker: false,
      ...(process.env.FLOW_TEST_DATABASE_URL
        ? { env: { DATABASE_URL: process.env.FLOW_TEST_DATABASE_URL } }
        : {}),
    },
  )
  try {
    await app.fixture.call('partner.savePartner', { id: 'move-party', kind: 'company', name: 'Synthetic' })
    await app.fixture.call('company.saveCompany', {
      id: 'move-flow',
      partnerId: 'move-party',
      currency: 'VND',
    })
    await app.fixture.call(
      'user.createUser',
      {
        id: 'mv-owner',
        login: 'mv-owner',
        password: 'local-test-password',
        name: 'Owner',
        email: 'mv-owner@example.test',
        defaultCompanyId: 'move-flow',
      },
      { actor: null },
    )
    await app.fixture.call('user.grantCompany', {
      id: 'mv-owner:move-flow',
      userId: 'mv-owner',
      companyId: 'move-flow',
    })
    await app.fixture.call('user.saveRole', { id: 'move-role', name: 'Move role' })
    for (const key of Object.keys(native.functions))
      if (native.functions[key]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: `move-${key}`,
          roleId: 'move-role',
          fnKey: `flow.${key}`,
        })
    await app.fixture.call('user.assignRole', {
      id: 'mv-owner:flow',
      userId: 'mv-owner',
      roleId: 'move-role',
    })
    await app.client.login({ login: 'mv-owner', password: 'local-test-password' })
    const call = async (name: string, args: Row) => (await app.client.call<Row>(name, args)).value
    const ok = (value: Row) => {
      assert.equal(value.ok, true, JSON.stringify(value))
      return value
    }
    const workspace = ok(
      await call('flow.workspace.create', { title: 'Move', expectedRevision: 0, idempotencyKey: 'ws' }),
    )
    const page = async (text: string, parentId?: string) =>
      ok(
        await call('flow.page.save', {
          workspaceId: workspace.id,
          titleSource: 'content',
          blocks: [
            { id: 'title', type: 'h1', text },
            { id: 'body', type: 'paragraph', text: `${text} body` },
          ],
          ...(parentId ? { parentId } : {}),
          idempotencyKey: 'page-' + text,
        }),
      )
    const first = await page('First'),
      second = await page('Second'),
      child = await page('Child', String(first.id))
    const pages = async () =>
      new Map(
        (
          (await call('flow.workspace.bootstrap', { route: 'pages', workspaceId: workspace.id }))
            .pages as Row[]
        ).map((p) => [String(p.id), p]),
      )
    const send = async (id: string, parentId: string | null, version: number) => {
      const { name, input } = move(id, parentId, version)
      return await call(name, input)
    }

    const moved = ok(await send(String(child.id), String(second.id), Number(child.version)))
    let held = await pages()
    assert.equal(held.get(String(child.id))?.parentId, second.id)
    assert.equal(held.get(String(child.id))?.title, 'Child', 'a move keeps the title')

    // The new parent cannot move under its own descendant.
    const cycle = await send(String(second.id), String(child.id), Number(second.version))
    assert.equal(cycle.ok, false, JSON.stringify(cycle))
    assert.equal((await pages()).get(String(second.id))?.parentId ?? null, null)

    // A stale version is refused instead of silently moving again.
    const stale = await send(String(child.id), String(first.id), Number(child.version))
    assert.equal(stale.ok, false, JSON.stringify(stale))

    ok(await send(String(child.id), null, Number(moved.version)))
    held = await pages()
    assert.equal(held.get(String(child.id))?.parentId ?? null, null, 'null moves to the top level')
    assert.equal(held.get(String(child.id))?.title, 'Child')
  } finally {
    await app.close()
  }
})
