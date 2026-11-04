import * as Y from 'yjs'
import { getOrCreateLive } from '../../livedoc/sync.ts'
import type { DocRef } from '../../livedoc/sync.ts'
import { BLOCK_TYPES } from '../../../ui/client/live-doc-blocks.ts'

const types = new Set<string>([...BLOCK_TYPES, 'table', 'divider', 'image', 'task'])
export const FLOW_DOCUMENT_BLOCK_LIMIT = 10000
export const FLOW_DOCUMENT_TABLE_CELL_LIMIT = 10000

/** Current native editor schema. Bare text is the supported legacy paragraph.
 * Every structured block has one XmlText; table cells live in its rows attribute. */
export function validFlowDocument(ref: DocRef): boolean {
  const fragment = getOrCreateLive(ref).doc.getXmlFragment('content')
  if (fragment.length > FLOW_DOCUMENT_BLOCK_LIMIT) return false
  let cells = 0
  for (const node of fragment.toArray()) {
    if (node instanceof Y.XmlText) continue
    if (
      !(node instanceof Y.XmlElement) ||
      node.nodeName !== 'block' ||
      node.length !== 1 ||
      !(node.get(0) instanceof Y.XmlText)
    )
      return false
    const type = node.getAttribute('type') ?? 'p'
    if (!types.has(type)) return false
    if (type === 'table') {
      let rows: unknown
      try {
        rows = JSON.parse(node.getAttribute('rows') ?? '[]')
      } catch {
        return false
      }
      if (!Array.isArray(rows)) return false
      for (const row of rows) {
        if (!Array.isArray(row) || row.some((cell) => typeof cell !== 'string')) return false
        cells += row.length
        if (cells > FLOW_DOCUMENT_TABLE_CELL_LIMIT) return false
      }
    }
  }
  return true
}
