import assert from 'node:assert/strict'
import test from 'node:test'
import { sqliteAdapter } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { backfillNativeFlowAssignmentOrder } from '../packages/ketsuite/src/modules/flow/native/migrations.ts'

test('assignment sort backfill is Company fenced, idempotent and refuses orphan repair', async () => {
  const url = process.env.FLOW_MIGRATION_TEST_DATABASE_URL
  if (url)
    assert.match(
      new URL(url).pathname,
      /^\/flow_core_migration_[a-z0-9_]+$/,
      'use a dedicated empty migration test database',
    )
  const adapter = url ? postgresAdapter(url, { max: 1 }) : sqliteAdapter()
  await adapter.open()
  try {
    await adapter.exec(`CREATE TABLE flow_task (id TEXT, "companyId" TEXT, due TEXT, priority TEXT);
      CREATE TABLE flow_task_assignee (id TEXT, "companyId" TEXT, "taskId" TEXT, due TEXT, priority TEXT);
      INSERT INTO flow_task VALUES ('same-id','one','2026-10-15','urgent'),('same-id','two','2026-11-20','high');
      INSERT INTO flow_task_assignee VALUES ('a','one','same-id',NULL,NULL),('b','two','same-id',NULL,NULL);`)
    assert.deepEqual(await backfillNativeFlowAssignmentOrder(adapter, 'one'), {
      companyId: 'one',
      changed: 1,
    })
    assert.equal((await backfillNativeFlowAssignmentOrder(adapter, 'one')).changed, 0)
    const rows = await adapter.all('SELECT id,due,priority FROM flow_task_assignee ORDER BY id')
    assert.deepEqual(
      Array.from(rows, (row) => ({ ...row })),
      [
        { id: 'a', due: '2026-10-15', priority: 'urgent' },
        { id: 'b', due: null, priority: null },
      ],
    )
    await adapter.exec(`INSERT INTO flow_task_assignee VALUES ('orphan','two','missing',NULL,NULL);`)
    await assert.rejects(backfillNativeFlowAssignmentOrder(adapter, 'two'), /REQUIRES_REPAIR/)
    assert.equal(
      (await adapter.all('SELECT priority FROM flow_task_assignee WHERE id=' + (url ? '$1' : '?'), ['b']))[0]!
        .priority,
      null,
      'the refusal leaves valid rows untouched as well',
    )
    await assert.rejects(backfillNativeFlowAssignmentOrder(adapter, ''), /COMPANY_REQUIRED/)
  } finally {
    await adapter.close()
  }
})
