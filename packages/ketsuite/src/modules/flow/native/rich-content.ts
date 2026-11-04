import type { Row } from '@ketvietlab/ketjs'
import { refuse, string } from './policy.ts'

/** Once a durable CRDT exists, metadata writers may not replace its projection
 * or submit a local snapshot. The authenticated document route owns that write. */
export function requireDocumentTransport(current: Row | null, input: Row, page = false) {
  if (!current?.contentAttachmentId) return
  const fields: Record<string, string> = {}
  if (
    input.description !== undefined &&
    string(input.description) !== string(page ? current.body : current.description)
  )
    fields.description = 'live_document_required'
  for (const name of page ? ['blocks', 'liveDoc'] : ['descriptionDoc'])
    if (Object.hasOwn(input, name)) fields[name] = 'live_document_required'
  if (Object.keys(fields).length) return refuse('validation', fields)
}
