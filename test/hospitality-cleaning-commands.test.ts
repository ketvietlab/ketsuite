import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom, user } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
const modules = [address, partner, company, storage, backend, uom, product, user, hospitalityCore]
const manifest = compose(modules, { headless: true, companies: true })
const codes = (result: Record<string, unknown>) =>
  ((result.errors as Array<{ code: string }>) ?? []).map((row) => row.code)
test('Hospitality cleaning assignment validates membership, due time, duplicates, replay and stale or finished drafts', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const call = async (name: string, args: Record<string, unknown>, companyId = 'hotel') =>
    (await roomFixtureCall(name, args, { adapter, manifest, scope: { company: companyId, branches: null } }))
      .value as Record<string, unknown>
  const must = async (name: string, args: Record<string, unknown>) => {
    const result = await call(name, args)
    assert.notEqual(result.ok, false, `${name}: ${JSON.stringify(result.errors)}`)
    return result
  }
  try {
    await must('partner.savePartner', { id: 'company-party', name: 'Hotel', kind: 'company' })
    await must('company.saveCompany', {
      id: 'hotel',
      code: 'HOTEL',
      partnerId: 'company-party',
      currency: 'VND',
    })
    for (const id of ['staff', 'other']) await must('user.createUser', { id, login: id, name: id })
    await must('user.grantCompany', { id: 'staff-hotel', userId: 'staff', companyId: 'hotel' })
    await must('hospitality_core.saveProperty', {
      id: 'hotel-property',
      code: 'HOTEL',
      name: 'Hotel',
      accommodationType: 'hotel',
      timezone: 'Asia/Ho_Chi_Minh',
    })
    await must('hospitality_core.saveRoomType', {
      id: 'type',
      propertyId: 'hotel-property',
      code: 'DLX',
      name: 'Deluxe',
      maxAdults: 2,
      maxChildren: 0,
    })
    await must('hospitality_core.saveRoom', {
      id: 'room',
      propertyId: 'hotel-property',
      roomTypeId: 'type',
      code: '101',
      name: '101',
      capacity: 2,
    })
    const input = {
      id: 'task',
      propertyId: 'hotel-property',
      roomId: 'room',
      taskType: 'checkout_clean',
      priority: 'normal',
      assigneeId: 'staff',
      dueAt: new Date(Date.now() + 7200000).toISOString(),
      expectedVersion: 0,
      requestKey: 'task-create-one',
    }
    assert.ok(
      codes(await call('hospitality_core.saveCleaningTask', { ...input, assigneeId: 'other' })).includes(
        'cleaning_assignee',
      ),
    )
    assert.ok(
      codes(
        await call('hospitality_core.saveCleaningTask', { ...input, dueAt: '2000-01-01T00:00:00Z' }),
      ).includes('cleaning_due_future'),
    )
    const saved = await must('hospitality_core.saveCleaningTask', input)
    assert.deepEqual(await call('hospitality_core.saveCleaningTask', input), saved)
    assert.ok(
      codes(
        await call('hospitality_core.saveCleaningTask', {
          ...input,
          id: 'duplicate',
          requestKey: 'task-duplicate-two',
        }),
      ).includes('cleaning_task_duplicate'),
    )
    assert.equal((await call('hospitality_core.getRoom', { id: 'room' })).status, 'dirty')
    const edited = {
      ...input,
      expectedVersion: 1,
      notes: 'Keep the room status',
      requestKey: 'task-reassign-one',
    }
    await must('hospitality_core.saveCleaningTask', edited)
    const unassigned = await must('hospitality_core.saveCleaningTask', {
      ...input,
      id: 'unassigned-inspection',
      taskType: 'inspection',
      assigneeId: null,
      requestKey: 'unassigned-room-inspection',
    })
    assert.equal(unassigned.ok, true)
    const unassignedRecord = await call('hospitality_core.getCleaningTaskRecord', {
      id: 'unassigned-inspection',
    })
    assert.equal((unassignedRecord.record as Record<string, unknown>).assigneeId, null)
    assert.ok(
      codes(
        await call('hospitality_core.saveCleaningTask', {
          ...edited,
          taskType: 'inspection',
          expectedVersion: 2,
          requestKey: 'duplicate-work-reassignment',
        }),
      ).includes('cleaning_task_duplicate'),
    )
    assert.ok(
      codes(
        await call('hospitality_core.saveCleaningTask', {
          ...edited,
          notes: 'stale',
          requestKey: 'task-reassign-stale',
        }),
      ).includes('transition_conflict'),
    )
    await must('hospitality_core.startCleaningTask', {
      id: 'task',
      expectedVersion: 2,
      requestKey: 'task-start-first',
    })
    const incomplete = await call('hospitality_core.completeCleaningTask', {
      id: 'task',
      checklist: ['linen'],
      expectedVersion: 3,
      requestKey: 'task-complete-incomplete',
    })
    assert.ok(codes(incomplete).includes('cleaning_checklist_required'))
    assert.equal((await call('hospitality_core.getCleaningTask', { id: 'task' })).state, 'in_progress')
    await must('hospitality_core.completeCleaningTask', {
      checklist: ['linen', 'bathroom', 'supplies', 'final'],
      id: 'task',
      expectedVersion: 3,
      requestKey: 'task-complete-first',
      completionNotes: 'All four checks completed',
    })
    assert.ok(
      codes(
        await call('hospitality_core.saveCleaningTask', {
          ...input,
          expectedVersion: 4,
          requestKey: 'task-finished-edit',
        }),
      ).includes('cleaning_cannot_start'),
    )
    const task = (await call('hospitality_core.getCleaningTaskRecord', { id: 'task' })).record as Record<
      string,
      unknown
    >
    assert.deepEqual(task.checklist, ['linen', 'bathroom', 'supplies', 'final'])
    assert.equal(task.completionNotes, 'All four checks completed')
    assert.equal(task.version, 4)
    assert.equal(task.notes, edited.notes)
    assert.equal((await call('hospitality_core.getCleaningTaskRecord', { id: 'task' }, 'other')).record, null)
  } finally {
    await adapter.close()
  }
})
