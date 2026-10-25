import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { forget } from '../packages/ketsuite/src/modules/livedoc/sync.ts'
import { test } from 'node:test'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { createFlowWorkspaceModule } from '../packages/ketsuite/src/modules/flow_workspace/index.ts'
import { refuse } from '../packages/ketsuite/src/modules/flow/native/policy.ts'
import { prepareFlowCommand, resolveFlowCommand } from '@ketvietlab/flow-client/command-contract.mjs'
import { taskByKey } from '../packages/ketsuite/src/modules/flow/native/queries.ts'
import {
  backfillNativeFlowAssignmentOrder,
  backfillNativeFlowLabelScope,
  backfillNativeFlowDependencyScope,
} from '../packages/ketsuite/src/modules/flow/native/migrations.ts'
import { everyFunction } from './helpers/permissions.ts'

test('productivity catalog compatibility examines answers beyond the first window', async () => {
  const native = createFlowModule()
  const artifactsDir = await mkdtemp(join(tmpdir(), 'flow-catalog-upgrade-'))
  const deployment = defineDeployment({
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
    serve: { permissions: everyFunction, sessions: { anonymous: { company: 'catalog-company' } } },
  })
  const legacyModel = native.models!.TaskFieldValue!
  const legacyModels: NonNullable<typeof native.models> = {
    ...native.models,
    TaskComment: { ...native.models!.TaskComment!, indexes: {} },
    TaskHistory: { ...native.models!.TaskHistory!, indexes: {} },
    TaskFieldValue: { ...legacyModel, indexes: { pair: legacyModel.indexes!.pair! } },
  }
  for (const name of ['TaskStatus', 'TaskType', 'Label', 'CustomField']) {
    const current = legacyModels[name]!
    const fields = { ...current.fields }
    delete fields.description
    if (name === 'CustomField') delete fields.appliesTo
    legacyModels[name] = { ...current, fields }
  }
  const baseline = defineDeployment({
    ...deployment,
    modules: deployment.modules.map((m) =>
      m === native
        ? {
            ...native,
            models: legacyModels,
          }
        : m,
    ),
  })
  let app = await createTestDeployment(baseline, {
    worker: false,
    client: { headers: { connection: 'close' } },
    artifactsDir,
  })
  try {
    await app.fixture.call('partner.savePartner', {
      id: 'catalog-partner',
      kind: 'company',
      name: 'Catalog test',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'catalog-company',
      partnerId: 'catalog-partner',
      currency: 'VND',
    })
    await app.fixture.call(
      'user.createUser',
      {
        id: 'catalog-owner',
        login: 'catalog-owner',
        name: 'Catalog owner',
        password: 'synthetic-test-password',
        defaultCompanyId: 'catalog-company',
      },
      { actor: null },
    )
    await app.fixture.call('user.grantCompany', {
      id: 'catalog-owner:company',
      userId: 'catalog-owner',
      companyId: 'catalog-company',
    })
    await app.fixture.call('user.saveRole', { id: 'catalog-role', name: 'Catalog test' })
    for (const key of [
      'workspace.initialize',
      'workspace.create',
      'project.save',
      'project.statusOptions',
      'catalog.list',
      'field.save',
      'type.save',
      'tag.save',
      'issue.save',
      'issue.archive',
      'issue.detail',
      'workspace.bootstrap',
    ])
      await app.fixture.call('user.grantFunction', {
        id: 'catalog-' + key,
        roleId: 'catalog-role',
        fnKey: 'flow.' + key,
      })
    await app.fixture.call('user.assignRole', {
      id: 'catalog-owner:role',
      userId: 'catalog-owner',
      roleId: 'catalog-role',
    })
    await app.client.login({ login: 'catalog-owner', password: 'synthetic-test-password' })
    const call = async (name: string, input: Row) => (await app.client.call<Row>(name, input)).value
    const ok = (value: Row) => {
      assert.equal(value.ok, true, JSON.stringify(value))
      return value
    }
    const w = ok(
      await call('flow.workspace.create', {
        title: 'Catalog windows',
        expectedRevision: 0,
        idempotencyKey: 'window-workspace',
      }),
    )
    const p = ok(
      await call('flow.project.save', {
        workspaceId: w.id,
        title: 'Catalog project',
        code: 'CAT',
        expectedRevision: 1,
        idempotencyKey: 'window-project',
      }),
    )
    // Historical row in the old schema, before optional description/filter
    // columns exist. This fixture is only for the isolated upgrade rehearsal.
    const legacyFieldId = randomUUID()
    await app.fixture.withTenant('', async ({ adapter }) => {
      const now = new Date().toISOString()
      await adapter.run(
        'INSERT INTO flow_custom_field (id, "companyId", "projectId", title, kind, required, options, sequence, version, archived, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          legacyFieldId,
          'catalog-company',
          null,
          'Historical field',
          'text',
          false,
          '[]',
          0,
          1,
          false,
          now,
          now,
        ],
      )
    })
    await app.close()
    app = await createTestDeployment(deployment, {
      worker: false,
      client: { headers: { connection: 'close' } },
      artifactsDir,
    })
    await app.client.login({ login: 'catalog-owner', password: 'synthetic-test-password' })
    const beforeLibrary = await call('flow.catalog.list', { kind: 'type' })
    await app.fixture.withTenant('', async ({ adapter }) => {
      const now = new Date().toISOString()
      for (let index = 0; index < 205; index++)
        await adapter.run(
          'INSERT INTO flow_task_type (id, "companyId", title, icon, sequence, version, archived, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            `library-${index}`,
            'catalog-company',
            `Library ${index}`,
            'list',
            2000 + index,
            1,
            false,
            now,
            now,
          ],
        )
    })
    const firstLibrary = await call('flow.catalog.list', { kind: 'type', workspaceId: w.id })
    assert.equal((firstLibrary.items as Row[]).length, 50)
    assert.equal(firstLibrary.total, Number(beforeLibrary.total) + 205)
    assert.ok(String(firstLibrary.cursor).length < 2048)
    let libraryCursor = firstLibrary.cursor
    const ids = (firstLibrary.items as Row[]).map((item) => item.id)
    while (libraryCursor) {
      const next = await call('flow.catalog.list', { kind: 'type', cursor: libraryCursor })
      ids.push(...(next.items as Row[]).map((item) => item.id))
      libraryCursor = next.cursor
    }
    assert.equal(new Set(ids).size, firstLibrary.total)
    const libraryScreen = await call('flow.workspace.bootstrap', { route: 'organization-settings' })
    assert.equal((libraryScreen.types as Row[]).length, 50)
    const pinnedLibrary = await call('flow.workspace.bootstrap', {
      route: 'type-edit',
      recordId: 'library-204',
    })
    assert.equal(
      (pinnedLibrary.types as Row[]).find((item) => item.id === 'library-204')?.title,
      'Library 204',
    )
    const wrongKind = await call('flow.catalog.list', { kind: 'tag', cursor: firstLibrary.cursor })
    assert.equal((wrongKind.errors as Row[])[0]?.code, 'conflict')
    const malformed = await call('flow.catalog.list', { kind: 'type', cursor: 'x'.repeat(2049) })
    assert.equal((malformed.errors as Row[])[0]?.code, 'validation')
    ok(
      await call('flow.type.save', {
        id: 'library-204',
        title: 'Library edited',
        expectedVersion: 1,
        idempotencyKey: 'library-edit',
      }),
    )
    const stale = await call('flow.catalog.list', { kind: 'type', cursor: firstLibrary.cursor })
    assert.equal((stale.errors as Row[])[0]?.code, 'conflict')
    await app.fixture.withTenant('', async ({ adapter }) => {
      for (let index = 0; index < 205; index++)
        await adapter.run('DELETE FROM flow_task_type WHERE id = ? AND "companyId" = ?', [
          `library-${index}`,
          'catalog-company',
        ])
    })
    const migratedFields = (await call('flow.workspace.bootstrap', { projectId: p.id, route: 'settings' }))
      .fields as Row[]
    const migrated = migratedFields.find((f) => f.id === legacyFieldId)!
    assert.equal(migrated.title, 'Historical field')
    assert.equal(migrated.description, null)
    assert.equal(migrated.appliesTo, null)
    ok(
      await call('flow.field.save', {
        id: legacyFieldId,
        description: 'Metadata after upgrade',
        appliesTo: p.id,
        expectedVersion: 1,
        idempotencyKey: 'legacy-field-metadata',
      }),
    )
    const field = ok(
      await call('flow.field.save', {
        projectId: p.id,
        title: 'Numeric text',
        kind: 'text',
        idempotencyKey: 'window-field',
      }),
    )
    // Use real commands for every answer. Choose the last persisted answer by the
    // database order, rather than relying on random UUIDs or creation order.
    for (let i = 0; i < 257; i++)
      ok(
        await call('flow.issue.save', {
          projectId: p.id,
          title: 'Window answer ' + i,
          fieldValues: { [String(field.id)]: '1' },
          idempotencyKey: 'window-task-' + i,
        }),
      )
    const lastTask = await app.fixture.withTenant('', async ({ adapter }) => {
      const rows = await adapter.all(
        'SELECT "taskId" FROM flow_task_field_value WHERE "fieldId" = ? ORDER BY id DESC LIMIT 1',
        [String(field.id)],
      )
      return String(rows[0]!.taskId)
    })
    const edited = ok(
      await call('flow.issue.save', {
        id: lastTask,
        fieldValues: { [String(field.id)]: 'not numeric' },
        expectedVersion: 1,
        idempotencyKey: 'last-window-invalid',
      }),
    )
    ok(
      await call('flow.issue.archive', {
        reason: 'Synthetic archive verification',
        id: lastTask,
        expectedVersion: edited.version,
        idempotencyKey: 'archive-last-window',
      }),
    )
    const invalid = await call('flow.field.save', {
      id: field.id,
      kind: 'number',
      expectedVersion: field.version,
      idempotencyKey: 'invalid-second-window',
    })
    assert.equal(
      invalid.ok,
      false,
      'An incompatible archived answer after row 256 must block the definition change',
    )
    assert.equal((invalid.fields as Row).kind, 'incompatible_values')
    const stored = (await call('flow.workspace.bootstrap', { projectId: p.id, route: 'settings' }))
      .fields as Row[]
    assert.equal(stored.find((f) => f.id === field.id)!.kind, 'text')
    const detail = (await call('flow.issue.detail', { id: lastTask })).task as Row
    assert.equal((detail.fieldValues as Row)[String(field.id)], 'not numeric')
    ok(
      await call('flow.issue.save', {
        id: lastTask,
        fieldValues: { [String(field.id)]: '2' },
        expectedVersion: detail.version,
        idempotencyKey: 'repair-last-window',
      }),
    )
    const compatibleInput = {
      id: field.id,
      kind: 'number',
      expectedVersion: field.version,
      idempotencyKey: 'compatible-second-window',
    }
    const compatible = ok(await call('flow.field.save', compatibleInput))
    // Upgrade from the schema without the answer-scan index, then rerun the
    // current migration. Stored values and replay receipts must survive both.
    for (let i = 0; i < 2; i++) {
      await app.close()
      app = await createTestDeployment(deployment, {
        worker: false,
        client: { headers: { connection: 'close' } },
        artifactsDir,
      })
      await app.client.login({ login: 'catalog-owner', password: 'synthetic-test-password' })
      assert.deepEqual(await call('flow.field.save', compatibleInput), compatible)
      const persisted = (await call('flow.issue.detail', { id: lastTask })).task as Row
      assert.equal((persisted.fieldValues as Row)[String(field.id)], '2')
      const indexes = await app.fixture.withTenant('', ({ adapter }) =>
        adapter.all("PRAGMA index_list('flow_task_field_value')"),
      )
      assert.ok(indexes.some((index) => String(index.name).includes('field_answers')))
      for (const table of ['flow_task_comment', 'flow_task_history']) {
        const activityIndexes = await app.fixture.withTenant('', ({ adapter }) =>
          adapter.all(`PRAGMA index_list('${table}')`),
        )
        assert.ok(activityIndexes.some((index) => String(index.name).includes('task_time')))
      }
    }
    const context = () => call('flow.workspace.bootstrap', { route: 'settings' })
    const statuses = ['todo', 'progress', 'review', 'done'].map((kind) => ({
      id: randomUUID(),
      title: kind,
      kind,
      color: 'neutral',
    }))
    const override = ok(
      await call('flow.project.save', {
        workspaceId: w.id,
        title: 'Override catalog',
        code: 'OVR',
        taskStatuses: statuses,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'override-project',
      }),
    )
    const globalStatuses = (
      await call('flow.workspace.bootstrap', { route: 'all-issues', workspaceId: w.id })
    ).columns as Row[]
    assert.equal(
      globalStatuses.filter((column) => column.projectId === override.id).length,
      4,
      'global task lists retain active project status overrides',
    )
    const ownType = ok(
      await call('flow.type.save', {
        projectId: override.id,
        title: 'Scoped review',
        icon: 'list',
        idempotencyKey: 'detail-type',
      }),
    )
    const ownLabel = ok(
      await call('flow.tag.save', {
        title: 'Referenced label',
        color: 'blue',
        domain: 'task',
        idempotencyKey: 'detail-label',
      }),
    )
    const ownField = ok(
      await call('flow.field.save', {
        projectId: override.id,
        title: 'Scoped environment',
        kind: 'text',
        required: true,
        idempotencyKey: 'detail-field',
      }),
    )
    override.version = ownField.projectVersion
    const occupied = ok(
      await call('flow.issue.save', {
        projectId: override.id,
        title: 'Archived status user',
        typeId: ownType.id,
        tagIds: [ownLabel.id],
        fieldValues: { [String(ownField.id)]: 'staging' },
        columnId: statuses[0]!.id,
        idempotencyKey: 'occupied-override',
      }),
    )
    ok(
      await call('flow.issue.archive', {
        reason: 'Synthetic archive verification',
        id: occupied.id,
        expectedVersion: occupied.version,
        idempotencyKey: 'archive-occupied',
      }),
    )
    const swapped = statuses.map((status, i) => ({
      ...status,
      kind: i === 0 ? 'progress' : i === 1 ? 'todo' : status.kind,
    }))
    const invalidGroup = await call('flow.project.save', {
      id: override.id,
      taskStatuses: swapped,
      expectedVersion: override.version,
      expectedRevision: (await context()).organizationRevision,
      idempotencyKey: 'invalid-used-group',
    })
    assert.equal(
      invalidGroup.ok,
      false,
      'aggregate replacement cannot change an archived task status meaning',
    )
    assert.equal((invalidGroup.fields as Row).kind, 'catalog_status_in_use')
    const renamed = statuses.map((status, i) => ({
      ...status,
      title: i === 0 ? 'Renamed todo' : status.title,
    }))
    const saved = ok(
      await call('flow.project.save', {
        id: override.id,
        taskStatuses: renamed,
        expectedVersion: override.version,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'rename-used-status',
      }),
    )
    const duplicate = renamed.map((status, i) => ({
      ...status,
      title: i === 1 ? '  RENAMED TODO  ' : status.title,
    }))
    const invalidTitle = await call('flow.project.save', {
      id: override.id,
      taskStatuses: duplicate,
      expectedVersion: saved.version,
      expectedRevision: (await context()).organizationRevision,
      idempotencyKey: 'duplicate-trimmed-title',
    })
    assert.equal(
      invalidTitle.ok,
      false,
      'aggregate titles use the same canonical key as Atlas and individual commands',
    )
    const storedStatuses = (
      await call('flow.workspace.bootstrap', { projectId: override.id, route: 'settings' })
    ).columns as Row[]
    assert.equal(storedStatuses.find((status) => status.id === statuses[0]!.id)!.kind, 'todo')
    assert.equal(storedStatuses.find((status) => status.id === statuses[0]!.id)!.title, 'Renamed todo')
    const cloneLabel = randomUUID(),
      priorTask = (await call('flow.issue.detail', { id: occupied.id })).task as Row
    const remapInput = {
      id: override.id,
      taskLabels: [{ id: cloneLabel, sourceId: ownLabel.id, title: 'Project label', color: 'blue' }],
      expectedVersion: saved.version,
      expectedRevision: (await context()).organizationRevision,
      idempotencyKey: 'audit-label-remap',
    }
    const remapped = ok(await call('flow.project.save', remapInput))
    const mappedDetail = await call('flow.issue.detail', { id: occupied.id })
    const remapHistory = (mappedDetail.history as Row[]).filter((entry) => entry.kind === 'catalog_remapped')
    assert.equal(remapHistory.length, 1)
    assert.equal(remapHistory[0]!.version, Number(priorTask.version) + 1)
    assert.deepEqual(remapHistory[0]!.changes, [
      { field: 'tags', before: [ownLabel.id], after: [cloneLabel] },
    ])
    assert.equal(
      (mappedDetail.task as Row).archived,
      true,
      'archived tasks keep audit when their catalog changes',
    )
    assert.deepEqual(await call('flow.project.save', remapInput), remapped)
    assert.equal(
      ((await call('flow.issue.detail', { id: occupied.id })).history as Row[]).filter(
        (entry) => entry.kind === 'catalog_remapped',
      ).length,
      1,
    )
    ok(
      await call('flow.project.save', {
        id: override.id,
        taskLabels: null,
        expectedVersion: remapped.version,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'audit-label-reset',
      }),
    )
    const restoredDetail = await call('flow.issue.detail', { id: occupied.id })
    const resetAudit = (restoredDetail.history as Row[]).find(
      (entry) => entry.kind === 'catalog_remapped' && entry.version === Number(priorTask.version) + 2,
    )
    assert.deepEqual(resetAudit?.changes, [{ field: 'tags', before: [cloneLabel], after: [ownLabel.id] }])
    // Amplify an unrelated, authorized project's catalog ahead of the selected
    // project's definitions. This isolated read fixture must not consume the
    // selected project's window, nor leak its choices into the current screen.
    await app.fixture.withTenant('', async ({ adapter }) => {
      const stamp = new Date().toISOString()
      for (let n = 0; n < 201; n++)
        await adapter.run(
          'INSERT INTO flow_task_status (id, "companyId", "projectId", title, kind, color, icon, sequence, version, archived, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            randomUUID(),
            'catalog-company',
            p.id,
            'Other project ' + n,
            'todo',
            'neutral',
            'circle',
            -1,
            1,
            false,
            stamp,
            stamp,
          ],
        )
      for (let n = 0; n < 201; n++) {
        await adapter.run(
          'INSERT INTO flow_task_type (id, "companyId", "projectId", title, icon, sequence, version, archived, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), 'catalog-company', p.id, 'Other type ' + n, 'list', -1, 1, false, stamp, stamp],
        )
        await adapter.run(
          'INSERT INTO flow_label (id, "companyId", "projectId", title, domain, color, sequence, version, archived, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            randomUUID(),
            'catalog-company',
            p.id,
            'Other label ' + n,
            'task',
            'green',
            -1,
            1,
            false,
            stamp,
            stamp,
          ],
        )
      }
    })
    const isolatedCatalog = await call('flow.workspace.bootstrap', { projectId: override.id, route: 'board' })
    const isolatedColumns = isolatedCatalog.columns as Row[]
    assert.equal(isolatedColumns.filter((column) => column.projectId === override.id).length, 4)
    assert.equal(
      isolatedColumns.some((column) => column.projectId === p.id),
      false,
    )
    assert.ok(
      isolatedColumns.some((column) => !column.projectId),
      'company defaults remain available',
    )
    const statusChoices = await call('flow.project.statusOptions', { projectId: override.id })
    assert.deepEqual(
      (statusChoices.items as Row[]).map((item) => item.id),
      renamed.map((item) => item.id),
    )
    assert.equal((statusChoices.items as Row[])[0]!.label, 'Renamed todo')
    const currentStatus = (await call('flow.issue.detail', { id: occupied.id })).task as Row
    assert.deepEqual(
      currentStatus.statusDefinition,
      {
        id: statuses[0]!.id,
        label: 'Renamed todo',
        kind: 'todo',
        color: 'neutral',
      },
      'detail carries the referenced status even outside the workspace catalog window',
    )
    assert.equal((currentStatus.typeDefinition as Row).title, 'Scoped review')
    assert.deepEqual(
      (currentStatus.tagDefinitions as Row[]).map((tag) => tag.id),
      [ownLabel.id],
    )
    const detailCatalogs = currentStatus.catalogs as Row
    const {
      project: composerProject,
      sprints: composerSprints,
      ...composerCatalogs
    } = await call('flow.project.taskOptions', { projectId: override.id })
    assert.equal((composerProject as Row).id, override.id)
    assert.ok(Array.isArray(composerSprints))
    assert.deepEqual(
      composerCatalogs,
      detailCatalogs,
      'composer reads the exact guarded detail catalog without a task',
    )
    assert.ok(JSON.stringify(composerCatalogs).length < 150 * 1024)
    assert.equal(detailCatalogs.projectId, override.id)
    assert.equal(
      (detailCatalogs.types as Row[]).some((type) => type.id === ownType.id),
      true,
    )
    assert.equal(
      (detailCatalogs.tags as Row[]).some((tag) => tag.id === ownLabel.id),
      true,
    )
    assert.equal(
      (detailCatalogs.fields as Row[]).some((f) => f.id === ownField.id && f.required),
      true,
    )
    assert.equal(
      (detailCatalogs.fields as Row[]).some((f) => f.id === legacyFieldId),
      false,
      'another project appliesTo is excluded',
    )
    for (const key of ['columns', 'types', 'tags', 'fields'])
      assert.equal(
        (detailCatalogs[key] as Row[]).some((item) => item.projectId === p.id),
        false,
        key,
      )
    const sharedChoices = await call('flow.project.statusOptions', { projectId: p.id })
    assert.equal(
      (sharedChoices.items as Row[]).length,
      4,
      'inherited choices ignore unrelated project definitions',
    )
    const overflowCatalog = await call('flow.workspace.bootstrap', { projectId: p.id, route: 'board' })
    assert.equal(overflowCatalog.ok, false)
    assert.equal(
      (overflowCatalog.errors as Row[])[0]!.code,
      'limit',
      'oversized scoped catalog refuses instead of truncating',
    )
    const visibleBefore = ((await context()).projects as Row[]).map((project) => project.id).sort()
    await app.fixture.withTenant('', async ({ adapter }) => {
      const source = (await adapter.all('SELECT * FROM flow_project_record WHERE id = ?', [String(p.id)]))[0]!
      const columns = Object.keys(source)
      for (let n = 0; n < 501; n++) {
        const clone = {
          ...source,
          id: randomUUID(),
          title: 'AAA hidden project ' + n,
          code: 'HIDDEN-' + n,
          access: 'private',
        }
        await adapter.run(
          `INSERT INTO flow_project_record (${columns.map((c) => '"' + c + '"').join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
          columns.map((c) => clone[c as keyof typeof clone]),
        )
      }
    })
    const visibleAfter = await context()
    assert.deepEqual(
      (visibleAfter.projects as Row[]).map((project) => project.id).sort(),
      visibleBefore,
      '501 private projects sorting first must not evict authorized projects',
    )
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run("UPDATE flow_project_record SET access = 'workspace' WHERE code LIKE 'HIDDEN-%'")
    })
    const tooManyVisible = await context()
    assert.equal(tooManyVisible.ok, false)
    assert.equal(
      (tooManyVisible.errors as Row[])[0]!.code,
      'limit',
      'visible scope overflow must not return false totals',
    )
  } finally {
    await app.close()
    await rm(artifactsDir, { recursive: true, force: true })
  }
})

test('productivity native Flow: durable scoped commands, replay, CAS and bounded HTTP reads', async () => {
  let protectedTask = ''
  let extensionWrites = 0
  assert.throws(
    () =>
      createFlowModule({
        extensions: [
          {
            name: 'collision',
            effects: [],
            inputFields: { 'flow.issue.save': { title: 'text?' } },
          },
        ],
      }),
    /Duplicate Flow input field/,
  )
  const native = createFlowModule({
    extensions: [
      {
        name: 'reorder-test-guard',
        effects: [],
        inputFields: { 'flow.issue.save': { extensionNote: 'text?' } },
        beforeMutation: async (_ctx, mutation) => {
          if (
            mutation.name === 'flow.issue.reorder' &&
            mutation.input.id === protectedTask &&
            mutation.input.priority === 'urgent'
          )
            refuse('blocked')
        },
        afterMutation: async (ctx, mutation, value) => {
          if (mutation.name !== 'flow.issue.save' || !mutation.input.extensionNote) return
          const result = value as Row
          const task = await taskByKey(ctx, result.id)
          await ctx.db.insert('flow.TaskHistory', {
            id: randomUUID(),
            taskId: task.id,
            projectId: task.projectId,
            workspaceId: null,
            actorId: ctx.actor,
            kind: 'extension',
            description: String(mutation.input.extensionNote),
            metadata: {},
            createdAt: new Date().toISOString(),
          })
          extensionWrites++
          if (mutation.input.extensionNote === 'refuse after write') refuse('blocked')
        },
        detail: async (_ctx, task) => ({ extensionRecords: { [String(task.key)]: { detail: true } } }),
        projection: async (_ctx, _route, tasks) => ({
          extensionRecords: Object.fromEntries(tasks.map((task) => [String(task.id), { detail: false }])),
        }),
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
        createFlowStorageModule(),
        user,
        mail,
        backend,
        userBackend,
        livedoc,
        native,
        createFlowWorkspaceModule(),
      ],
      serve: { permissions: everyFunction, sessions: { anonymous: { company: 'company-a' } } },
    }),
    { worker: false, client: { headers: { connection: 'close' } } },
  )
  try {
    await app.fixture.call('partner.savePartner', {
      id: 'partner-a',
      kind: 'company',
      name: 'Example Company',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'company-a',
      partnerId: 'partner-a',
      currency: 'VND',
    })
    for (const id of ['owner', 'member', 'outsider']) {
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          password: 'local-test-password',
          name: id,
          email: id + '@example.test',
          defaultCompanyId: 'company-a',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: `${id}:company-a`,
        userId: id,
        companyId: 'company-a',
      })
    }
    await app.fixture.call('user.saveRole', { id: 'flow-test-role', name: 'Flow test role' })
    for (const key of Object.keys(native.functions))
      if (native.functions[key]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: `test-${key}`,
          roleId: 'flow-test-role',
          fnKey: `flow.${key}`,
        })
    for (const id of ['owner', 'member', 'outsider'])
      await app.fixture.call('user.assignRole', { id: `${id}:flow`, userId: id, roleId: 'flow-test-role' })
    await app.client.login({ login: 'owner', password: 'local-test-password' })
    const call = async (name: string, args: Row) => {
      try {
        return (await app.client.call<Row>(name, args)).value
      } catch (error) {
        console.error(app.records.records.filter((r) => r.level === 'error').slice(-2))
        throw error
      }
    }
    const initial = await call('flow.workspace.bootstrap', { route: 'workspaces' })
    assert.deepEqual(initial.workspaces, [])
    const invalidAccess = await call('flow.workspace.create', {
      title: 'Invalid access',
      access: 'private',
      expectedRevision: 0,
      idempotencyKey: 'invalid-workspace-access',
    })
    assert.equal((invalidAccess.fields as Row).access, 'invalid')
    assert.deepEqual((await call('flow.workspace.bootstrap', { route: 'workspaces' })).workspaces, [])
    const workspaceArgs = { title: 'Delivery', expectedRevision: 0, idempotencyKey: 'workspace-create' }
    const workspace = await call('flow.workspace.create', workspaceArgs)
    assert.equal(workspace.ok, true, JSON.stringify(workspace))
    assert.equal(workspace.revision, 1)
    assert.deepEqual(await call('flow.workspace.create', workspaceArgs), workspace)
    const replayMismatch = await call('flow.workspace.create', {
      ...workspaceArgs,
      title: 'Another workspace',
    })
    assert.equal((replayMismatch.errors as Row[])[0].code, 'replay_mismatch')
    const onboarding = async () =>
      await call('flow.workspace.bootstrap', {
        route: 'workspace-overview',
        workspaceId: workspace.id,
        query: 'no such task in preview',
      })
    assert.deepEqual((await onboarding()).gettingStartedState, {
      workspaceId: workspace.id,
      project: false,
      task: false,
      invite: false,
      page: false,
    })
    const project = await call('flow.project.save', {
      workspaceId: workspace.id,
      title: 'Shipping',
      code: 'SHIP',
      ownerId: 'owner',
      state: 'planned',
      tags: [],
      memberIds: [],
      teamIds: [],
      sprintCadence: null,
      defaultView: 'board',
      expectedRevision: 1,
      idempotencyKey: 'project-create',
    })
    assert.equal(project.ok, true, JSON.stringify(project))
    const hookInput = {
      projectId: project.id,
      title: 'Extension transaction',
      extensionNote: 'Committed together',
      idempotencyKey: 'hook-success',
    }
    const hookTask = await call('flow.issue.save', hookInput)
    assert.equal(hookTask.ok, true, JSON.stringify(hookTask))
    const hookDetail = await call('flow.issue.detail', { id: hookTask.id })
    assert.equal((hookDetail.history as Row[]).filter((h) => h.kind === 'extension').length, 1)
    assert.deepEqual(hookDetail.extensionRecords, { [String(hookTask.id)]: { detail: true } })
    const writesAfterSuccess = extensionWrites
    assert.deepEqual(await call('flow.issue.save', hookInput), hookTask)
    assert.equal(extensionWrites, writesAfterSuccess, 'Replay must not execute extension writes twice')
    const hookFailed = await call('flow.issue.save', {
      projectId: project.id,
      title: 'Rolled back extension',
      extensionNote: 'refuse after write',
      idempotencyKey: 'hook-refused',
    })
    assert.equal(hookFailed.ok, false, JSON.stringify(hookFailed))
    assert.equal((hookFailed.errors as Row[])[0].code, 'blocked')
    assert.equal(
      (await call('flow.issue.list', { projectId: project.id, query: 'Rolled back extension' })).total,
      0,
    )
    const hookCollection = await call('flow.issue.list', {
      projectId: project.id,
      query: 'Extension transaction',
    })
    assert.deepEqual(hookCollection.extensionRecords, { [String(hookTask.id)]: { detail: false } })
    assert.equal(
      (
        await call('flow.issue.archive', {
          reason: 'Synthetic archive verification',
          id: hookTask.id,
          expectedVersion: hookTask.version,
          idempotencyKey: 'archive-hook-task',
        })
      ).ok,
      true,
    )
    const invitation = await call('flow.member.invite', {
      email: 'member@example.test',
      role: 'member',
      expectedRevision: 2,
      idempotencyKey: 'invite-member',
    })
    assert.equal(invitation.ok, true, JSON.stringify(invitation))
    const token = await app.fixture.withTenant('', async ({ adapter }) => {
      const rows = await adapter.all('SELECT payload FROM flow_outbox WHERE "targetId" = ?', [
        String(invitation.id),
      ])
      return (JSON.parse(String(rows[0]!.payload)) as Row).token
    })
    const second = app.client.anonymous()
    await second.login({ login: 'member', password: 'local-test-password' })
    const accepted = (
      await second.call<Row>('flow.invitation.accept', { token, idempotencyKey: 'accept-member' })
    ).value
    assert.equal(accepted.ok, true, JSON.stringify(accepted))
    const people = await call('flow.member.options', { projectId: project.id, limit: 1 })
    assert.equal(people.total, 2)
    assert.equal((people.items as Row[]).length, 1)
    assert.ok(people.cursor)
    const peopleNext = await call('flow.member.options', {
      projectId: project.id,
      limit: 1,
      cursor: people.cursor,
    })
    assert.equal((peopleNext.items as Row[]).length, 1)
    assert.notEqual((peopleNext.items as Row[])[0]!.id, (people.items as Row[])[0]!.id)
    assert.equal((await call('flow.member.options', { projectId: project.id, query: 'owner' })).total, 1)
    assert.equal(
      (
        (
          await call('flow.member.options', {
            projectId: project.id,
            query: 'changed',
            cursor: people.cursor,
          })
        ).errors as Row[]
      )[0]!.code,
      'conflict',
    )
    for (const position of [null, [], true, { name: 'Owner', id: '' }]) {
      const malformed = Buffer.from(JSON.stringify(position)).toString('base64url')
      for (const endpoint of ['flow.member.options', 'flow.member.list']) {
        const result = await call(endpoint, { projectId: project.id, cursor: malformed })
        assert.equal(
          (result.fields as Row).cursor,
          'invalid',
          endpoint + ' rejects malformed positions without an internal error',
        )
      }
    }
    const html = await app.client.get('/flow/board?project=' + project.id + '&workspace=' + workspace.id)
    assert.equal(html.status, 200)
    const documentHTML = await html.text()
    assert.match(documentHTML, /flow\.workspace/)
    assert.match(documentHTML, /data-flow="shell"/)
    assert.match(documentHTML, /type="importmap"/)
    assert.doesNotMatch(documentHTML, /x-flow-fixture|atlas\/entry|fixtures\.mjs/)
    const first = await call('flow.issue.save', {
      projectId: project.id,
      title: 'First real task',
      description: 'Persisted body',
      assigneeIds: ['owner'],
      tagIds: [],
      idempotencyKey: 'task-create',
    })
    assert.equal(first.ok, true, JSON.stringify(first))
    const changed = await call('flow.issue.save', {
      id: first.id,
      title: 'Edited task',
      expectedVersion: 1,
      idempotencyKey: 'task-edit',
    })
    assert.equal(changed.ok, true, JSON.stringify(changed))
    assert.equal((changed.record as Row).task && ((changed.record as Row).task as Row).title, 'Edited task')
    const stale = await call('flow.issue.save', {
      id: first.id,
      title: 'Stale task',
      expectedVersion: 1,
      idempotencyKey: 'task-stale',
    })
    assert.equal((stale.errors as Row[])[0].code, 'conflict')
    const detail = await call('flow.issue.detail', { id: first.id })
    assert.equal((detail.task as Row).title, 'Edited task')
    assert.equal((detail.task as Row).description, 'Persisted body')
    assert.equal(
      ((await second.call<Row>('flow.issue.detail', { id: first.id })).value.task as Row).title,
      'Edited task',
    )
    const file = new FormData()
    file.append('file', new Blob(['private task file'], { type: 'text/plain' }), 'notes.txt')
    const upload = await app.client.post('/flow/uploads?task=' + first.id, file)
    assert.equal(upload.status, 201, await upload.clone().text())
    const uploadId = ((await upload.json()) as Row).uploadId
    const attached = await call('flow.attachment.save', {
      taskId: first.id,
      files: [{ uploadId }],
      idempotencyKey: 'attach-file',
    })
    assert.equal(attached.ok, true, JSON.stringify(attached))
    const fileRead = await second.get('/flow/files/' + uploadId)
    assert.equal(fileRead.status, 200)
    assert.equal(await fileRead.text(), 'private task file')
    const staged = new FormData()
    staged.append('file', new Blob(['creation bytes'], { type: 'text/plain' }), 'creation.txt')
    const stage = await app.client.post('/flow/uploads?project=' + project.id, staged)
    assert.equal(stage.status, 201, await stage.clone().text())
    const stagedId = ((await stage.json()) as Row).uploadId
    assert.equal((await second.get('/flow/files/' + stagedId)).status, 403)
    const bundled = {
      projectId: project.id,
      title: 'Bundled task',
      checklist: [{ id: 'check-0', text: 'Verify', checked: false }],
      subtasks: ['Child'],
      attachments: [{ uploadId: stagedId }],
      idempotencyKey: 'task-bundle',
    }
    const created = await call('flow.issue.save', bundled)
    assert.equal(created.ok, true, JSON.stringify(created))
    assert.equal((await call('flow.issue.save', bundled)).id, created.id)
    const creationFile = await second.get('/flow/files/' + stagedId)
    assert.equal(creationFile.status, 200)
    assert.equal(await creationFile.text(), 'creation bytes')
    const createdDetail = await call('flow.issue.detail', { id: created.id })
    assert.equal(((createdDetail.task as Row).checklist as Row[])[0].text, 'Verify')
    assert.equal(
      ((await call('flow.issue.list', { projectId: project.id, limit: 100 })).tasks as Row[]).filter(
        (t) => t.parentId === created.id,
      ).length,
      1,
    )
    const createdDocument = await call('flow.page.save', {
      projectId: project.id,
      workspaceId: workspace.id,
      title: 'Untitle',
      titleSource: 'content',
      blocks: [{ id: 'title', type: 'h1', text: 'Untitle' }],
      idempotencyKey: 'doc-create',
    })
    assert.equal(createdDocument.ok, true, JSON.stringify(createdDocument))
    const completeStart = await onboarding()
    assert.equal((completeStart.tasks as Row[]).length, 0, 'task filter affects only the preview')
    assert.equal((completeStart.pages as Row[]).length, 0, 'Overview does not download document bodies')
    assert.deepEqual(completeStart.gettingStartedState, {
      workspaceId: workspace.id,
      project: true,
      task: true,
      invite: true,
      page: true,
    })
    // A hidden/private or archived page must not leak its existence through the checklist.
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run('UPDATE flow_document SET visibility=?, "authorId"=? WHERE id=?', [
        'private',
        'member',
        createdDocument.id,
      ])
    })
    assert.equal(((await onboarding()).gettingStartedState as Row).page, false)
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run('UPDATE flow_document SET visibility=?, "authorId"=?, archived=? WHERE id=?', [
        'shared',
        'owner',
        true,
        createdDocument.id,
      ])
    })
    assert.equal(((await onboarding()).gettingStartedState as Row).page, false)
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run('UPDATE flow_document SET archived=? WHERE id=?', [false, createdDocument.id])
    })
    assert.equal(((await onboarding()).gettingStartedState as Row).page, true)

    const editedDocument = await call('flow.page.save', {
      id: createdDocument.id,
      blocks: [{ id: 'title', type: 'h1', text: 'Shipping notes' }],
      titleSource: 'content',
      expectedVersion: 1,
      idempotencyKey: 'doc-edit',
    })
    assert.equal(editedDocument.ok, true, JSON.stringify(editedDocument))
    const documentBase = '/flow/live/pages/' + createdDocument.id
    const content = await app.client.get(documentBase + '/content')
    assert.equal(content.status, 200, await content.clone().text())
    const live = (await content.json()) as Row
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, Buffer.from(String(live.snapshot), 'base64'))
    const vector = Y.encodeStateVector(ydoc)
    const firstBlock = ydoc.getXmlFragment('content').get(0)
    assert.ok(firstBlock instanceof Y.XmlElement)
    const text = firstBlock.get(0)
    assert.ok(text instanceof Y.XmlText)
    text.delete(0, text.length)
    text.insert(0, 'Collaborative title')
    const pushed = await app.client.post(
      documentBase + '/push',
      new Blob(
        [JSON.stringify({ update: Buffer.from(Y.encodeStateAsUpdate(ydoc, vector)).toString('base64') })],
        { type: 'application/json' },
      ),
    )
    assert.equal(pushed.status, 200, await pushed.clone().text())
    forget({ company: 'company-a', kind: 'flow.Document', id: String(createdDocument.id) })
    const shared = await second.get(documentBase + '/content')
    assert.equal(shared.status, 200)
    const readerDoc = new Y.Doc()
    Y.applyUpdate(readerDoc, Buffer.from(String(((await shared.json()) as Row).snapshot), 'base64'))
    assert.match(readerDoc.getXmlFragment('content').toString(), /Collaborative title/)
    readerDoc.destroy()
    ydoc.destroy()
    const documents = await call('flow.workspace.bootstrap', {
      route: 'page',
      projectId: project.id,
      workspaceId: workspace.id,
      recordId: createdDocument.id,
    })
    assert.equal(
      (documents.pages as Row[]).find((p) => p.id === createdDocument.id)?.title,
      'Collaborative title',
    )
    const sharedBytes = Buffer.from(
      String(((await (await second.get(documentBase + '/content')).json()) as Row).snapshot),
      'base64',
    )
    const clientA = new Y.Doc(),
      clientB = new Y.Doc()
    for (const doc of [clientA, clientB]) Y.applyUpdate(doc, sharedBytes)
    const baseVector = Y.encodeStateVector(clientA)
    const append = (doc: Y.Doc, suffix: string) => {
      const block = doc.getXmlFragment('content').get(0)
      assert.ok(block instanceof Y.XmlElement)
      const text = block.get(0)
      assert.ok(text instanceof Y.XmlText)
      text.insert(text.length, suffix)
      return Buffer.from(Y.encodeStateAsUpdate(doc, baseVector)).toString('base64')
    }
    const postUpdate = async (update: string) => {
      const response = await app.client.post(
        documentBase + '/push',
        new Blob([JSON.stringify({ update })], { type: 'application/json' }),
      )
      assert.equal(response.status, 200, await response.clone().text())
      const ack = (await response.json()) as Row
      assert.equal(ack.ok, true)
      return ack
    }
    await postUpdate(append(clientA, ' Alpha'))
    // An independent author sends an update based on the earlier snapshot.
    const updateB = append(clientB, ' Beta')
    const ackB = await postUpdate(updateB)
    assert.match(String(((ackB.record as Row).page as Row).content), /Alpha/)
    assert.match(String(((ackB.record as Row).page as Row).content), /Beta/)
    const replayB = await postUpdate(updateB)
    assert.equal(((replayB.record as Row).page as Row).version, ((ackB.record as Row).page as Row).version)
    const headingTitle = ((ackB.record as Row).page as Row).title
    const bodyBlock = new Y.XmlElement('block'),
      bodyText = new Y.XmlText()
    bodyBlock.setAttribute('type', 'p')
    bodyBlock.setAttribute('id', 'body-after-title')
    clientB.getXmlFragment('content').insert(clientB.getXmlFragment('content').length, [bodyBlock])
    bodyBlock.insert(0, [bodyText])
    bodyText.insert(0, 'Body must not become part of the document title')
    const withBody = await postUpdate(
      Buffer.from(Y.encodeStateAsUpdate(clientB, baseVector)).toString('base64'),
    )
    assert.equal(((withBody.record as Row).page as Row).title, headingTitle)
    const currentPages = await call('flow.workspace.bootstrap', {
      projectId: project.id,
      route: 'page',
      recordId: createdDocument.id,
    })
    const currentPage = (currentPages.pages as Row[]).find((p) => p.id === createdDocument.id)!
    assert.equal(currentPage.title, headingTitle)
    assert.equal(
      (currentPage.blocks as Row[])[0]!.text,
      headingTitle,
      'SSR outline metadata follows the canonical snapshot',
    )
    assert.equal(
      (currentPage.blocks as Row[]).at(-1)!.text,
      'Body must not become part of the document title',
    )
    assert.equal(currentPage.liveDoc, null, 'an obsolete genesis snapshot cannot flash after reload')
    clientA.destroy()
    clientB.destroy()
    for (let i = 0; i < 3; i++) {
      const created = await call('flow.issue.save', {
        projectId: project.id,
        title: `Task ${i}`,
        idempotencyKey: `task-${i}`,
      })
      assert.equal(created.ok, true, JSON.stringify(created))
    }
    const page = await call('flow.issue.list', { projectId: project.id, limit: 2 })
    assert.equal(page.total, 6)
    assert.equal(
      (page.metrics as Row).total,
      6,
      'metrics count the entire collection before its two-row page',
    )
    const fullOverview = await call('flow.workspace.bootstrap', {
      projectId: project.id,
      route: 'workspace-overview',
    })
    assert.equal(((fullOverview.projectMetrics as Row)[String(project.id)] as Row).total, 6)
    assert.equal((page.tasks as Row[]).length, 2)
    assert.ok(page.cursor)
    assert.equal((page.tasks as Row[])[0].summary, true)
    assert.equal(Object.hasOwn((page.tasks as Row[])[0], 'description'), false)
    const next = await call('flow.issue.list', { projectId: project.id, limit: 2, cursor: page.cursor })
    assert.equal((next.tasks as Row[]).length, 2)
    assert.deepEqual(next.metrics, page.metrics)
    const crossedCursor = await call('flow.issue.list', {
      projectId: project.id,
      limit: 2,
      query: 'different filter',
      cursor: page.cursor,
    })
    assert.equal((crossedCursor.errors as Row[])[0]!.code, 'conflict')
    const cursorPosition = JSON.parse(Buffer.from(String(page.cursor), 'base64url').toString()) as Row
    for (const patch of [
      { due: ['2026-10-13'] },
      { due: '2026-02-30' },
      { sequence: Number.MAX_SAFE_INTEGER },
    ]) {
      const cursor = Buffer.from(JSON.stringify({ ...cursorPosition, ...patch })).toString('base64url')
      const refused = await call('flow.issue.list', { projectId: project.id, cursor })
      assert.equal(
        (refused.fields as Row).cursor,
        'invalid',
        'malformed positions are validation failures, never database defects',
      )
    }
    assert.equal(new Set([...(page.tasks as Row[]), ...(next.tasks as Row[])].map((t) => t.id)).size, 4)
    assert.equal(
      Object.values(page.statusCounts as Row).reduce<number>((n, count) => n + Number(count), 0),
      6,
    )
    const allTasks = async () =>
      (await call('flow.issue.list', { projectId: project.id, limit: 100 })).tasks as Row[]
    const beforeSort = await allTasks()
    const orderingCases = [
      ['normal', null],
      ['normal', '2025-01-02'],
      ['high', '2025-01-01'],
      ['urgent', null],
      ['urgent', '2025-01-01'],
      ['normal', '2025-01-01'],
    ]
    for (const [index, task] of beforeSort.entries()) {
      const saved = await call('flow.issue.save', {
        id: task.id,
        expectedVersion: task.version,
        priority: orderingCases[index]![0],
        dueDate: orderingCases[index]![1],
        startDate: null,
        assigneeIds: ['owner'],
        idempotencyKey: 'sort-case-' + index,
      })
      assert.equal(saved.ok, true, JSON.stringify(saved))
    }
    const collectSorted = async (sort: string, mine = false) => {
      let cursor: unknown,
        collected: Row[] = []
      do {
        const page = await call('flow.issue.list', { projectId: project.id, sort, mine, limit: 1, cursor })
        assert.equal(page.ok, undefined, JSON.stringify(page))
        assert.equal(page.total, 6)
        collected.push(...(page.tasks as Row[]))
        cursor = page.cursor
      } while (cursor)
      return collected.map((task) => task.id)
    }
    for (const mine of [false, true]) {
      assert.deepEqual(
        await collectSorted('due', mine),
        [4, 2, 5, 1, 3, 0].map((i) => beforeSort[i]!.id),
      )
      assert.deepEqual(
        await collectSorted('priority', mine),
        [4, 3, 2, 5, 1, 0].map((i) => beforeSort[i]!.id),
      )
    }
    const calendarInput = {
      projectId: project.id,
      route: 'calendar',
      sort: 'due',
      dueFrom: '2025-01-01',
      dueTo: '2025-01-01',
      includeUndated: true,
      limit: 2,
    }
    let calendarCursor: unknown,
      calendarTasks: Row[] = []
    do {
      const window = await call('flow.issue.list', { ...calendarInput, cursor: calendarCursor })
      assert.equal(window.total, 5, 'filter dates before the cursor and count, with undated last')
      calendarTasks.push(...(window.tasks as Row[]))
      calendarCursor = window.cursor
    } while (calendarCursor)
    assert.deepEqual(
      calendarTasks.map((t) => t.id),
      [4, 2, 5, 3, 0].map((i) => beforeSort[i]!.id),
    )
    const calendarCursorFence = (await call('flow.issue.list', calendarInput)).cursor
    for (const change of [{ dueTo: '2025-01-02' }, { includeUndated: false }]) {
      assert.equal(
        (
          (await call('flow.issue.list', { ...calendarInput, ...change, cursor: calendarCursorFence }))
            .errors as Row[]
        )[0]!.code,
        'conflict',
      )
    }
    for (const change of [{ dueTo: undefined }, { dueTo: '2025-03-01' }]) {
      assert.equal(
        ((await call('flow.issue.list', { ...calendarInput, ...change })).errors as Row[])[0]!.code,
        'validation',
      )
    }
    await assert.rejects(
      call('flow.issue.list', { ...calendarInput, dueFrom: '2025-02-30' }),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 422,
    )
    const deadlineRead = await call('flow.issue.list', {
      workspaceId: workspace.id,
      projectId: project.id,
      route: 'workspace-overview',
      limit: 1,
    })
    const deadlines = deadlineRead.deadlineCounts as Row
    assert.deepEqual(deadlineRead.peopleMetrics, [
      { member: { id: 'owner', name: 'owner' }, open: 6, overdue: 4 },
    ])
    assert.equal(deadlines.overdue, 4, 'undated task is not overdue; count is before the one-row window')
    assert.equal(deadlines.dueSoon, 0)
    assert.equal(Object.keys(deadlines.days as Row).length, 14)
    const overdueInput = {
      workspaceId: workspace.id,
      unfinishedOnly: true,
      dueBefore: deadlines.today,
      sort: 'due',
      limit: 2,
    }
    const overduePreview = await call('flow.issue.list', overdueInput)
    assert.equal(overduePreview.total, 4)
    assert.equal(
      ((await call('flow.issue.list', { ...overdueInput, mine: true })).errors as Row[])[0]!.code,
      'validation',
    )
    assert.equal((overduePreview.tasks as Row[]).length, 2)
    assert.equal(
      (
        (
          await call('flow.issue.list', {
            ...overdueInput,
            dueBefore: '2025-01-03',
            cursor: overduePreview.cursor,
          })
        ).errors as Row[]
      )[0]!.code,
      'conflict',
    )
    assert.equal(
      (
        (await call('flow.issue.list', { ...overdueInput, dueFrom: deadlines.today, dueTo: deadlines.today }))
          .errors as Row[]
      )[0]!.code,
      'validation',
    )
    const original = (await allTasks()).slice(0, 4)
    const dayAt = (offset: number) =>
      new Date(Date.parse(String(deadlines.today)) + offset * 86400000).toISOString().slice(0, 10)
    const states = fullOverview.columns as Row[]
    const doneState = states.find((c) => c.kind === 'done')!
    for (const [index, task] of original.entries()) {
      const saved = await call('flow.issue.save', {
        id: task.id,
        expectedVersion: task.version,
        dueDate: dayAt([0, 6, 13, 0][index]!),
        startDate: null,
        ...(index === 3 ? { columnId: doneState.id } : {}),
        idempotencyKey: 'deadline-horizon-' + index,
      })
      assert.equal(saved.ok, true, JSON.stringify(saved))
    }
    const horizon = (
      await call('flow.issue.list', {
        workspaceId: workspace.id,
        projectId: project.id,
        route: 'workspace-overview',
        limit: 1,
      })
    ).deadlineCounts as Row
    const peopleAfterDone = (
      await call('flow.workspace.bootstrap', {
        workspaceId: workspace.id,
        projectId: project.id,
        route: 'workspace-overview',
      })
    ).peopleMetrics as Row[]
    assert.equal(peopleAfterDone[0]!.open, 5, 'Done tasks are excluded from per-person workload')
    assert.equal(peopleAfterDone[0]!.overdue, 2, 'per-person overdue counts are independent of preview/order')
    assert.equal(horizon.dueSoon, 2, 'seven-day horizon excludes later day13 and the done task on today')
    assert.equal((horizon.days as Row)[dayAt(0)], 1)
    assert.equal((horizon.days as Row)[dayAt(6)], 1)
    assert.equal((horizon.days as Row)[dayAt(13)], 1)
    const todayPreview = await call('flow.issue.list', {
      workspaceId: workspace.id,
      unfinishedOnly: true,
      dueFrom: deadlines.today,
      dueTo: deadlines.today,
      limit: 8,
    })
    assert.equal(todayPreview.total, 1)
    assert.equal((todayPreview.tasks as Row[])[0]!.id, original[0]!.id)
    for (const [index, task] of original.entries()) {
      const restored = await call('flow.issue.save', {
        id: task.id,
        expectedVersion: Number(task.version) + 1,
        dueDate: task.dueDate,
        columnId: task.columnId,
        startDate: null,
        idempotencyKey: 'deadline-restore-' + index,
      })
      assert.equal(restored.ok, true, JSON.stringify(restored))
    }
    const sortedCursor = (await call('flow.issue.list', { projectId: project.id, sort: 'due', limit: 1 }))
      .cursor
    assert.equal(
      (
        (await call('flow.issue.list', { projectId: project.id, sort: 'priority', cursor: sortedCursor }))
          .errors as Row[]
      )[0]!.code,
      'conflict',
    )
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(
        `UPDATE flow_task_assignee SET due=NULL, priority=NULL WHERE "companyId"=?
        AND "taskId"=(SELECT id FROM flow_task WHERE "companyId"=? AND key=?)`,
        ['company-a', 'company-a', beforeSort[0]!.id],
      )
    })
    assert.equal(
      (
        (await call('flow.issue.list', { projectId: project.id, mine: true, sort: 'due' })).errors as Row[]
      )[0]!.code,
      'unavailable',
      'pending read-model backfill is explicit, never an incomplete list',
    )
    await app.fixture.withTenant('', async ({ adapter }) => {
      assert.equal((await backfillNativeFlowAssignmentOrder(adapter, 'company-a')).changed, 1)
      assert.equal((await backfillNativeFlowAssignmentOrder(adapter, 'company-a')).changed, 0)
    })
    assert.deepEqual(
      await collectSorted('due', true),
      [4, 2, 5, 1, 3, 0].map((i) => beforeSort[i]!.id),
    )
    for (const task of beforeSort) {
      const current = (await call('flow.issue.detail', { id: task.id })).task as Row
      assert.equal(
        (
          await call('flow.issue.save', {
            id: task.id,
            expectedVersion: current.version,
            priority: task.priority,
            dueDate: task.dueDate,
            startDate: task.startDate,
            assigneeIds: task.assigneeIds,
            idempotencyKey: 'restore-sort-' + task.id,
          })
        ).ok,
        true,
      )
    }
    assert.equal(
      (
        (await call('flow.issue.list', { projectId: project.id, sort: 'due', cursor: sortedCursor }))
          .errors as Row[]
      )[0]!.code,
      'conflict',
    )
    const orderRevision = async () =>
      (await call('flow.workspace.bootstrap', { projectId: project.id, route: 'list' })).taskOrderRevision
    let order = await allTasks()
    const last = order.at(-1)!
    const reorder = {
      id: last.id,
      targetId: order[0]!.id,
      position: 'before',
      groupBy: 'none',
      groupValue: '',
      expectedVersion: last.version,
      expectedOrderRevision: await orderRevision(),
      idempotencyKey: 'reorder-first',
    }
    const reordered = await call('flow.issue.reorder', reorder)
    assert.equal(reordered.ok, true, JSON.stringify(reordered))
    assert.deepEqual(await call('flow.issue.reorder', reorder), reordered)
    assert.equal((await allTasks())[0]!.id, last.id)
    const orderConflict = await call('flow.issue.reorder', {
      ...reorder,
      expectedVersion: Number(last.version) + 1,
      idempotencyKey: 'order-stale',
    })
    assert.equal((orderConflict.errors as Row[])[0].code, 'conflict')
    // Repeated insertion in one gap forces local rebalance; all untouched relative
    // positions and task/assignee projections must remain consistent.
    const anchor = order[0]!.id,
      alternates = [order[1]!.id, order[2]!.id]
    for (let i = 0; i < 13; i++) {
      order = await allTasks()
      const task = order.find((t) => t.id === alternates[i % 2])!
      const expected = order.filter((t) => t.id !== task.id).map((t) => t.id)
      expected.splice(expected.indexOf(anchor), 0, task.id)
      const moved = await call('flow.issue.reorder', {
        id: task.id,
        targetId: anchor,
        position: 'before',
        groupBy: 'none',
        groupValue: '',
        expectedVersion: task.version,
        expectedOrderRevision: await orderRevision(),
        idempotencyKey: `dense-reorder-${i}`,
      })
      assert.equal(moved.ok, true, JSON.stringify(moved))
      const actual = await allTasks()
      assert.deepEqual(
        actual.map((t) => t.id),
        expected,
      )
      assert.equal(new Set(actual.map((t) => t.order)).size, actual.length)
    }
    order = await allTasks()
    protectedTask = String(order[1]!.id)
    const batch = {
      id: order[0]!.id,
      ids: [order[0]!.id, order[1]!.id],
      expectedVersions: Object.fromEntries(order.slice(0, 2).map((t) => [String(t.id), t.version])),
      expectedOrderRevision: await orderRevision(),
      position: 'after',
      groupBy: 'priority',
      groupValue: 'urgent',
      idempotencyKey: 'guarded-reorder',
    }
    const refusedReorder = await call('flow.issue.reorder', batch)
    assert.equal(refusedReorder.ok, false, JSON.stringify(refusedReorder))
    assert.equal((refusedReorder.errors as Row[])[0].code, 'blocked')
    assert.deepEqual(await allTasks(), order)
    assert.equal(await orderRevision(), batch.expectedOrderRevision)
    protectedTask = ''
    const grouped = await call('flow.issue.reorder', {
      ...batch,
      groupBy: 'assignee',
      groupValue: 'user:member',
      idempotencyKey: 'assign-reorder',
    })
    assert.equal(grouped.ok, true, JSON.stringify(grouped))
    const mine = (
      await second.call<Row>('flow.issue.list', { projectId: project.id, mine: true, limit: 100 })
    ).value.tasks as Row[]
    assert.deepEqual(
      mine.map((t) => t.id),
      order.slice(0, 2).map((t) => t.id),
    )
    assert.ok(mine.every((t) => (t.assigneeIds as string[]).includes('member')))
    const privateProject = await call('flow.project.save', {
      workspaceId: workspace.id,
      title: 'Private delivery',
      code: 'PRIVATE',
      access: 'private',
      expectedRevision: (await call('flow.workspace.bootstrap', { route: 'workspaces' }))
        .organizationRevision,
      idempotencyKey: 'private-order-project',
    })
    assert.equal(privateProject.ok, true, JSON.stringify(privateProject))
    const hidden = await call('flow.issue.save', {
      projectId: privateProject.id,
      title: 'Private task',
      idempotencyKey: 'private-order-task',
    })
    assert.equal(hidden.ok, true, JSON.stringify(hidden))
    const visibleBefore = await allTasks()
    const hiddenRevision = await orderRevision()
    const mixedScope = (
      await second.call<Row>('flow.issue.reorder', {
        id: visibleBefore[0]!.id,
        ids: [visibleBefore[0]!.id, hidden.id],
        expectedVersions: {
          [String(visibleBefore[0]!.id)]: visibleBefore[0]!.version,
          [String(hidden.id)]: hidden.version,
        },
        expectedOrderRevision: hiddenRevision,
        position: 'before',
        groupBy: 'none',
        groupValue: '',
        idempotencyKey: 'cross-project-reorder',
      })
    ).value
    assert.equal(mixedScope.ok, false, JSON.stringify(mixedScope))
    assert.equal((mixedScope.errors as Row[])[0].code, 'forbidden')
    assert.deepEqual(await allTasks(), visibleBefore)
    assert.equal(await orderRevision(), hiddenRevision)
    const requiredField = await call('flow.field.save', {
      projectId: project.id,
      title: 'Required before completion',
      kind: 'text',
      required: true,
      expectedRevision: (await call('flow.workspace.bootstrap', { route: 'workspaces' }))
        .organizationRevision,
      idempotencyKey: 'required-field',
    })
    assert.equal(requiredField.ok, true, JSON.stringify(requiredField))
    const numericField = await call('flow.field.save', {
      projectId: project.id,
      title: 'Numeric',
      kind: 'number',
      required: false,
      expectedRevision: (await call('flow.workspace.bootstrap', { route: 'workspaces' }))
        .organizationRevision,
      idempotencyKey: 'numeric-field',
    })
    const booleanField = await call('flow.field.save', {
      projectId: project.id,
      title: 'Boolean',
      kind: 'boolean',
      required: false,
      expectedRevision: (await call('flow.workspace.bootstrap', { route: 'workspaces' }))
        .organizationRevision,
      idempotencyKey: 'boolean-field',
    })
    assert.equal(numericField.ok, true, JSON.stringify(numericField))
    assert.equal(booleanField.ok, true, JSON.stringify(booleanField))
    const unfinished = await call('flow.issue.save', {
      projectId: project.id,
      title: 'Incomplete field',
      idempotencyKey: 'incomplete-field-task',
    })
    assert.equal(unfinished.ok, true, 'A required completion field must not prevent a draft task')
    const doneColumn = (
      (await call('flow.workspace.bootstrap', { projectId: project.id, route: 'list' })).columns as Row[]
    ).find((c) => c.kind === 'done')!
    const missingMove = await call('flow.issue.move', {
      id: unfinished.id,
      columnId: doneColumn.id,
      expectedVersion: unfinished.version,
      idempotencyKey: 'missing-field-move',
    })
    assert.equal(missingMove.ok, false, JSON.stringify(missingMove))
    assert.equal((missingMove.errors as Row[])[0].code, 'validation')
    const formInput = {
      projectId: project.id,
      title: 'Complete field',
      customFields: {
        [String(requiredField.id)]: 'Ready',
        [String(numericField.id)]: '0',
        [String(booleanField.id)]: false,
      },
      idempotencyKey: 'filled-field-task',
    }
    const typedForm = resolveFlowCommand(
      'flow.issue.save',
      prepareFlowCommand('flow.issue.save', formInput, {}),
    )
    const filled = await call(typedForm.name, typedForm.input)
    assert.equal(filled.ok, true, JSON.stringify(filled))
    assert.equal(
      (((await call('flow.issue.detail', { id: filled.id })).task as Row).fieldValues as Row)[
        String(requiredField.id)
      ],
      'Ready',
    )
    assert.deepEqual(await call(typedForm.name, typedForm.input), filled)
    const filledDetail = (await call('flow.issue.detail', { id: filled.id })).task as Row
    assert.deepEqual(filledDetail.customFields, {
      [String(requiredField.id)]: 'Ready',
      [String(numericField.id)]: 0,
      [String(booleanField.id)]: false,
    })
    const fieldSummaries = (await call('flow.issue.list', { projectId: project.id, limit: 100 }))
      .tasks as Row[]
    assert.ok(
      fieldSummaries.every((t) => !Object.hasOwn(t, 'customFields') && !Object.hasOwn(t, 'fieldValues')),
    )
    const bulkFields = await call('flow.issue.bulk', {
      ids: [filled.id, unfinished.id],
      action: 'move',
      value: doneColumn.id,
      idempotencyKey: 'bulk-completion-fields',
    })
    assert.equal(bulkFields.applied, 1)
    assert.deepEqual(bulkFields.refused, [{ id: unfinished.id, code: 'validation' }])
    assert.equal(((await call('flow.issue.detail', { id: unfinished.id })).task as Row).version, 1)
    assert.equal(((await call('flow.issue.detail', { id: filled.id })).task as Row).columnId, doneColumn.id)
    const statusEvents = (detail: Row) =>
      (detail.history as Row[]).filter((event) =>
        (event.changes as Row[] | undefined)?.some((change) => change.field === 'status'),
      )
    assert.equal(
      statusEvents(await call('flow.issue.detail', { id: filled.id })).length,
      1,
      'bulk applied status records one committed diff',
    )
    assert.equal(
      statusEvents(await call('flow.issue.detail', { id: unfinished.id })).length,
      0,
      'bulk refusal must not invent history',
    )

    const dated = await call('flow.issue.save', {
      projectId: project.id,
      title: 'Clearable dates',
      startDate: '2026-10-01',
      dueDate: '2026-10-10',
      idempotencyKey: 'dated-task',
    })
    assert.equal(dated.ok, true, JSON.stringify(dated))
    const cleared = await call('flow.issue.save', {
      id: dated.id,
      startDate: '2026-10-20',
      dueDate: null,
      expectedVersion: dated.version,
      idempotencyKey: 'clear-task-date',
    })
    assert.equal(cleared.ok, true, JSON.stringify(cleared))
    assert.equal(((cleared.record as Row).task as Row).dueDate, null)
    assert.equal(((cleared.record as Row).task as Row).startDate, '2026-10-20')
    const kanbanSprint = await call('flow.sprint.save', {
      projectId: project.id,
      title: 'No sprint in Kanban',
      start: '2026-10-01',
      end: '2026-10-10',
      idempotencyKey: 'kanban-sprint',
    })
    assert.equal(kanbanSprint.ok, false, JSON.stringify(kanbanSprint))
    assert.equal((kanbanSprint.errors as Row[])[0].code, 'archived')
    const epicInput = {
      projectId: project.id,
      title: 'Release readiness',
      ownerId: 'owner',
      outcome: 'Release checks accepted',
      start: '2026-10-09',
      end: '2026-10-23',
      idempotencyKey: 'typed-epic',
    }
    for (const [patch, field] of [
      [{ ownerId: 'unknown-person' }, 'ownerId'],
      [{ outcome: ' ' }, 'outcome'],
      [{ end: '2026-10-01' }, 'end'],
      [{ start: null }, 'start'],
    ] as const) {
      const invalid = await call('flow.epic.save', {
        ...epicInput,
        ...patch,
        idempotencyKey: 'invalid-epic-' + field,
      })
      assert.equal(invalid.ok, false, JSON.stringify(invalid))
      assert.ok((invalid.fields as Row)[field], field)
    }
    const epic = await call('flow.epic.save', epicInput)
    assert.equal(epic.ok, true, JSON.stringify(epic))
    assert.deepEqual(await call('flow.epic.save', epicInput), epic)
    const editedEpic = await call('flow.epic.save', {
      id: epic.id,
      title: 'Renamed readiness',
      expectedVersion: epic.version,
      idempotencyKey: 'rename-epic',
    })
    assert.equal(editedEpic.ok, true, JSON.stringify(editedEpic))
    const epicRecord = (
      (await call('flow.workspace.bootstrap', { projectId: project.id, route: 'epics' })).epics as Row[]
    ).find((e) => e.id === epic.id)!
    assert.equal(epicRecord.ownerId, 'owner')
    assert.equal(epicRecord.owner, 'owner')
    assert.equal(epicRecord.outcome, epicInput.outcome)
    assert.equal(epicRecord.start, epicInput.start)
    const movedEpic = await call('flow.epic.save', {
      id: epic.id,
      projectId: privateProject.id,
      expectedVersion: editedEpic.version,
      idempotencyKey: 'move-epic-refused',
    })
    assert.equal(movedEpic.ok, false)
    assert.equal((movedEpic.fields as Row).projectId, 'immutable')
    const sprintProject = await call('flow.project.save', {
      workspaceId: workspace.id,
      title: 'Sprint delivery',
      code: 'SPRINT',
      sprintCadence: { weeks: 1, weekday: 1 },
      expectedRevision: (await call('flow.workspace.bootstrap', { route: 'workspaces' }))
        .organizationRevision,
      idempotencyKey: 'sprint-project',
    })
    assert.equal(sprintProject.ok, true, JSON.stringify(sprintProject))
    const sprintOne = await call('flow.sprint.save', {
      projectId: sprintProject.id,
      title: 'Sprint 1',
      start: '2026-10-12',
      end: '2026-10-18',
      idempotencyKey: 'sprint-one',
    })
    const sprintTwo = await call('flow.sprint.save', {
      projectId: sprintProject.id,
      title: 'Sprint 2',
      start: '2026-10-19',
      end: '2026-10-25',
      idempotencyKey: 'sprint-two',
    })
    assert.equal(sprintOne.ok, true, JSON.stringify(sprintOne))
    assert.equal(sprintTwo.ok, true, JSON.stringify(sprintTwo))
    const sprintChoices = await call('flow.project.taskOptions', { projectId: sprintProject.id })
    assert.deepEqual(
      (sprintChoices.sprints as Row[]).map((s) => s.id),
      [sprintOne.id, sprintTwo.id],
      'new tasks can select planned sprints from their project',
    )
    const duplicateSprint = await call('flow.sprint.save', {
      projectId: sprintProject.id,
      title: 'sprint 1',
      start: '2026-10-26',
      end: '2026-11-01',
      idempotencyKey: 'sprint-duplicate',
    })
    assert.equal(duplicateSprint.ok, false, JSON.stringify(duplicateSprint))
    assert.equal((duplicateSprint.fields as Row).title, 'duplicate')
    const sprintTasks: Row[] = []
    for (const [title, points] of [
      ['Completed', 5],
      ['Carry', 3],
      ['Removed', 2],
    ] as const) {
      const t = await call('flow.issue.save', {
        projectId: sprintProject.id,
        title,
        points,
        sprintId: sprintOne.id,
        idempotencyKey: 'sprint-task-' + title,
      })
      assert.equal(t.ok, true, JSON.stringify(t))
      sprintTasks.push(t)
    }
    const started = await call('flow.sprint.start', {
      id: sprintOne.id,
      expectedVersion: sprintOne.version,
      idempotencyKey: 'sprint-start',
    })
    assert.equal(started.ok, true, JSON.stringify(started))
    const secondActive = await call('flow.sprint.start', {
      id: sprintTwo.id,
      expectedVersion: sprintTwo.version,
      idempotencyKey: 'second-sprint-start',
    })
    assert.equal(secondActive.ok, false, JSON.stringify(secondActive))
    assert.equal((secondActive.errors as Row[])[0].code, 'sprint_active')
    const sprintContext = await call('flow.workspace.bootstrap', {
      projectId: sprintProject.id,
      route: 'list',
    })
    const sprintDone = (sprintContext.columns as Row[]).find((c) => c.kind === 'done')!
    const completedTask = await call('flow.issue.move', {
      id: sprintTasks[0]!.id,
      columnId: sprintDone.id,
      expectedVersion: sprintTasks[0]!.version,
      idempotencyKey: 'sprint-complete-task',
    })
    assert.equal(completedTask.ok, true, JSON.stringify(completedTask))
    assert.equal(((completedTask.record as Row).task as Row).points, 5)
    const movedHistory = statusEvents(completedTask.record as Row)
    assert.equal(movedHistory.length, 1)
    assert.equal(movedHistory[0]!.version, 2)
    assert.equal((movedHistory[0]!.changes as Row[])[0]!.after, sprintDone.id)
    const moveAgain = await call('flow.issue.move', {
      id: sprintTasks[0]!.id,
      columnId: sprintDone.id,
      expectedVersion: sprintTasks[0]!.version,
      idempotencyKey: 'sprint-complete-task',
    })
    assert.equal(statusEvents(moveAgain.record as Row).length, 1, 'move replay does not append history')
    const staleMove = await call('flow.issue.move', {
      id: sprintTasks[0]!.id,
      columnId: sprintDone.id,
      expectedVersion: 1,
      idempotencyKey: 'stale-history-move',
    })
    assert.equal(staleMove.ok, false)
    assert.equal(statusEvents(await call('flow.issue.detail', { id: sprintTasks[0]!.id })).length, 1)

    assert.equal(
      (
        await call('flow.issue.archive', {
          reason: 'Synthetic archive verification',
          id: sprintTasks[2]!.id,
          expectedVersion: sprintTasks[2]!.version,
          idempotencyKey: 'remove-committed-task',
        })
      ).ok,
      true,
    )
    const addedTask = await call('flow.issue.save', {
      projectId: sprintProject.id,
      title: 'Added after commitment',
      points: 4,
      sprintId: sprintOne.id,
      idempotencyKey: 'added-sprint-task',
    })
    assert.equal(addedTask.ok, true, JSON.stringify(addedTask))
    const invalidArchiveTask = await call('flow.issue.save', {
      projectId: sprintProject.id,
      title: 'Archive requires a reason',
      idempotencyKey: 'archive-reason-task',
    })
    const beforeInvalidArchive = await call('flow.issue.detail', { id: invalidArchiveTask.id })
    for (const reason of [undefined, null, '', '   ']) {
      const refusedArchive = await call('flow.issue.archive', {
        id: invalidArchiveTask.id,
        expectedVersion: 1,
        reason,
        idempotencyKey: 'invalid-archive-' + String(reason),
      })
      assert.equal(refusedArchive.ok, false)
      assert.equal((refusedArchive.fields as Row).reason, 'required')
      assert.deepEqual(
        await call('flow.issue.detail', { id: invalidArchiveTask.id }),
        beforeInvalidArchive,
        'refused archive must preserve task, history and version',
      )
    }
    const noOpRestore = await call('flow.issue.restore', {
      id: invalidArchiveTask.id,
      expectedVersion: 1,
      idempotencyKey: 'history-noop-restore',
    })
    assert.equal(noOpRestore.ok, true)
    assert.deepEqual(
      (await call('flow.issue.detail', { id: invalidArchiveTask.id })).history,
      beforeInvalidArchive.history,
      'equal archive state does not invent a change',
    )
    const archiveOnce = {
      id: invalidArchiveTask.id,
      expectedVersion: noOpRestore.version,
      reason: 'Synthetic replay verification',
      idempotencyKey: 'history-archive-once',
    }
    const archiveReceipt = await call('flow.issue.archive', archiveOnce)
    assert.equal(archiveReceipt.ok, true)
    assert.deepEqual(await call('flow.issue.archive', archiveOnce), archiveReceipt)
    const restoreOnce = {
      id: invalidArchiveTask.id,
      expectedVersion: archiveReceipt.version,
      idempotencyKey: 'history-restore-once',
    }
    const restoreReceipt = await call('flow.issue.restore', restoreOnce)
    assert.equal(restoreReceipt.ok, true)
    assert.deepEqual(await call('flow.issue.restore', restoreOnce), restoreReceipt)
    const archiveReplayHistory = (
      (await call('flow.issue.detail', { id: invalidArchiveTask.id })).history as Row[]
    ).filter((event) => (event.changes as Row[] | undefined)?.some((change) => change.field === 'archived'))
    assert.equal(archiveReplayHistory.length, 2, 'archive and restore replay each append only once')
    const archivedRoute = await call('flow.workspace.bootstrap', {
      route: 'issues-archived',
      projectId: sprintProject.id,
    })
    assert.ok((archivedRoute.tasks as Row[]).some((t) => t.id === sprintTasks[2]!.id))
    assert.ok((archivedRoute.tasks as Row[]).every((t) => t.archived === true))
    const closeInput = {
      id: sprintOne.id,
      expectedVersion: 2,
      carryTo: 'Sprint 2',
      idempotencyKey: 'sprint-close',
    }
    const closed = await call('flow.sprint.close', closeInput)
    assert.equal(closed.ok, true, JSON.stringify(closed))
    assert.deepEqual(await call('flow.sprint.close', closeInput), closed)
    const carriedHistory = (await call('flow.issue.detail', { id: sprintTasks[1]!.id })).history as Row[]
    const carryEvents = carriedHistory.filter((event) =>
      (event.changes as Row[] | undefined)?.some((change) => change.field === 'sprint'),
    )
    assert.equal(carryEvents.length, 1, 'sprint-close replay records carry-over only once')
    assert.deepEqual(carryEvents[0]!.changes, [
      { field: 'sprint', before: sprintOne.id, after: sprintTwo.id },
    ])
    assert.equal(carryEvents[0]!.version, 2)
    const archiveEvents = (
      (await call('flow.issue.detail', { id: sprintTasks[2]!.id })).history as Row[]
    ).filter((event) => (event.changes as Row[] | undefined)?.some((change) => change.field === 'archived'))
    assert.equal(archiveEvents.length, 1)
    assert.deepEqual(archiveEvents[0]!.changes, [{ field: 'archived', before: false, after: true }])

    const closedSprint = (
      (await call('flow.workspace.bootstrap', { projectId: sprintProject.id, route: 'sprints' }))
        .sprints as Row[]
    ).find((s) => s.id === sprintOne.id)!
    assert.equal(closedSprint.report, undefined, 'bootstrap must not carry closed report bodies')
    assert.equal(closedSprint.closeReport, undefined)
    const reportRead = await call('flow.sprint.report', {
      id: sprintOne.id,
      projectId: sprintProject.id,
      limit: 1,
    })
    assert.equal((reportRead.tasks as Row[]).length, 1)
    assert.equal(reportRead.total, 3)
    assert.ok(reportRead.cursor)
    const report = reportRead.report as Row
    assert.equal(report.tasks, undefined)
    assert.equal(report.taskIds, undefined)
    assert.equal(report.completedPoints, 5)
    assert.equal(report.committedPoints, 10)
    assert.equal(report.completed, 1)
    assert.equal(report.carried, 2)
    assert.equal(report.added, 1)
    assert.equal(report.removed, 1)
    assert.equal(((await call('flow.issue.detail', { id: addedTask.id })).task as Row).sprintId, sprintTwo.id)
    const carriedDetail = (await call('flow.issue.detail', { id: sprintTasks[1]!.id })).task as Row
    await call('flow.issue.save', {
      id: carriedDetail.id,
      points: 100,
      expectedVersion: carriedDetail.version,
      idempotencyKey: 'edit-carried-task',
    })
    const frozenReport = await call('flow.sprint.report', {
      id: sprintOne.id,
      projectId: sprintProject.id,
      limit: 1,
    })
    assert.deepEqual(frozenReport, reportRead)
    const remainingReport = await call('flow.sprint.report', {
      id: sprintOne.id,
      limit: 2,
      cursor: reportRead.cursor,
    })
    assert.equal((remainingReport.tasks as Row[]).length, 2)
    assert.equal(remainingReport.cursor, null)
    assert.equal(
      new Set([...(reportRead.tasks as Row[]), ...(remainingReport.tasks as Row[])].map((t) => t.id)).size,
      3,
    )
    for (const value of [null, [], { offset: 10000, fence: 'invalid' }]) {
      const bad = await call('flow.sprint.report', {
        id: sprintOne.id,
        cursor: Buffer.from(JSON.stringify(value)).toString('base64url'),
      })
      assert.equal((bad.errors as Row[])[0]!.code, 'validation')
    }
    const other = app.client.anonymous()
    await other.login({ login: 'outsider', password: 'local-test-password' })
    const deniedReport = (await other.call<Row>('flow.sprint.report', { id: sprintOne.id })).value
    assert.equal((deniedReport.errors as Row[])[0]!.code, 'forbidden')
    const denied = (await other.call<Row>('flow.issue.detail', { id: first.id })).value
    assert.equal((denied.errors as Row[])[0].code, 'forbidden')
    const deniedWrite = (
      await other.call<Row>('flow.issue.save', {
        id: first.id,
        title: 'Forbidden',
        expectedVersion: 2,
        idempotencyKey: 'forbidden',
      })
    ).value
    assert.equal((deniedWrite.errors as Row[])[0].code, 'forbidden')
    const deniedReorder = (
      await other.call<Row>('flow.issue.reorder', { ...reorder, idempotencyKey: 'denied-reorder' })
    ).value
    assert.equal((deniedReorder.errors as Row[])[0].code, 'forbidden')
    const deniedStatusOptions = (
      await other.call<Row>('flow.project.statusOptions', { projectId: project.id })
    ).value
    assert.equal((deniedStatusOptions.errors as Row[])[0]!.code, 'forbidden')
    const deniedTaskOptions = (await other.call<Row>('flow.project.taskOptions', { projectId: project.id }))
      .value
    assert.equal(deniedTaskOptions.ok, false, 'unauthorized composer catalog must be refused')
    assert.equal((deniedTaskOptions.errors as Row[])[0]!.code, 'forbidden')
    assert.equal((await other.get('/flow/files/' + uploadId)).status, 403)
    assert.equal((await other.get('/files/' + uploadId)).status >= 400, true)
    assert.equal((await other.get(documentBase + '/content')).status, 403)
    assert.equal(
      (
        await other.post(
          documentBase + '/push',
          new Blob([JSON.stringify({ update: live.snapshot })], { type: 'application/json' }),
        )
      ).status,
      403,
    )
    assert.equal(((await call('flow.issue.detail', { id: first.id })).task as Row).title, 'Edited task')
    const timeline = await call('flow.issue.detail', { id: first.id })
    assert.ok((timeline.history as Row[]).every((entry) => entry.person && entry.text && entry.time))
    assert.ok((timeline.history as Row[]).some((entry) => entry.messageKey === 'flow.history.updated'))
    assert.ok(
      (timeline.history as Row[]).some(
        (entry) =>
          Array.isArray(entry.changes) &&
          (entry.changes as Row[]).some(
            (change) => change.field === 'title' && change.after === 'Edited task',
          ),
      ),
      'timeline changes come from committed before/after values',
    )
    const activityTask = await call('flow.issue.save', {
      projectId: project.id,
      title: 'Activity paging',
      idempotencyKey: 'activity-paging',
    })
    assert.equal(
      (
        await call('flow.issue.comment', {
          id: activityTask.id,
          text: 'Original comment',
          idempotencyKey: 'activity-comment',
        })
      ).ok,
      true,
    )
    await app.fixture.withTenant('', async ({ adapter }) => {
      for (let i = 0; i < 105; i++) {
        const id = 'activity-' + String(i).padStart(3, '0')
        await adapter.run(
          `INSERT INTO flow_task_comment (id, "companyId", "taskId", "authorId", text, "contentDoc", "createdAt", version)
          SELECT ?, "companyId", "taskId", "authorId", ?, NULL, ?, 1 FROM flow_task_comment WHERE "taskId"=(SELECT id FROM flow_task WHERE key=?) LIMIT 1`,
          [id, 'Comment ' + i, '2026-10-14T00:00:00.000Z', activityTask.id],
        )
        await adapter.run(
          `INSERT INTO flow_task_history (id, "companyId", "taskId", "projectId", "workspaceId", "actorId", kind, description, metadata, "createdAt")
          SELECT ?, "companyId", "taskId", "projectId", NULL, "actorId", 'transferred', ?, ?, ? FROM flow_task_history WHERE "taskId"=(SELECT id FROM flow_task WHERE key=?) LIMIT 1`,
          [
            id,
            'History ' + i,
            JSON.stringify(
              i === 0 ? 'former-private-project' : { sourceProjectId: 'former-private-project' },
            ),
            '2026-10-14T00:00:00.000Z',
            activityTask.id,
          ],
        )
      }
    })
    const activityDetail = await call('flow.issue.detail', { id: activityTask.id })
    for (const kind of ['comments', 'history']) {
      assert.equal((activityDetail[kind] as Row[]).length, 50)
      const pages = (activityDetail.task as Row).activityPages as Row
      const ids = (activityDetail[kind] as Row[]).map((item) => item.id)
      let cursor = (pages[kind] as Row).cursor
      const firstCursor = cursor
      while (cursor) {
        const page = await call('flow.issue.activity', { id: activityTask.id, kind, cursor, limit: 23 })
        assert.ok(Array.isArray(page.items), JSON.stringify(page))
        assert.ok((page.items as Row[]).length <= 23)
        assert.ok(!JSON.stringify(page.items).includes('former-private-project'))
        for (const item of page.items as Row[]) {
          assert.equal((item.metadata as Row | undefined)?.sourceProjectId, undefined)
          if (kind === 'history') assert.equal(item.projectId, project.id)
          ids.push(item.id)
        }
        cursor = page.cursor
      }
      assert.equal(ids.length, (pages[kind] as Row).total)
      assert.equal(new Set(ids).size, ids.length)
      assert.ok(ids.length > 100)
      const wrongKind = await call('flow.issue.activity', {
        id: activityTask.id,
        kind: kind === 'comments' ? 'history' : 'comments',
        cursor: firstCursor,
      })
      assert.equal((wrongKind.errors as Row[])[0]!.code, 'conflict')
      const deniedActivity = (
        await other.call<Row>('flow.issue.activity', { id: activityTask.id, kind, cursor: firstCursor })
      ).value
      assert.equal((deniedActivity.errors as Row[])[0]!.code, 'forbidden')
    }
    const oldActivityCursor = ((activityDetail.task as Row).activityPages as Row).comments as Row
    assert.equal(
      (
        await call('flow.issue.comment', {
          id: activityTask.id,
          text: 'New comment',
          idempotencyKey: 'activity-new-comment',
        })
      ).ok,
      true,
    )
    const staleActivity = await call('flow.issue.activity', {
      id: activityTask.id,
      kind: 'comments',
      cursor: oldActivityCursor.cursor,
    })
    assert.equal((staleActivity.errors as Row[])[0]!.code, 'conflict')
    const malformedActivity = await call('flow.issue.activity', {
      id: activityTask.id,
      kind: 'comments',
      cursor: 'x'.repeat(2049),
    })
    assert.equal((malformedActivity.errors as Row[])[0]!.code, 'validation')
    const boundaryTarget = await call('flow.issue.save', {
      projectId: project.id,
      title: 'Dependency window target',
      idempotencyKey: 'dependency-window-target',
    })
    const outside: Row[] = []
    for (let i = 0; i < 12; i++)
      outside.push(
        await call('flow.issue.save', {
          projectId: project.id,
          title: 'Outside blocker ' + i,
          idempotencyKey: 'outside-blocker-' + i,
        }),
      )
    assert.equal(
      (
        await call('flow.issue.save', {
          id: boundaryTarget.id,
          expectedVersion: 1,
          blockerIds: outside.map((t) => t.id),
          idempotencyKey: 'dependency-window-link',
        })
      ).ok,
      true,
    )
    const blockedWindow = await call('flow.issue.list', {
      projectId: project.id,
      query: 'Dependency window target',
      limit: 1,
    })
    const summary = (blockedWindow.tasks as Row[])[0]!
    assert.equal(summary.blocked, true)
    assert.equal(summary.blockerCount, 12)
    assert.equal((summary.blockedBy as string[]).length, 3)
    assert.equal(
      (((await call('flow.issue.detail', { id: boundaryTarget.id })).task as Row).blockedBy as string[])
        .length,
      12,
    )
    assert.equal(
      (
        await call('flow.issue.archive', {
          reason: 'Synthetic archive verification',
          id: outside[0]!.id,
          expectedVersion: 1,
          idempotencyKey: 'dependency-window-archive',
        })
      ).ok,
      true,
    )
    const changedWindow = await call('flow.issue.list', {
      projectId: project.id,
      query: 'Dependency window target',
      limit: 1,
    })
    assert.equal((changedWindow.tasks as Row[])[0]!.blockerCount, 11)
    // Put sprint members beyond the initial 50-row window. Aggregates must not
    // depend on the preview, and archived tasks must not be carried/count again.
    const totalSprint = await call('flow.sprint.save', {
      projectId: sprintProject.id,
      title: 'Aggregate boundary',
      start: '2027-01-04',
      end: '2027-01-10',
      idempotencyKey: 'totals-sprint',
    })
    assert.equal(totalSprint.ok, true, JSON.stringify(totalSprint))
    const totalEpic = await call('flow.epic.save', {
      ...epicInput,
      projectId: sprintProject.id,
      title: 'Z Epic boundary',
      idempotencyKey: 'totals-epic',
    })
    assert.equal(totalEpic.ok, true, JSON.stringify(totalEpic))
    const epicContext = await call('flow.workspace.bootstrap', {
      projectId: sprintProject.id,
      route: 'epic',
      recordId: totalEpic.id,
    })
    const milestone = (epicContext.taskTypes as Row[]).find((t) => t.code === 'milestone')!
    assert.ok(milestone)
    let totalTask: Row = {}
    for (let i = 0; i < 52; i++) {
      totalTask = await call('flow.issue.save', {
        projectId: sprintProject.id,
        title: 'Aggregate task ' + i,
        points: 2.5,
        sprintId: totalSprint.id,
        epicId: totalEpic.id,
        ...(i >= 40 ? { typeId: milestone.id } : {}),
        idempotencyKey: 'aggregate-task-' + i,
      })
      assert.equal(totalTask.ok, true, JSON.stringify(totalTask))
    }
    assert.equal(
      (
        await call('flow.issue.move', {
          id: totalTask.id,
          expectedVersion: totalTask.version,
          columnId: sprintDone.id,
          idempotencyKey: 'aggregate-complete',
        })
      ).ok,
      true,
    )
    const archivedAggregate = await call('flow.issue.save', {
      projectId: sprintProject.id,
      title: 'Archived aggregate',
      points: 99,
      sprintId: totalSprint.id,
      idempotencyKey: 'aggregate-archived',
    })
    assert.equal(
      (
        await call('flow.issue.archive', {
          reason: 'Synthetic archive verification',
          id: archivedAggregate.id,
          expectedVersion: archivedAggregate.version,
          idempotencyKey: 'archive-aggregate',
        })
      ).ok,
      true,
    )
    const totalsView = await call('flow.workspace.bootstrap', {
      projectId: sprintProject.id,
      route: 'sprints',
    })
    assert.equal((totalsView.tasks as Row[]).length, 50)
    assert.ok(
      !(totalsView.tasks as Row[]).some((t) => t.id === totalTask.id),
      'completed task is outside preview',
    )
    const expectedTotals = { total: 52, done: 1, points: 130, pending: 51, pendingPoints: 127.5 }
    assert.deepEqual(
      (totalsView.sprints as Row[]).find((s) => s.id === totalSprint.id)!.taskTotals,
      expectedTotals,
    )
    const overviewTotals = await call('flow.workspace.bootstrap', {
      projectId: sprintProject.id,
      route: 'workspace-overview',
    })
    assert.deepEqual(
      (overviewTotals.sprints as Row[]).find((s) => s.id === totalSprint.id)!.taskTotals,
      expectedTotals,
    )
    const filteredTotals = await call('flow.workspace.bootstrap', {
      projectId: sprintProject.id,
      route: 'sprint-close',
      recordId: totalSprint.id,
      query: 'no-such-task',
    })
    assert.equal((filteredTotals.tasks as Row[]).length, 0)
    assert.deepEqual(
      (filteredTotals.sprints as Row[]).find((s) => s.id === totalSprint.id)!.taskTotals,
      expectedTotals,
    )
    let planningCursor: unknown,
      planningRows: Row[] = []
    do {
      const page = await call('flow.issue.list', {
        projectId: sprintProject.id,
        sprintId: totalSprint.id,
        unfinishedOnly: true,
        limit: 10,
        cursor: planningCursor,
      })
      assert.equal(page.total, 51)
      assert.ok(
        (page.tasks as Row[]).every((t) => t.sprintId === totalSprint.id && t.status !== sprintDone.id),
      )
      planningRows.push(...(page.tasks as Row[]))
      if (!planningCursor) {
        const crossed = await call('flow.issue.list', {
          projectId: sprintProject.id,
          backlog: true,
          unfinishedOnly: true,
          limit: 10,
          cursor: page.cursor,
        })
        assert.equal((crossed.errors as Row[])[0]!.code, 'conflict')
      }
      planningCursor = page.cursor
    } while (planningCursor)
    assert.equal(new Set(planningRows.map((t) => t.id)).size, 51)
    for (const milestonesOnly of [false, true]) {
      let cursor: unknown,
        rows: Row[] = []
      do {
        const page = await call('flow.issue.list', {
          projectId: sprintProject.id,
          epicId: totalEpic.id,
          milestonesOnly,
          cursor,
          limit: 10,
        })
        assert.equal(page.total, milestonesOnly ? 12 : 52, JSON.stringify(page))
        assert.ok(
          (page.tasks as Row[]).every(
            (t) => t.epicId === totalEpic.id && (!milestonesOnly || t.type === 'milestone'),
          ),
        )
        rows.push(...(page.tasks as Row[]))
        cursor = page.cursor
        if (cursor) {
          const wrong = await call('flow.issue.list', {
            projectId: sprintProject.id,
            epicId: totalEpic.id,
            milestonesOnly: !milestonesOnly,
            cursor,
            limit: 10,
          })
          assert.equal((wrong.errors as Row[])[0]!.code, 'conflict')
        }
      } while (cursor)
      assert.equal(new Set(rows.map((t) => t.id)).size, milestonesOnly ? 12 : 52)
    }
    const invalidMilestones = await call('flow.issue.list', {
      projectId: sprintProject.id,
      milestonesOnly: true,
    })
    assert.equal((invalidMilestones.errors as Row[])[0]!.code, 'validation')

    const badPlanning = await call('flow.issue.list', {
      projectId: sprintProject.id,
      sprintId: totalSprint.id,
      mine: true,
    })
    assert.equal((badPlanning.errors as Row[])[0]!.code, 'validation')
    for (let i = 0; i < 101; i++) {
      const start = new Date(Date.UTC(2030, 0, 7 + i * 7)).toISOString().slice(0, 10)
      const end = new Date(Date.UTC(2030, 0, 11 + i * 7)).toISOString().slice(0, 10)
      const future = await call('flow.sprint.save', {
        projectId: sprintProject.id,
        title: 'Future sprint ' + i,
        start,
        end,
        idempotencyKey: 'future-sprint-' + i,
      })
      assert.equal(future.ok, true, JSON.stringify(future))
      const laterEpic = await call('flow.epic.save', {
        ...epicInput,
        projectId: sprintProject.id,
        title: 'Later epic ' + i,
        idempotencyKey: 'later-epic-' + i,
      })
      assert.equal(laterEpic.ok, true, JSON.stringify(laterEpic))
    }
    const directEpic = await call('flow.workspace.bootstrap', {
      projectId: sprintProject.id,
      route: 'epic',
      recordId: totalEpic.id,
    })
    assert.equal((directEpic.epics as Row[]).length, 101)
    assert.ok((directEpic.epics as Row[]).some((e) => e.id === totalEpic.id))
    const directReport = await call('flow.workspace.bootstrap', {
      projectId: sprintProject.id,
      route: 'sprint-report',
      recordId: sprintOne.id,
    })
    assert.equal((directReport.sprints as Row[]).length, 101)
    assert.ok((directReport.sprints as Row[]).some((s) => s.id === sprintOne.id))
    assert.ok(
      (directReport.sprints as Row[]).every(
        (s) => !Object.hasOwn(s, 'report') && !Object.hasOwn(s, 'closeReport'),
      ),
    )
    const projectUsageLabel = await call('flow.tag.save', {
      title: 'Project usage proof',
      domain: 'project',
      color: 'blue',
      idempotencyKey: 'project-usage-label',
    })
    assert.equal(projectUsageLabel.ok, true, JSON.stringify(projectUsageLabel))
    const projectUsageContext = await call('flow.workspace.bootstrap', {
      route: 'project-profile',
      projectId: project.id,
    })
    const projectForUsage = (projectUsageContext.projects as Row[]).find((p) => p.id === project.id)!
    const projectAssigned = await call('flow.project.save', {
      id: project.id,
      tags: [projectUsageLabel.id],
      expectedVersion: projectForUsage.version,
      expectedRevision: projectUsageContext.organizationRevision,
      idempotencyKey: 'project-usage-add',
    })
    assert.equal(projectAssigned.ok, true, JSON.stringify(projectAssigned))
    const projectUsageRead = await call('flow.workspace.bootstrap', {
      route: 'tags',
      query: 'no matching preview task',
    })
    assert.deepEqual((projectUsageRead.labelUsage as Record<string, Row>)[String(projectUsageLabel.id)], {
      tasks: 0,
      projects: 1,
    })
    const usageLabel = await call('flow.tag.save', {
      title: 'Full-scope label proof',
      domain: 'task',
      color: 'blue',
      idempotencyKey: 'usage-label',
    })
    assert.equal(usageLabel.ok, true, JSON.stringify(usageLabel))
    const tagged = await call('flow.issue.save', {
      projectId: project.id,
      title: 'Visible labeled task',
      tagIds: [usageLabel.id],
      idempotencyKey: 'visible-label-task',
    })
    assert.equal(tagged.ok, true, JSON.stringify(tagged))
    const hiddenTagged = await call('flow.issue.save', {
      projectId: privateProject.id,
      title: 'Private labeled task',
      tagIds: [usageLabel.id],
      idempotencyKey: 'private-label-task',
    })
    assert.equal(hiddenTagged.ok, true, JSON.stringify(hiddenTagged))
    const readUsage = async (member = false) => {
      const input = { route: 'tags', query: 'no matching preview task' }
      const data = member
        ? (await second.call<Row>('flow.workspace.bootstrap', input)).value
        : await call('flow.workspace.bootstrap', input)
      assert.equal((data.tasks as Row[]).length, 0)
      return (data.labelUsage as Record<string, Row>)[String(usageLabel.id)]!
    }
    assert.deepEqual(await readUsage(), { tasks: 2, projects: 0 })
    assert.deepEqual(
      await readUsage(true),
      { tasks: 1, projects: 0 },
      'private project usage is not disclosed',
    )
    const archivedTagTask = await call('flow.issue.archive', {
      reason: 'Synthetic archive verification',
      id: tagged.id,
      expectedVersion: 1,
      idempotencyKey: 'usage-archive',
    })
    assert.equal(archivedTagTask.ok, true, JSON.stringify(archivedTagTask))
    assert.equal((await readUsage()).tasks, 1)
    assert.equal((await readUsage(true)).tasks, 0)
    assert.equal(
      (
        await call('flow.issue.restore', {
          id: tagged.id,
          expectedVersion: 2,
          idempotencyKey: 'usage-restore',
        })
      ).ok,
      true,
    )
    assert.equal((await readUsage()).tasks, 2)
    const labelPreview = await call('flow.issue.relocation.preview', {
      id: tagged.id,
      targetProjectId: privateProject.id,
      mode: 'transfer',
    })
    assert.equal(labelPreview.ok, true, JSON.stringify(labelPreview))
    const labelMove = {
      id: tagged.id,
      targetProjectId: privateProject.id,
      sourceProjectId: labelPreview.sourceProjectId,
      expectedVersion: labelPreview.sourceVersion,
      impactDigest: labelPreview.impactDigest,
      idempotencyKey: 'usage-transfer',
    }
    const transferredLabel = await call('flow.issue.transfer', labelMove)
    assert.equal(transferredLabel.ok, true, JSON.stringify(transferredLabel))
    assert.deepEqual(await call('flow.issue.transfer', labelMove), transferredLabel)
    assert.equal((await readUsage()).tasks, 2)
    assert.equal((await readUsage(true)).tasks, 0, 'transfer moves label read scope in the same transaction')
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(
        'UPDATE flow_task_label SET "projectId"=NULL, archived=NULL WHERE "companyId"=? AND "labelId"=?',
        ['company-a', usageLabel.id],
      )
    })
    const pendingLabels = await call('flow.workspace.bootstrap', { route: 'tags' })
    assert.equal((pendingLabels.errors as Row[])[0]!.code, 'unavailable')
    await app.fixture.withTenant('', async ({ adapter }) => {
      assert.equal((await backfillNativeFlowLabelScope(adapter, 'company-a')).changed, 2)
      assert.equal((await backfillNativeFlowLabelScope(adapter, 'company-a')).changed, 0)
    })
    assert.equal((await readUsage()).tasks, 2)
    const blockerOne = await call('flow.issue.save', {
      projectId: privateProject.id,
      title: 'First prerequisite',
      idempotencyKey: 'blocked-source-one',
    })
    const blockerTwo = await call('flow.issue.save', {
      projectId: privateProject.id,
      title: 'Second prerequisite',
      idempotencyKey: 'blocked-source-two',
    })
    assert.equal(blockerOne.ok, true, JSON.stringify(blockerOne))
    assert.equal(blockerTwo.ok, true, JSON.stringify(blockerTwo))
    const blockedTarget = await call('flow.issue.save', {
      projectId: privateProject.id,
      title: 'Blocked target',
      blockerIds: [blockerOne.id, blockerTwo.id],
      idempotencyKey: 'blocked-target',
    })
    assert.equal(blockedTarget.ok, true, JSON.stringify(blockedTarget))
    const readBlocked = async () => {
      const value = await call('flow.workspace.bootstrap', {
        route: 'workspace-overview',
        projectId: privateProject.id,
        query: 'no matching task',
      })
      assert.notEqual(value.ok, false, JSON.stringify(value))
      assert.equal((value.tasks as Row[]).length, 0)
      return value.blockedCounts as Row
    }
    assert.deepEqual(
      await readBlocked(),
      { total: 1, projects: { [String(privateProject.id)]: 1 } },
      'two edges count one target',
    )
    const memberBlocked = (
      await second.call<Row>('flow.workspace.bootstrap', {
        route: 'workspace-overview',
        workspaceId: workspace.id,
      })
    ).value
    assert.equal(((memberBlocked.blockedCounts as Row).projects as Row)[String(privateProject.id)], undefined)
    const privateCatalog = await call('flow.workspace.bootstrap', {
      route: 'settings',
      projectId: privateProject.id,
    })
    const privateDone = (privateCatalog.columns as Row[]).find((c) => c.kind === 'done')!
    assert.equal(
      (
        await call('flow.issue.save', {
          id: blockerOne.id,
          columnId: privateDone.id,
          expectedVersion: 1,
          idempotencyKey: 'blocked-source-done',
        })
      ).ok,
      true,
    )
    assert.equal((await readBlocked()).total, 1)
    assert.equal(
      (
        await call('flow.issue.archive', {
          reason: 'Synthetic archive verification',
          id: blockerTwo.id,
          expectedVersion: 1,
          idempotencyKey: 'blocked-source-archive',
        })
      ).ok,
      true,
    )
    assert.equal((await readBlocked()).total, 0, 'Done and archived prerequisites no longer block')
    assert.equal(
      (
        await call('flow.issue.restore', {
          id: blockerTwo.id,
          expectedVersion: 2,
          idempotencyKey: 'blocked-source-restore',
        })
      ).ok,
      true,
    )
    assert.equal((await readBlocked()).total, 1)
    assert.equal(
      (
        await call('flow.issue.archive', {
          reason: 'Synthetic archive verification',
          id: blockedTarget.id,
          expectedVersion: 1,
          idempotencyKey: 'blocked-target-archive',
        })
      ).ok,
      true,
    )
    assert.equal((await readBlocked()).total, 0)
    assert.equal(
      (
        await call('flow.issue.restore', {
          id: blockedTarget.id,
          expectedVersion: 2,
          idempotencyKey: 'blocked-target-restore',
        })
      ).ok,
      true,
    )
    assert.equal((await readBlocked()).total, 1)
    const removeBlocker = {
      id: blockedTarget.id,
      target: blockerTwo.id,
      remove: true,
      expectedVersion: 3,
      idempotencyKey: 'blocked-unlink',
    }
    const removedBlocker = await call('flow.issue.dependency', removeBlocker)
    assert.equal(removedBlocker.ok, true, JSON.stringify(removedBlocker))
    assert.deepEqual(await call('flow.issue.dependency', removeBlocker), removedBlocker)
    assert.equal((await readBlocked()).total, 0)
    const linkedAgain = await call('flow.issue.dependency', {
      id: blockedTarget.id,
      target: blockerTwo.id,
      expectedVersion: 4,
      idempotencyKey: 'blocked-relink',
    })
    assert.equal(linkedAgain.ok, true, JSON.stringify(linkedAgain))
    assert.equal((await readBlocked()).total, 1)
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run('UPDATE flow_task_relation SET ready=NULL WHERE "companyId"=? AND kind=?', [
        'company-a',
        'blocks',
      ])
    })
    const pendingRelations = await call('flow.workspace.bootstrap', {
      route: 'workspace-overview',
      workspaceId: workspace.id,
    })
    assert.equal((pendingRelations.errors as Row[])[0]!.code, 'unavailable')
    await app.fixture.withTenant('', async ({ adapter }) => {
      assert.ok((await backfillNativeFlowDependencyScope(adapter, 'company-a')).changed >= 2)
      assert.equal((await backfillNativeFlowDependencyScope(adapter, 'company-a')).changed, 0)
    })
    assert.equal((await readBlocked()).total, 1)
    const readRisk = async (risk: string, extra: Row = {}) => {
      const value = await call('flow.risk.list', {
        workspaceId: workspace.id,
        projectId: privateProject.id,
        risk,
        ...extra,
      })
      assert.notEqual(value.ok, false, JSON.stringify(value))
      return value
    }
    const onlyBlocked = await readRisk('blocked')
    assert.equal(onlyBlocked.total, 1)
    assert.equal((onlyBlocked.tasks as Row[])[0]!.id, blockedTarget.id)
    assert.equal((onlyBlocked.tasks as Row[])[0]!.summary, true)
    assert.equal(
      (
        await call('flow.issue.save', {
          id: blockedTarget.id,
          expectedVersion: (onlyBlocked.tasks as Row[])[0]!.version,
          dueDate: '2000-01-01',
          startDate: null,
          idempotencyKey: 'risk-due-target',
        })
      ).ok,
      true,
    )
    const beforeRisk = await readRisk('all')
    assert.equal(beforeRisk.total, 1, 'overdue and blocked target is a distinct union')
    assert.equal((beforeRisk.metrics as Row).overdue, 1)
    const riskExtras: Row[] = []
    for (let i = 0; i < 11; i++)
      riskExtras.push(
        await call('flow.issue.save', {
          projectId: privateProject.id,
          title: 'Overdue page ' + i,
          dueDate: '2000-01-01',
          startDate: null,
          idempotencyKey: 'risk-extra-' + i,
        }),
      )
    const firstRisk = await readRisk('all', { limit: 3 })
    assert.equal(firstRisk.total, 12)
    assert.ok(firstRisk.cursor)
    const crossedRisk = await call('flow.risk.list', {
      workspaceId: workspace.id,
      projectId: privateProject.id,
      risk: 'overdue',
      limit: 3,
      cursor: firstRisk.cursor,
    })
    assert.equal((crossedRisk.errors as Row[])[0]!.code, 'conflict')
    let riskCursor: unknown,
      riskRows: Row[] = []
    do {
      const page = await readRisk('all', { limit: 3, cursor: riskCursor })
      assert.equal(page.total, 12)
      riskRows.push(...(page.tasks as Row[]))
      riskCursor = page.cursor
    } while (riskCursor)
    assert.equal(new Set(riskRows.map((t) => t.id)).size, 12)
    assert.equal((await readRisk('review')).total, 0)
    const deniedRisk = (
      await second.call<Row>('flow.risk.list', { workspaceId: workspace.id, projectId: privateProject.id })
    ).value
    assert.equal((deniedRisk.errors as Row[])[0]!.code, 'forbidden')
    const memberRisk = (await second.call<Row>('flow.risk.list', { workspaceId: workspace.id, risk: 'all' }))
      .value
    assert.equal((memberRisk.projectCounts as Row)[String(privateProject.id)], undefined)
    assert.equal(
      (
        await call('flow.issue.archive', {
          reason: 'Synthetic archive verification',
          id: riskExtras[0]!.id,
          expectedVersion: 1,
          idempotencyKey: 'risk-change',
        })
      ).ok,
      true,
    )
    const staleRisk = await call('flow.risk.list', {
      workspaceId: workspace.id,
      projectId: privateProject.id,
      risk: 'all',
      cursor: firstRisk.cursor,
    })
    assert.equal((staleRisk.errors as Row[])[0]!.code, 'conflict')
    for (const cursor of [
      'bad',
      'x'.repeat(2049),
      Buffer.from(JSON.stringify({ id: 42, fence: 'bad' })).toString('base64url'),
    ]) {
      const invalid = await call('flow.risk.list', { workspaceId: workspace.id, cursor })
      assert.equal((invalid.errors as Row[])[0]!.code, 'validation')
    }
    const navigationContext = await call('flow.workspace.bootstrap', {
      route: 'my-work',
      workspaceId: workspace.id,
    })
    const listProject = await call('flow.project.save', {
      workspaceId: workspace.id,
      title: 'List first project',
      code: 'LIST',
      defaultView: 'project-issues',
      expectedRevision: navigationContext.organizationRevision,
      idempotencyKey: 'list-first-project',
    })
    assert.equal(listProject.ok, true, JSON.stringify(listProject))
    const checkDefaultView = async () => {
      for (const route of ['my-work', 'projects', 'project-profile']) {
        const value = await call('flow.workspace.bootstrap', {
          route,
          workspaceId: workspace.id,
          ...(route === 'project-profile' ? { projectId: listProject.id } : {}),
        })
        assert.equal(
          (value.projects as Row[]).find((p) => p.id === listProject.id)!.defaultView,
          'project-issues',
          route,
        )
      }
    }
    await checkDefaultView()
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run('UPDATE flow_project_record SET "defaultView"=? WHERE id=? AND "companyId"=?', [
        'list',
        listProject.id,
        'company-a',
      ])
    })
    await checkDefaultView()
    for (const defaultView of ['list', 'calendar', 'unknown']) {
      const context = await call('flow.workspace.bootstrap', {
        route: 'project-profile',
        projectId: listProject.id,
      })
      const invalid = await call('flow.project.save', {
        id: listProject.id,
        workspaceId: workspace.id,
        expectedVersion: 1,
        expectedRevision: context.organizationRevision,
        defaultView,
        idempotencyKey: 'invalid-default-' + defaultView,
      })
      assert.equal((invalid.errors as Row[])[0]!.code, 'validation')
    }
    const profileData = await call('flow.workspace.bootstrap', {
      route: 'project-profile',
      projectId: listProject.id,
    })
    const preparedProfile = resolveFlowCommand(
      'flow.entity.save',
      prepareFlowCommand(
        'flow.entity.save',
        {
          collection: 'projects',
          entityId: listProject.id,
          workspaceId: workspace.id,
          defaultView: 'project-issues',
          start: '',
          end: '',
          idempotencyKey: 'profile-empty-dates',
        },
        profileData,
      ),
    )
    const savedProfile = await call(preparedProfile.name, preparedProfile.input)
    assert.equal(savedProfile.ok, true, JSON.stringify(savedProfile))
    await checkDefaultView()
  } finally {
    await app.close()
  }
})
