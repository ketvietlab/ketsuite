import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { resolveSnapshotKey, scheduleSnapshotCleanup } from './snapshots.ts'
import { readViewer } from './viewer.ts'

/** Internal DB/job capabilities, invoked only by authorized document routes.
 * Generic Fn HTTP refuses them; object I/O stays with ServeContext. */
export const functions: Record<string, FnSpec> = {
  'sync.resolveSnapshotKey': defineFn({
    input: { attachmentId: 'id?' },
    output: { storeKey: 'text?' },
    effects: ['read:storage.Attachment'],
    exposure: 'internal',
    handler: resolveSnapshotKey,
  }),
  'sync.viewer': defineFn({
    input: {},
    output: { id: 'text?', name: 'text?' },
    effects: ['read:user.User'],
    exposure: 'internal',
    handler: readViewer,
  }),
  'sync.scheduleCleanup': defineFn({
    input: {},
    effects: ['enqueue:storage.sweep'],
    exposure: 'internal',
    handler: scheduleSnapshotCleanup,
  }),
}
