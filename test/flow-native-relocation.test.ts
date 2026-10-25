import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { refuse } from '../packages/ketsuite/src/modules/flow/native/policy.ts'
import { everyFunction } from './helpers/permissions.ts'

test('productivity task relocation is atomic, scoped, loss-aware and replay-safe', async () => {
  let blocked = false
  let failAfterWrite = false
  const native = createFlowModule({
    extensions: [
      {
        name: 'relocation-guard-proof',
        effects: [],
        beforeMutation: async (_ctx, mutation) => {
          if (blocked && ['flow.issue.copyTo', 'flow.issue.transfer'].includes(mutation.name))
            refuse('blocked')
        },
        afterMutation: async (_ctx, mutation) => {
          if (failAfterWrite && mutation.name === 'flow.issue.transfer') refuse('blocked')
        },
      },
    ],
  })
  let stallComment = false
  let lookupHeld!: () => void, releaseLookup!: () => void
  const comment = native.functions['issue.comment']!
  const commentHandler = comment.handler!
  native.functions['issue.comment'] = {
    ...comment,
    handler: async (ctx, args) => {
      if (!stallComment) return commentHandler(ctx, args)
      let first = true
      const one = ctx.db.one.bind(ctx.db)
      const resumed = new Promise<void>((resolve) => {
        releaseLookup = resolve
      })
      const db = Object.create(ctx.db, {
        one: {
          value: async (...sql: Parameters<typeof one>) => {
            const row = await one(...sql)
            if (first) {
              first = false
              lookupHeld()
              await resumed
            }
            return row
          },
        },
      }) as typeof ctx.db
      return commentHandler({ ...ctx, db }, args)
    },
  }
  let stallDetail = false
  let detailHeld!: () => void, releaseDetail!: () => void
  const detailSpec = native.functions['issue.detail']!
  const detailHandler = detailSpec.handler!
  native.functions['issue.detail'] = {
    ...detailSpec,
    handler: async (ctx, args) => {
      if (!stallDetail) return detailHandler(ctx, args)
      let first = true
      const one = ctx.db.one.bind(ctx.db)
      const resumed = new Promise<void>((resolve) => {
        releaseDetail = resolve
      })
      const db = Object.create(ctx.db, {
        one: {
          value: async (...sql: Parameters<typeof one>) => {
            const row = await one(...sql)
            if (first) {
              first = false
              detailHeld()
              await resumed
            }
            return row
          },
        },
      }) as typeof ctx.db
      return detailHandler({ ...ctx, db }, args)
    },
  }
  const artifactsDir = await mkdtemp(join(tmpdir(), 'flow-relocation-'))
  const env = process.env.FLOW_TEST_DATABASE_URL
    ? { DATABASE_URL: process.env.FLOW_TEST_DATABASE_URL }
    : undefined
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
      createFlowWorkspaceModule(),
    ],
    serve: {
      permissions: everyFunction,
      openStore: async (config) => {
        if (!config.databaseUrl) return sqliteStore(config)
        const adapter = postgresAdapter(config.databaseUrl, { max: 2 })
        await adapter.open()
        return adapter
      },
      sessions: { anonymous: { company: 'relocation-company' } },
    },
  })
  let app = await createTestDeployment(deployment, { worker: false, artifactsDir, env })
  const ok = (r: Row) => {
    assert.equal(r.ok, true, JSON.stringify(r))
    return r
  }
  const call = async (name: string, args: Row) => (await app.client.call<Row>(name, args)).value
  const context = () => call('flow.workspace.bootstrap', { route: 'settings' })
  try {
    await app.fixture.call('partner.savePartner', {
      id: 'relocation-partner',
      kind: 'company',
      name: 'Synthetic relocation',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'relocation-company',
      partnerId: 'relocation-partner',
      currency: 'VND',
    })
    await app.fixture.call('user.saveRole', { id: 'relocation-role', name: 'Synthetic relocation role' })
    for (const fn of Object.keys(native.functions))
      if (native.functions[fn]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: 'relocation-' + fn,
          roleId: 'relocation-role',
          fnKey: 'flow.' + fn,
        })
    for (const id of ['relocation-owner', 'source-only']) {
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          name: id,
          email: id + '@example.test',
          password: 'synthetic-relocation-password',
          defaultCompanyId: 'relocation-company',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: id + ':company',
        userId: id,
        companyId: 'relocation-company',
      })
      await app.fixture.call('user.assignRole', { id: id + ':role', userId: id, roleId: 'relocation-role' })
    }
    await app.client.login({ login: 'relocation-owner', password: 'synthetic-relocation-password' })
    const w = ok(
      await call('flow.workspace.create', {
        title: 'Delivery',
        access: 'restricted',
        expectedRevision: 0,
        idempotencyKey: 'workspace',
      }),
    )
    const makeProject = async (code: string) =>
      ok(
        await call('flow.project.save', {
          workspaceId: w.id,
          title: code,
          code,
          access: 'private',
          ownerId: 'relocation-owner',
          expectedRevision: (await context()).organizationRevision,
          idempotencyKey: 'project-' + code,
        }),
      )
    const source = await makeProject('SRC'),
      target = await makeProject('DST')
    const invite = ok(
      await call('flow.member.invite', {
        email: 'source-only@example.test',
        role: 'member',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'invite-source-reader',
      }),
    )
    const token = await app.fixture.withTenant('', async ({ adapter }) => {
      const rows = await adapter.all(
        'SELECT payload FROM flow_outbox WHERE "targetId" = ' + (env ? '$1' : '?'),
        [invite.id],
      )
      return (typeof rows[0]!.payload === 'string' ? JSON.parse(rows[0]!.payload) : (rows[0]!.payload as Row))
        .token
    })
    const reader = app.client.anonymous()
    await reader.login({ login: 'source-only', password: 'synthetic-relocation-password' })
    ok((await reader.call<Row>('flow.invitation.accept', { token, idempotencyKey: 'accept-invite' })).value)
    const grant = ok(
      await call('flow.access.grant', {
        scope: 'project',
        targetId: source.id,
        subjectType: 'user',
        subjectId: 'source-only',
        role: 'member',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'grant-source',
      }),
    )
    assert.ok(grant.id)
    const makeField = async (title: string, projectId: unknown, kind: string) =>
      ok(
        await call('flow.field.save', {
          title,
          projectId,
          kind,
          required: false,
          options: [],
          idempotencyKey: 'field-' + title,
        }),
      )
    const oldField = await makeField('Source number', source.id, 'number')
    const newField = await makeField('Destination number', target.id, 'number')
    const wrongField = await makeField('Destination text', target.id, 'text')
    const sharedField = await makeField('Shared checkbox', undefined, 'checkbox')
    const saved = ok(
      await call('flow.issue.save', {
        projectId: source.id,
        title: 'Keep identity',
        description: 'Private body follows transfer only',
        assigneeIds: ['source-only'],
        fieldValues: { [String(oldField.id)]: 0, [String(sharedField.id)]: false },
        checklist: [{ id: 'step', text: 'Do not duplicate conversation', checked: false }],
        idempotencyKey: 'source-task',
      }),
    )
    ok(
      (
        await reader.call<Row>('flow.issue.follow', {
          id: saved.id,
          expectedVersion: 1,
          following: true,
          idempotencyKey: 'source-follow',
        })
      ).value,
    )
    ok(
      await call('flow.issue.comment', {
        id: saved.id,
        text: 'Original conversation',
        idempotencyKey: 'comment',
      }),
    )
    const detail = () => call('flow.issue.detail', { id: saved.id })
    const first = (await detail()).task as Row
    const version = Number(first.version)
    const file = new FormData()
    file.append('file', new Blob(['private file'], { type: 'text/plain' }), 'private.txt')
    const uploaded = await app.client.post('/flow/uploads?task=' + saved.id, file)
    assert.equal(uploaded.status, 201, await uploaded.clone().text())
    const uploadId = ((await uploaded.json()) as Row).uploadId
    ok(
      await call('flow.attachment.save', {
        taskId: saved.id,
        files: [{ uploadId }],
        idempotencyKey: 'attach',
      }),
    )
    assert.equal((await reader.get('/flow/files/' + uploadId)).status, 200)
    const previewInput = {
      id: saved.id,
      targetProjectId: target.id,
      mode: 'transfer',
      fieldMap: { [String(oldField.id)]: newField.id },
    }
    for (let i = 0; i < 101; i++) await makeProject(`PRIVATE${String(i).padStart(3, '0')}`)
    const destinations = ok(
      await call('flow.issue.relocation.options', {
        id: saved.id,
        mode: 'transfer',
        targetProjectId: target.id,
      }),
    )
    assert.equal((destinations.projects as Row[]).length, 50)
    const optionIds = new Set((destinations.projects as Row[]).map((p) => p.id))
    let optionCursor = destinations.nextCursor
    while (optionCursor) {
      const page = ok(
        await call('flow.issue.relocation.options', { id: saved.id, mode: 'transfer', cursor: optionCursor }),
      )
      for (const p of page.projects as Row[]) {
        assert.ok(!optionIds.has(p.id))
        optionIds.add(p.id)
      }
      optionCursor = page.nextCursor
    }
    assert.equal(optionIds.size, 102)
    assert.ok(optionIds.has(target.id))
    assert.ok(!(destinations.projects as Row[]).some((p) => p.id === source.id))
    assert.ok(((destinations.catalogs as Row).fields as Row[]).some((f) => f.id === newField.id))
    const restrictedOptions = (
      await reader.call<Row>('flow.issue.relocation.options', { id: saved.id, mode: 'copy' })
    ).value
    assert.equal(restrictedOptions.ok, true)
    assert.equal(
      restrictedOptions.nextCursor,
      null,
      'A cursor must not expose a private project ID from an unauthorized scan window',
    )
    assert.ok(!(restrictedOptions.projects as Row[]).some((p) => p.id === target.id))
    assert.equal(
      (
        await reader.call<Row>('flow.issue.relocation.options', {
          id: saved.id,
          mode: 'copy',
          targetProjectId: target.id,
        })
      ).value.ok,
      false,
    )
    const preview = ok(await call('flow.issue.relocation.preview', previewInput))
    assert.equal((await call('flow.issue.relocation.preview', { ...previewInput, typeId: null })).ok, true)
    assert.equal((preview.impact as Row).fieldsCarried, 2)
    assert.equal((preview.impact as Row).assigneesDropped, 1)
    assert.equal((preview.impact as Row).followersDropped, 1)
    const refusedReader = (await reader.call<Row>('flow.issue.relocation.preview', previewInput)).value
    assert.equal((refusedReader.errors as Row[])[0]!.code, 'forbidden')
    const wrong = await call('flow.issue.relocation.preview', {
      ...previewInput,
      fieldMap: { [String(oldField.id)]: wrongField.id },
    })
    assert.equal((wrong.fields as Row).fieldMap, 'kind')
    const unknown = await call('flow.issue.relocation.preview', {
      ...previewInput,
      fieldMap: { forged: newField.id },
    })
    assert.equal((unknown.fields as Row).fieldMap, 'unknown')
    const implicit = await call('flow.issue.save', {
      id: saved.id,
      projectId: target.id,
      expectedVersion: preview.sourceVersion,
      idempotencyKey: 'implicit-transfer',
    })
    assert.equal((implicit.fields as Row).projectId, 'immutable')
    const copyPreview = ok(await call('flow.issue.relocation.preview', { ...previewInput, mode: 'copy' }))
    const copyInput = {
      ...previewInput,
      mode: undefined,
      sourceProjectId: copyPreview.sourceProjectId,
      expectedVersion: copyPreview.sourceVersion,
      impactDigest: copyPreview.impactDigest,
      idempotencyKey: 'copy-task',
    }
    blocked = true
    assert.equal((await call('flow.issue.copyTo', copyInput)).ok, false)
    assert.equal((await call('flow.issue.list', { projectId: target.id })).total, 0)
    blocked = false
    const copy = ok(await call('flow.issue.copyTo', copyInput))
    const copied = (copy.record as Row).task as Row
    assert.notEqual(copy.id, saved.id)
    assert.equal(copied.description, '')
    assert.deepEqual(copied.checklist, [])
    assert.deepEqual((copy.record as Row).comments, [])
    assert.deepEqual((copy.record as Row).files, [])
    assert.deepEqual(copied.fieldValues, { [String(newField.id)]: 0, [String(sharedField.id)]: false })
    assert.equal((await call('flow.issue.copyTo', copyInput)).id, copy.id)
    assert.equal((await call('flow.issue.list', { projectId: target.id })).total, 1)
    const originalOwnerGrant = ((await context()).grants as Row[]).find(
      (g) => g.scope === 'project' && g.targetId === target.id && g.subjectId === 'relocation-owner',
    )!
    ok(
      await call('flow.access.grant', {
        scope: 'project',
        targetId: target.id,
        subjectType: 'user',
        subjectId: 'relocation-owner',
        role: 'viewer',
        expectedVersion: originalOwnerGrant.version,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'downgrade-destination-owner',
      }),
    )
    assert.equal(
      ((await call('flow.issue.detail', { id: copy.id })).task as Row).id,
      copy.id,
      'Destination remains readable',
    )
    const readOnlyReplay = await call('flow.issue.copyTo', copyInput)
    assert.equal(readOnlyReplay.ok, false, 'A cached receipt cannot bypass destination write permission')
    const readOnlyGrant = ((await context()).grants as Row[]).find((g) => g.id === originalOwnerGrant.id)!
    ok(
      await call('flow.access.grant', {
        scope: 'project',
        targetId: target.id,
        subjectType: 'user',
        subjectId: 'relocation-owner',
        role: 'admin',
        expectedVersion: readOnlyGrant.version,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'restore-destination-owner',
      }),
    )
    const mismatch = await call('flow.issue.copyTo', { ...copyInput, title: 'Changed replay' })
    assert.equal((mismatch.errors as Row[])[0]!.code, 'replay_mismatch')
    const stale = {
      ...previewInput,
      mode: undefined,
      sourceProjectId: preview.sourceProjectId,
      expectedVersion: preview.sourceVersion,
      impactDigest: preview.impactDigest,
      idempotencyKey: 'transfer',
    }
    // A membership change, even without a task version change, invalidates the loss preview.
    const destinationGrant = ok(
      await call('flow.access.grant', {
        scope: 'project',
        targetId: target.id,
        subjectType: 'user',
        subjectId: 'source-only',
        role: 'member',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'grant-target',
      }),
    )
    assert.equal((await call('flow.issue.transfer', stale)).ok, false)
    ok(
      await call('flow.access.revoke', {
        id: destinationGrant.id,
        expectedVersion: 1,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'revoke-target',
      }),
    )
    const refreshed = ok(await call('flow.issue.relocation.preview', previewInput))
    const transferInput = {
      ...stale,
      expectedVersion: refreshed.sourceVersion,
      impactDigest: refreshed.impactDigest,
    }
    failAfterWrite = true
    assert.equal((await call('flow.issue.transfer', transferInput)).ok, false)
    assert.equal(
      ((await detail()).task as Row).projectId,
      source.id,
      'Extension refusal rolls back the task and files',
    )
    assert.equal((await reader.get('/flow/files/' + uploadId)).status, 200)
    failAfterWrite = false
    const liveBase = '/flow/live/issues/' + saved.id
    const liveContent = await reader.get(liveBase + '/content')
    assert.equal(liveContent.status, 200)
    const topic = ((await liveContent.json()) as Row).topic
    const presence = async (index: number) => {
      const response = await app.client.post(liveBase + '/presence', JSON.stringify({ index }), {
        headers: { 'content-type': 'application/json' },
      })
      assert.equal(response.status, 200, await response.text())
    }
    await presence(10000)
    for (const index of [10001, 987654321]) {
      const invalid = await app.client.post(liveBase + '/presence', JSON.stringify({ index }), {
        headers: { 'content-type': 'application/json' },
      })
      assert.equal(invalid.status, 400, await invalid.text())
    }
    await presence(1)
    const stream = await reader.get(liveBase + '/live?topic=' + encodeURIComponent(String(topic)), {
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(stream.status, 200)
    const frames = stream.body!.getReader()
    const initialFrame = await frames.read()
    assert.match(new TextDecoder().decode(initialFrame.value), /"index":1/)
    const captured = new Promise<void>((resolve) => {
      lookupHeld = resolve
    })
    stallComment = true
    const racingComment = reader.call<Row>('flow.issue.comment', {
      id: saved.id,
      text: 'Must not write after ownership changes',
      idempotencyKey: 'stale-owner-comment',
    })
    await captured
    const readCaptured = new Promise<void>((resolve) => {
      detailHeld = resolve
    })
    stallDetail = true
    const racingDetail = reader.call<Row>('flow.issue.detail', { id: saved.id })
    await readCaptured
    const moved = await (async () => {
      try {
        const saved = ok(await call('flow.issue.transfer', transferInput))
        releaseLookup()
        stallComment = false
        const refused = (await racingComment).value
        assert.equal(refused.ok, false, 'A lookup before transfer cannot authorize a write after transfer')
        ok(
          await call('flow.issue.comment', {
            id: saved.id,
            text: 'Destination-only comment after transfer',
            idempotencyKey: 'destination-comment',
          }),
        )
        releaseDetail()
        stallDetail = false
        const refusedRead = (await racingDetail).value
        assert.equal(
          refusedRead.ok,
          false,
          'A captured source row cannot disclose subsequent destination data',
        )
        assert.ok(!JSON.stringify(refusedRead).includes('Destination-only comment after transfer'))
        await presence(9876)
        const nextFrame = new TextDecoder().decode((await frames.read()).value)
        assert.doesNotMatch(nextFrame, /9876/, 'An open source stream cannot receive destination-only frames')
        assert.match(nextFrame, /event: done/)
        return saved
      } finally {
        releaseLookup()
        releaseDetail()
        stallComment = false
        stallDetail = false
        await frames.cancel()
      }
    })()
    assert.equal(moved.id, saved.id, 'Transfer preserves deep-link identity')
    assert.equal(((moved.record as Row).task as Row).projectId, target.id)
    assert.equal(((moved.record as Row).task as Row).description, first.description)
    assert.deepEqual(((moved.record as Row).task as Row).assigneeIds, [])
    assert.deepEqual(((moved.record as Row).task as Row).fieldValues, copied.fieldValues)
    assert.equal(((moved.record as Row).comments as Row[]).length, 1)
    assert.equal((await app.client.get('/flow/files/' + uploadId)).status, 200)
    assert.equal((await reader.get('/flow/files/' + uploadId)).status, 403)
    assert.equal((await reader.get('/files/' + uploadId)).status >= 400, true)
    assert.equal((await reader.call<Row>('flow.issue.detail', { id: saved.id })).value.ok, false)
    ok(
      await call('flow.access.revoke', {
        id: grant.id,
        expectedVersion: 1,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'revoke-reader-source',
      }),
    )
    ok(
      await call('flow.access.grant', {
        scope: 'project',
        targetId: target.id,
        subjectType: 'user',
        subjectId: 'source-only',
        role: 'viewer',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'reader-new-owner-only',
      }),
    )
    const destinationOnlyDetail = (await reader.call<Row>('flow.issue.detail', { id: saved.id })).value
    assert.ok(
      !JSON.stringify(destinationOnlyDetail.history).includes(String(source.id)),
      'Task history does not expose its inaccessible former project',
    )
    assert.equal(
      (await reader.get('/flow/files/' + uploadId)).status,
      200,
      'A newly authorized destination reader gets the retained file',
    )
    const replay = ok(await call('flow.issue.transfer', transferInput))
    assert.equal(replay.id, moved.id)
    assert.equal(replay.version, moved.version)
    assert.equal(((await detail()).history as Row[]).filter((h) => h.kind === 'transferred').length, 1)
    assert.equal(version < Number(moved.version), true)
    const childSource = ok(
      await call('flow.issue.save', { projectId: source.id, title: 'Parent', idempotencyKey: 'parent' }),
    )
    const child = ok(
      await call('flow.issue.save', {
        projectId: source.id,
        title: 'Archived child',
        parentId: childSource.id,
        idempotencyKey: 'child',
      }),
    )
    ok(
      await call('flow.issue.archive', {
        reason: 'Synthetic archive verification',
        id: child.id,
        expectedVersion: child.version,
        idempotencyKey: 'archive-child',
      }),
    )
    const parentPreview = await call('flow.issue.relocation.preview', {
      id: childSource.id,
      targetProjectId: target.id,
      mode: 'transfer',
    })
    assert.equal((parentPreview.fields as Row).id, 'has_children')
    await app.close()
    app = await createTestDeployment(deployment, { worker: false, artifactsDir, env })
    await app.client.login({ login: 'relocation-owner', password: 'synthetic-relocation-password' })
    const durable = ok(await call('flow.issue.transfer', transferInput))
    assert.equal(durable.id, saved.id)
    assert.equal((await call('flow.issue.list', { projectId: target.id })).total, 2)
    assert.equal(await (await app.client.get('/flow/files/' + uploadId)).text(), 'private file')
  } finally {
    await app.close()
    await rm(artifactsDir, { recursive: true, force: true })
  }
})
