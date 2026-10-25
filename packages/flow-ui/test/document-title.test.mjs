import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowDocEditor } from '../src/documents.mjs'

test('an editable document preserves its page heading and a separately named input', () => {
  const output = renderToStaticString(
    FlowDocEditor({
      title: 'Runbook <Ops>',
      subtitle: '',
      blocks: [],
      onTitle() {},
      onText() {},
      onBlur() {},
    }),
  )
  assert.match(output, /<h1 data-flow="doc-title"><span/)
  assert.doesNotMatch(output, /<h1[^>]*role="textbox"/)
  assert.match(output, /data-flow="doc-title-input"\s+role="textbox"/)
  assert.match(output, /contenteditable="plaintext-only"/)
  assert.match(output, /Runbook &lt;Ops&gt;/)
})

test('a read-only document title is a heading, without a dormant editing control', () => {
  const output = renderToStaticString(
    FlowDocEditor({
      title: 'Runbook',
      subtitle: '',
      blocks: [],
      readOnly: true,
      onTitle() {},
      onText() {},
      onBlur() {},
    }),
  )
  assert.match(output, /<h1 data-flow="doc-title">Runbook<\/h1>/)
  assert.doesNotMatch(output, /data-flow="doc-title-input"/)
})

test('a note with its title in LiveDoc has no separate title input', () => {
  const output = renderToStaticString(
    FlowDocEditor({
      title: 'Untitle',
      titleInContent: true,
      subtitle: '',
      blocks: [],
      onTitle() {},
      onText() {},
      onBlur() {},
    }),
  )
  assert.match(output, /data-in-content="true"/)
  assert.doesNotMatch(output, /data-flow="doc-title-input"/)
})
