import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { createFlowWorkspaceModule } from '../packages/ketsuite/src/modules/flow_workspace/index.ts'
import { everyFunction } from './helpers/permissions.ts'

// Commands no other test calls: each refuses a person without the right and leaves the record
// as it was, applies for one with it, and replays its receipt for the same key.
test('archive, restore and settings commands refuse those without the right and apply once', async () => {
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
        createFlowWorkspaceModule(),
      ],
      serve: {
        permissions: everyFunction,
        sessions: { anonymous: { company: 'audit-flow' } },
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
  const pg = Boolean(process.env.FLOW_TEST_DATABASE_URL)
  try {
    await app.fixture.call('partner.savePartner', {
      id: 'audit-party',
      kind: 'company',
      name: 'Synthetic audit',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'audit-flow',
      partnerId: 'audit-party',
      currency: 'VND',
    })
    // A viewer, an editor and a member without a grant on the project; a guest editor.
    const people = ['au-viewer', 'au-editor', 'au-member', 'au-guest']
    for (const id of ['au-owner', ...people]) {
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          password: 'local-test-password',
          name: id,
          email: id + '@example.test',
          defaultCompanyId: 'audit-flow',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: `${id}:audit-flow`,
        userId: id,
        companyId: 'audit-flow',
      })
    }
    // Every person may call every function: the refusals below are Flow's own.
    await app.fixture.call('user.saveRole', { id: 'audit-role', name: 'Audit role' })
    for (const key of Object.keys(native.functions))
      if (native.functions[key]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: `audit-${key}`,
          roleId: 'audit-role',
          fnKey: `flow.${key}`,
        })
    for (const id of ['au-owner', ...people])
      await app.fixture.call('user.assignRole', { id: `${id}:flow`, userId: id, roleId: 'audit-role' })
    await app.client.login({ login: 'au-owner', password: 'local-test-password' })
    const call = async (name: string, args: Row) => (await app.client.call<Row>(name, args)).value
    const sessions = new Map<string, (name: string, args: Row) => Promise<Row>>()
    const as = async (login: string) => {
      if (!sessions.has(login)) {
        const client = app.client.anonymous()
        await client.login({ login, password: 'local-test-password' })
        sessions.set(login, async (name, args) => (await client.call<Row>(name, args)).value)
      }
      return sessions.get(login)!
    }
    const ok = (value: Row) => {
      assert.equal(value.ok, true, JSON.stringify(value))
      return value
    }
    const code = (value: Row) => (value.errors as Row[] | undefined)?.[0]?.code
    const boot = async (route: string, projectId?: unknown) =>
      await call('flow.workspace.bootstrap', { route, ...(projectId ? { projectId } : {}) })
    const orgRevision = async () => Number((await boot('workspaces')).organizationRevision)
    // Versioned records: the organization, a Workspace and a project.
    const companyVersion = async () => ((await boot('organization-settings')).company as Row).version
    const workspaceVersion = async (id: unknown) =>
      ((await boot('workspaces')).workspaces as Row[]).find((w) => w.id === id)?.version
    // Only the open project carries its version, as on the screens that change it.
    const projectVersion = async (id: unknown) =>
      ((await boot('settings', id)).projects as Row[]).find((p) => p.id === id)?.version

    const workspace = ok(
      await call('flow.workspace.create', { title: 'Audit', expectedRevision: 0, idempotencyKey: 'ws' }),
    )
    const project = ok(
      await call('flow.project.save', {
        workspaceId: workspace.id,
        title: 'Audited',
        code: 'AUD',
        access: 'private',
        sprintCadence: { weeks: 1, weekday: 1 },
        expectedRevision: await orgRevision(),
        idempotencyKey: 'project',
      }),
    )
    const spare = ok(
      await call('flow.project.save', {
        workspaceId: workspace.id,
        title: 'Spare',
        code: 'SPR',
        access: 'private',
        expectedRevision: await orgRevision(),
        idempotencyKey: 'spare',
      }),
    )
    const bind = (n: number) => (pg ? '$' + n : '?')
    await app.fixture.withTenant('', async ({ adapter }) => {
      const [owner] = await adapter.all(`SELECT * FROM flow_member WHERE "userId"=${bind(1)}`, ['au-owner'])
      const columns = Object.keys(owner!)
      for (const id of people) {
        const row: Row = {
          ...owner,
          id: 'member-' + id,
          userId: id,
          role: id === 'au-guest' ? 'guest' : 'member',
        }
        await adapter.run(
          `INSERT INTO flow_member (${columns.map((c) => '"' + c + '"').join(',')}) VALUES (${columns.map((_, i) => bind(i + 1)).join(',')})`,
          columns.map((c) => row[c]),
        )
      }
    })
    for (const [person, role] of [
      ['au-viewer', 'viewer'],
      ['au-editor', 'editor'],
      ['au-guest', 'editor'],
    ] as const)
      for (const target of [project, spare])
        ok(
          await call('flow.access.grant', {
            scope: 'project',
            targetId: target.id,
            subjectType: 'user',
            subjectIds: [person],
            role,
            expectedRevision: await orgRevision(),
            idempotencyKey: `grant-${person}-${target.code ?? target.id}`,
          }),
        )
    const viewer = await as('au-viewer'),
      editor = await as('au-editor'),
      member = await as('au-member'),
      guest = await as('au-guest')
    const refused = async (
      who: (name: string, args: Row) => Promise<Row>,
      name: string,
      args: Row,
      why = 'forbidden',
    ) => {
      const value = await who(name, args)
      assert.equal(value.ok, false, `${name} ${JSON.stringify(value)}`)
      assert.equal(code(value), why, `${name} ${JSON.stringify(value)}`)
    }
    // Applies once: the same key replays the receipt instead of applying again.
    const once = async (who: (name: string, args: Row) => Promise<Row>, name: string, args: Row) => {
      const first = ok(await who(name, args))
      assert.deepEqual(await who(name, args), first, `${name} replays its receipt`)
      return first
    }

    // Settings: the organization and a Workspace are managed by those who manage them.
    await refused(editor, 'flow.company.save', {
      title: 'Taken over',
      expectedVersion: await companyVersion(),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'company-editor',
    })
    assert.notEqual(((await boot('organization-settings')).company as Row).name, 'Taken over')
    await once(call, 'flow.company.save', {
      title: 'Audit company',
      expectedVersion: await companyVersion(),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'company-owner',
    })
    assert.equal(((await boot('organization-settings')).company as Row).name, 'Audit company')
    await refused(editor, 'flow.workspace.update', {
      id: workspace.id,
      title: 'Renamed by an editor',
      expectedVersion: await workspaceVersion(workspace.id),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'ws-editor',
    })
    await once(call, 'flow.workspace.update', {
      id: workspace.id,
      title: 'Audit renamed',
      expectedVersion: await workspaceVersion(workspace.id),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'ws-owner',
    })
    const workspaces = (await boot('workspaces')).workspaces as Row[]
    assert.equal(workspaces.find((w) => w.id === workspace.id)?.title, 'Audit renamed')

    // Project access is managed; a favourite needs only to read the project.
    await refused(editor, 'flow.project.access', {
      id: project.id,
      access: 'workspace',
      expectedVersion: await projectVersion(project.id),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'access-editor',
    })
    await refused(member, 'flow.project.favorite', {
      id: project.id,
      expectedRevision: await orgRevision(),
      idempotencyKey: 'favorite-member',
    })
    await once(viewer, 'flow.project.favorite', {
      id: project.id,
      expectedRevision: await orgRevision(),
      idempotencyKey: 'favorite-viewer',
    })
    assert.ok(
      (
        (await viewer('flow.workspace.bootstrap', { route: 'projects' })).projectFavorites as unknown[]
      ).includes(project.id),
    )
    await once(call, 'flow.project.access', {
      id: project.id,
      access: 'workspace',
      expectedVersion: await projectVersion(project.id),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'access-owner',
    })
    ok(
      await call('flow.project.access', {
        id: project.id,
        access: 'private',
        expectedVersion: await projectVersion(project.id),
        expectedRevision: await orgRevision(),
        idempotencyKey: 'access-owner-back',
      }),
    )

    // Catalog entries, Epics and sprints are archived and restored by project managers.
    const settings = async () => await boot('settings', project.id)
    const entry = async (list: string, id: unknown) =>
      ((await settings())[list] as Row[]).find((x) => x.id === id) as Row | undefined
    // A project with its own columns keeps one active column in every status group: peers
    // stay while the audited one is archived.
    for (const kind of ['todo', 'progress', 'review', 'done'])
      ok(
        await call('flow.column.save', {
          projectId: project.id,
          title: 'Peer ' + kind,
          kind,
          idempotencyKey: 'col-peer-' + kind,
        }),
      )
    const created = {
      column: ok(
        await call('flow.column.save', {
          projectId: project.id,
          title: 'Audit column',
          idempotencyKey: 'col',
        }),
      ),
      type: ok(
        await call('flow.type.save', { projectId: project.id, title: 'Audit type', idempotencyKey: 'type' }),
      ),
      field: ok(
        await call('flow.field.save', {
          projectId: project.id,
          title: 'Audit field',
          idempotencyKey: 'field',
        }),
      ),
      epic: ok(
        await call('flow.epic.save', {
          projectId: project.id,
          title: 'Audit epic',
          ownerId: 'au-owner',
          outcome: 'Audited',
          start: '2026-10-12',
          end: '2026-10-30',
          idempotencyKey: 'epic',
        }),
      ),
      sprint: ok(
        await call('flow.sprint.save', {
          projectId: project.id,
          title: 'Audit sprint',
          start: '2026-10-12',
          end: '2026-10-18',
          idempotencyKey: 'sprint',
        }),
      ),
    }
    const lists = {
      column: 'columns',
      type: 'taskTypes',
      field: 'fields',
      epic: 'epics',
      sprint: 'sprints',
    } as const
    for (const kind of Object.keys(created) as (keyof typeof created)[]) {
      const id = created[kind].id
      const before = await entry(lists[kind], id)
      assert.ok(before, `${kind} is listed`)
      const args = (verb: string, by: string) => ({
        id,
        projectId: project.id,
        expectedVersion: before!.version,
        idempotencyKey: `${kind}-${verb}-${by}`,
      })
      await refused(editor, `flow.${kind}.archive`, args('archive', 'editor'))
      assert.deepEqual(await entry(lists[kind], id), before, `${kind} is unchanged after a refusal`)
      const receipt = await once(call, `flow.${kind}.archive`, args('archive', 'owner'))
      // Settings list active entries: an archived one leaves the list or is marked.
      const archived = await entry(lists[kind], id)
      assert.ok(!archived || archived.archived === true, `${kind} archived ${JSON.stringify(archived)}`)
      const version = receipt.version ?? archived?.version ?? Number(before!.version) + 1
      await refused(editor, `flow.${kind}.restore`, {
        ...args('restore', 'editor'),
        expectedVersion: version,
      })
      assert.deepEqual(await entry(lists[kind], id), archived, `${kind} stays archived after a refusal`)
      await once(call, `flow.${kind}.restore`, { ...args('restore', 'owner'), expectedVersion: version })
      const restored = await entry(lists[kind], id)
      assert.ok(restored && restored.archived !== true, `${kind} restored ${JSON.stringify(restored)}`)
    }

    // A saved view is its owner's: nobody else archives it, not even the organization owner.
    const view = ok(
      await viewer('flow.view.save', {
        projectId: project.id,
        title: 'Viewer view',
        visibility: 'project',
        expectedRevision: (await viewer('flow.workspace.bootstrap', { route: 'projects' }))
          .operationsRevision,
        idempotencyKey: 'view',
      }),
    )
    const operations = async () =>
      (await viewer('flow.workspace.bootstrap', { route: 'projects' })).operationsRevision
    const views = async () =>
      (await viewer('flow.workspace.bootstrap', { route: 'project-issues', projectId: project.id }))
        .views as Row[]
    const viewBefore = (await views()).find((v) => v.id === view.id)!
    for (const who of [call, editor])
      await refused(who, 'flow.view.archive', {
        id: view.id,
        expectedVersion: viewBefore.version,
        expectedRevision: await operations(),
        idempotencyKey: 'view-archive-' + (who === call ? 'owner' : 'editor'),
      })
    await once(viewer, 'flow.view.archive', {
      id: view.id,
      expectedVersion: viewBefore.version,
      expectedRevision: await operations(),
      idempotencyKey: 'view-archive-viewer',
    })
    const viewArchived = (await views()).find((v) => v.id === view.id)
    await refused(call, 'flow.view.restore', {
      id: view.id,
      expectedVersion: viewArchived?.version ?? Number(viewBefore.version) + 1,
      expectedRevision: await operations(),
      idempotencyKey: 'view-restore-owner',
    })
    await once(viewer, 'flow.view.restore', {
      id: view.id,
      expectedVersion: viewArchived?.version ?? Number(viewBefore.version) + 1,
      expectedRevision: await operations(),
      idempotencyKey: 'view-restore-viewer',
    })

    // Task writes: linking a child and archiving a file need write access to the project.
    const parent = ok(
      await call('flow.issue.save', { projectId: project.id, title: 'Parent', idempotencyKey: 'parent' }),
    )
    const child = ok(
      await call('flow.issue.save', { projectId: project.id, title: 'Child', idempotencyKey: 'child' }),
    )
    const detail = async (id: unknown) => (await call('flow.issue.detail', { id })).task as Row
    const link = async (by: string) => ({
      id: parent.id,
      target: child.id,
      expectedVersion: (await detail(parent.id)).version,
      expectedChildVersion: (await detail(child.id)).version,
      idempotencyKey: 'link-' + by,
    })
    await refused(viewer, 'flow.issue.linkChild', await link('viewer'))
    assert.notEqual((await detail(child.id)).parentId, parent.id)
    await once(editor, 'flow.issue.linkChild', await link('editor'))
    assert.ok((await detail(child.id)).parentId, 'the child names its parent')

    const upload = new FormData()
    upload.append('file', new Blob(['audit bytes'], { type: 'text/plain' }), 'audit.txt')
    const posted = await app.client.post('/flow/uploads?task=' + parent.id, upload)
    assert.equal(posted.status, 201, await posted.clone().text())
    const uploadId = ((await posted.json()) as Row).uploadId
    ok(
      await call('flow.attachment.save', {
        taskId: parent.id,
        files: [{ uploadId }],
        idempotencyKey: 'attach',
      }),
    )
    const file = async () =>
      ((await call('flow.issue.detail', { id: parent.id })).files as Row[]).find((f) => f.id === uploadId)!
    const fileBefore = await file()
    await refused(viewer, 'flow.attachment.archive', {
      id: uploadId,
      expectedVersion: fileBefore.version,
      idempotencyKey: 'file-archive-viewer',
    })
    assert.notEqual((await file()).archived, true)
    await once(editor, 'flow.attachment.archive', {
      id: uploadId,
      expectedVersion: fileBefore.version,
      idempotencyKey: 'file-archive-editor',
    })
    const fileArchived = await file()
    assert.equal(fileArchived.archived, true)
    await refused(viewer, 'flow.attachment.restore', {
      id: uploadId,
      expectedVersion: fileArchived.version,
      idempotencyKey: 'file-restore-viewer',
    })
    await once(editor, 'flow.attachment.restore', {
      id: uploadId,
      expectedVersion: fileArchived.version,
      idempotencyKey: 'file-restore-editor',
    })

    // A form takes requests from those who write to its project. A request is assigned to the
    // form's recipient and a guest assigns only to themselves, so no guest submits a form.
    const formsRead = async () => await boot('forms', project.id)
    const form = async (key: string, access: string) =>
      ok(
        await call('flow.form.save', {
          projectId: project.id,
          title: 'Requests ' + access,
          fields: [{ label: 'Need', type: 'text', required: true }],
          access,
          assigneeId: 'au-owner',
          publish: true,
          expectedRevision: (await formsRead()).operationsRevision,
          idempotencyKey: key,
        }),
      )
    const internal = await form('form-internal', 'internal'),
      open = await form('form-project', 'project')
    const submit = async (target: Row, by: string) => {
      const read = await formsRead()
      return {
        id: target.id,
        title: 'Request by ' + by,
        answers: { 'field-0': 'Access to the audit' },
        expectedVersion: (read.forms as Row[]).find((f) => f.id === target.id)?.version,
        expectedRevision: read.operationsRevision,
        idempotencyKey: `submit-${String(target.id)}-${by}`,
      }
    }
    await refused(viewer, 'flow.form.submit', await submit(open, 'viewer'))
    for (const target of [internal, open])
      await refused(guest, 'flow.form.submit', await submit(target, 'guest'))
    const responses = async () => ((await formsRead()).formResponses as Row[]).length
    const before = await responses()
    await once(editor, 'flow.form.submit', await submit(internal, 'editor'))
    assert.equal(await responses(), before + 1, 'one response for one request')

    // A project is archived and restored by its managers.
    await refused(editor, 'flow.project.archive', {
      id: spare.id,
      expectedVersion: await projectVersion(spare.id),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'spare-archive-editor',
    })
    await once(call, 'flow.project.archive', {
      id: spare.id,
      expectedVersion: await projectVersion(spare.id),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'spare-archive-owner',
    })
    await refused(editor, 'flow.project.restore', {
      id: spare.id,
      expectedVersion: await projectVersion(spare.id),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'spare-restore-editor',
    })
    await once(call, 'flow.project.restore', {
      id: spare.id,
      expectedVersion: await projectVersion(spare.id),
      expectedRevision: await orgRevision(),
      idempotencyKey: 'spare-restore-owner',
    })

    // Personal commands keep to the person's own records: a favourite, preferences or a read
    // notification never makes someone else's pending organization or operations command stale.
    await app.fixture.withTenant('', async ({ adapter }) => {
      const row: Row = {
        id: 'inbox-viewer',
        companyId: 'audit-flow',
        recipientId: 'au-viewer',
        kind: 'update',
        title: 'Audit notice',
        body: '',
        read: pg ? false : 0,
        createdAt: new Date().toISOString(),
        version: 1,
      }
      const columns = Object.keys(row)
      await adapter.run(
        `INSERT INTO flow_inbox (${columns.map((c) => '"' + c + '"').join(',')}) VALUES (${columns.map((_, i) => bind(i + 1)).join(',')})`,
        columns.map((c) => row[c]),
      )
    })
    const heldOrganization = await orgRevision(),
      heldOperations = (await formsRead()).operationsRevision
    ok(await viewer('flow.project.favorite', { id: project.id, idempotencyKey: 'favorite-personal' }))
    ok(
      await viewer('flow.preferences.save', {
        timezone: 'Asia/Bangkok',
        idempotencyKey: 'preferences-personal',
      }),
    )
    ok(await viewer('flow.inbox.read', { ids: ['inbox-viewer'], idempotencyKey: 'inbox-personal' }))
    assert.equal(await orgRevision(), heldOrganization, 'a favourite leaves the organization revision')
    assert.equal((await formsRead()).operationsRevision, heldOperations, 'personal settings leave operations')
    ok(
      await call('flow.workspace.update', {
        id: workspace.id,
        title: 'Audit after personal changes',
        expectedVersion: await workspaceVersion(workspace.id),
        expectedRevision: heldOrganization,
        idempotencyKey: 'ws-after-personal',
      }),
    )
    ok(
      await call('flow.view.save', {
        projectId: project.id,
        title: 'Owner view',
        visibility: 'project',
        expectedRevision: heldOperations,
        idempotencyKey: 'view-after-personal',
      }),
    )

    // Strict input: an argument no command declares is refused before any handler runs.
    await assert.rejects(
      call('flow.project.favorite', {
        id: project.id,
        expectedRevision: await orgRevision(),
        idempotencyKey: 'unknown-input',
        pinned: true,
      }),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 422,
    )
  } finally {
    await app.close()
  }
})
