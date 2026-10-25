import assert from 'node:assert/strict'
import test from 'node:test'
import { sqliteAdapter } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { backfillNativeFlowLabelScope } from '../packages/ketsuite/src/modules/flow/native/migrations.ts'

test('label usage migration is Company fenced, idempotent and refuses orphan or cross-project labels atomically', async () => {
  const url = process.env.FLOW_MIGRATION_TEST_DATABASE_URL
  if (url)
    assert.match(
      new URL(url).pathname,
      /^\/flow_core_migration_[a-z0-9_]+$/,
      'dedicated empty migration database required',
    )
  const adapter = url ? postgresAdapter(url, { max: 1 }) : sqliteAdapter()
  await adapter.open()
  try {
    await adapter.exec(`CREATE TABLE flow_task (id TEXT, "companyId" TEXT, "projectId" TEXT, archived BOOLEAN);
      CREATE TABLE flow_label (id TEXT, "companyId" TEXT, "projectId" TEXT);
      CREATE TABLE flow_task_label (id TEXT, "companyId" TEXT, "taskId" TEXT, "labelId" TEXT, "projectId" TEXT, archived BOOLEAN);
      INSERT INTO flow_task VALUES ('same','one','p-one',false),('same','two','p-two',true);
      INSERT INTO flow_label VALUES ('label','one',NULL),('label','two',NULL);
      INSERT INTO flow_task_label VALUES ('a','one','same','label',NULL,NULL),('b','two','same','label',NULL,NULL);`)
    assert.deepEqual(await backfillNativeFlowLabelScope(adapter, 'one'), { companyId: 'one', changed: 1 })
    assert.equal((await backfillNativeFlowLabelScope(adapter, 'one')).changed, 0)
    const rows = await adapter.all('SELECT id,"projectId",archived FROM flow_task_label ORDER BY id')
    assert.equal(rows[0]!.projectId, 'p-one')
    assert.equal(Boolean(rows[0]!.archived), false)
    assert.equal(rows[1]!.projectId, null)
    await adapter.exec(`INSERT INTO flow_task_label VALUES ('orphan','two','missing','label',NULL,NULL)`)
    await assert.rejects(backfillNativeFlowLabelScope(adapter, 'two'), /REQUIRES_REPAIR/)
    await adapter.exec(
      `DELETE FROM flow_task_label WHERE id='orphan'; UPDATE flow_label SET "projectId"='wrong' WHERE "companyId"='two'`,
    )
    await assert.rejects(backfillNativeFlowLabelScope(adapter, 'two'), /REQUIRES_REPAIR/)
    assert.equal(
      (await adapter.all(`SELECT "projectId" FROM flow_task_label WHERE id='b'`))[0]!.projectId,
      null,
    )
    await adapter.exec(`UPDATE flow_label SET "projectId"=NULL WHERE "companyId"='two'`)
    assert.equal((await backfillNativeFlowLabelScope(adapter, 'two')).changed, 1)
    assert.equal(
      Boolean((await adapter.all("SELECT archived FROM flow_task_label WHERE id='b'"))[0]!.archived),
      true,
    )
    await assert.rejects(backfillNativeFlowLabelScope(adapter, ''), /COMPANY_REQUIRED/)
  } finally {
    await adapter.close()
  }
})
