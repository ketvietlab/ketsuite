import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Y from 'yjs'
import {
  validFlowDocument,
  FLOW_DOCUMENT_TABLE_CELL_LIMIT,
} from '../packages/ketsuite/src/modules/flow/native/document-schema.ts'
import {
  forget,
  getOrCreateLive,
  previewTextOf,
  snapshotBlocksOf,
} from '../packages/ketsuite/src/modules/livedoc/sync.ts'

test('native Flow schema keeps supported text/table projections and rejects invisible or unbounded tables', () => {
  const ref = { company: 'flow-schema-company', kind: 'flow.Document', id: 'flow-schema' }
  try {
    const fragment = getOrCreateLive(ref).doc.getXmlFragment('content')
    const legacy = new Y.XmlText()
    fragment.insert(0, [legacy])
    legacy.insert(0, 'Legacy text')
    assert.equal(validFlowDocument(ref), true)
    const table = new Y.XmlElement('block')
    table.setAttribute('type', 'table')
    table.setAttribute(
      'rows',
      JSON.stringify([
        ['Quarter', 'Result'],
        ['Q4', 'Verified'],
      ]),
    )
    fragment.insert(1, [table])
    assert.equal(validFlowDocument(ref), false, 'structured blocks require their text node')
    table.insert(0, [new Y.XmlText()])
    assert.equal(validFlowDocument(ref), true)
    assert.match(previewTextOf(ref), /Quarter \| Result/)
    assert.match(previewTextOf(ref), /Q4 \| Verified/)
    assert.deepEqual(snapshotBlocksOf(ref)[1]!.rows, [
      ['Quarter', 'Result'],
      ['Q4', 'Verified'],
    ])
    table.setAttribute('rows', JSON.stringify({ invalid: true }))
    assert.equal(validFlowDocument(ref), false)
    table.setAttribute('rows', JSON.stringify([[12]]))
    assert.equal(validFlowDocument(ref), false)
    table.setAttribute(
      'rows',
      JSON.stringify([Array.from({ length: FLOW_DOCUMENT_TABLE_CELL_LIMIT + 1 }, () => '')]),
    )
    assert.equal(validFlowDocument(ref), false)
    table.setAttribute('rows', '[]')
    table.setAttribute('type', 'task')
    assert.equal(validFlowDocument(ref), true, 'existing native checklist alias remains writable')
    table.setAttribute('type', 'unknown-block')
    assert.equal(validFlowDocument(ref), false)
  } finally {
    forget(ref)
  }
})
