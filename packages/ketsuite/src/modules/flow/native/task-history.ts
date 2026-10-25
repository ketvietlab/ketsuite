import { randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { now } from './command.ts'
import { owned } from './policy.ts'

/** Called only inside the mutation transaction, after CAS returns the new row. */
export async function recordTaskChanges(tx: Ctx, task: Row, changes: Row[]) {
  const actual = changes.filter(
    (change) => JSON.stringify(change.before ?? null) !== JSON.stringify(change.after ?? null),
  )
  if (!actual.length) return
  const project = await owned(tx, 'flow.ProjectRecord', task.projectId)
  await tx.db.insert('flow.TaskHistory', {
    id: randomUUID(),
    taskId: task.id,
    projectId: task.projectId,
    workspaceId: project.workspaceId,
    actorId: tx.actor,
    kind: 'updated',
    description: 'Task updated',
    metadata: { version: task.version, changes: actual },
    createdAt: now(),
  })
}
