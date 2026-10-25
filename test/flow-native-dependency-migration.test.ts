import assert from 'node:assert/strict'
import test from 'node:test'
import { sqliteAdapter } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { backfillNativeFlowDependencyScope } from '../packages/ketsuite/src/modules/flow/native/migrations.ts'

test('dependency scope backfill validates both ends, isolates Company and replays without changes', async () => {
  const url = process.env.FLOW_MIGRATION_TEST_DATABASE_URL
  if (url) assert.match(new URL(url).pathname, /^\/flow_core_migration_[a-z0-9_]+$/)
  const adapter = url ? postgresAdapter(url, { max: 1 }) : sqliteAdapter()
  await adapter.open()
  try {
    await adapter.exec(`CREATE TABLE flow_task (id TEXT, "companyId" TEXT, "projectId" TEXT, "columnId" TEXT, archived BOOLEAN, due TEXT);
      CREATE TABLE flow_task_relation (id TEXT, "companyId" TEXT, "taskId" TEXT, "targetId" TEXT, kind TEXT,
        "projectId" TEXT, "sourceStatusId" TEXT, "targetStatusId" TEXT, "sourceArchived" BOOLEAN, "targetArchived" BOOLEAN, ready BOOLEAN, "targetDue" TEXT, "riskReady" BOOLEAN);
      INSERT INTO flow_task VALUES ('s','one','p1','todo',false,NULL),('t','one','p1','progress',true,'2026-10-14'),
        ('s','two','p2','done',false,NULL),('t','two','p2','todo',false,NULL);
      INSERT INTO flow_task_relation VALUES ('a','one','s','t','blocks',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
        ('b','two','s','t','blocks',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);`)
    assert.equal((await backfillNativeFlowDependencyScope(adapter, 'one')).changed, 1)
    assert.equal((await backfillNativeFlowDependencyScope(adapter, 'one')).changed, 0)
    const rows = await adapter.all('SELECT * FROM flow_task_relation ORDER BY id')
    assert.equal(rows[0]!.projectId, 'p1')
    assert.equal(rows[0]!.sourceStatusId, 'todo')
    assert.equal(rows[0]!.targetStatusId, 'progress')
    assert.equal(rows[0]!.targetDue, '2026-10-14')
    assert.equal(Boolean(rows[0]!.riskReady), true)
    assert.equal(Boolean(rows[0]!.sourceArchived), false)
    assert.equal(Boolean(rows[0]!.targetArchived), true)
    assert.equal(rows[1]!.ready, null)
    await adapter.exec(
      `INSERT INTO flow_task_relation VALUES ('orphan','two','s','absent','blocks',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
    )
    await assert.rejects(backfillNativeFlowDependencyScope(adapter, 'two'), /REQUIRES_REPAIR/)
    await adapter.exec(
      `DELETE FROM flow_task_relation WHERE id='orphan'; UPDATE flow_task SET "projectId"='wrong' WHERE id='t' AND "companyId"='two'`,
    )
    await assert.rejects(backfillNativeFlowDependencyScope(adapter, 'two'), /REQUIRES_REPAIR/)
    assert.equal((await adapter.all("SELECT ready FROM flow_task_relation WHERE id='b'"))[0]!.ready, null)
    await adapter.exec(`UPDATE flow_task SET "projectId"='p2' WHERE id='t' AND "companyId"='two'`)
    assert.equal((await backfillNativeFlowDependencyScope(adapter, 'two')).changed, 1)
    await assert.rejects(backfillNativeFlowDependencyScope(adapter, ''), /COMPANY_REQUIRED/)
  } finally {
    await adapter.close()
  }
})
