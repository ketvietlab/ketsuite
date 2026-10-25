import { test } from 'node:test'
import assert from 'node:assert/strict'
import { floatingToolbarPosition } from '../packages/ketsuite/src/ui/client/live-doc-floating.ts'
import { liveDocShell } from '../packages/ketsuite/src/ui/client/live-doc-shell.tsx'
import { renderToString } from '@ketvietlab/ketjs-view'

test('floating formatting stays above a selection without moving document content', () => {
  assert.deepEqual(
    floatingToolbarPosition(
      { left: 500, right: 600, top: 200, bottom: 220 },
      { width: 400, height: 40 },
      { left: 0, top: 0, right: 1440, bottom: 900 },
      8,
    ),
    { left: 350, top: 152 },
  )
})

test('wrapped toolbar falls below a top selection and clamps both viewport edges', () => {
  const viewport = { left: 0, top: 0, right: 390, bottom: 700 }
  assert.deepEqual(
    floatingToolbarPosition(
      { left: 10, right: 60, top: 15, bottom: 35 },
      { width: 374, height: 140 },
      viewport,
      8,
    ),
    { left: 8, top: 43 },
  )
  assert.deepEqual(
    floatingToolbarPosition(
      { left: 380, right: 390, top: 690, bottom: 700 },
      { width: 374, height: 140 },
      viewport,
      8,
    ),
    { left: 8, top: 542 },
  )
})

test('floating geometry respects an offset visual viewport with the software keyboard', () => {
  assert.deepEqual(
    floatingToolbarPosition(
      { left: 400, right: 450, top: 140, bottom: 170 },
      { width: 300, height: 120 },
      { left: 120, top: 100, right: 480, bottom: 400 },
      8,
    ),
    { left: 172, top: 178 },
  )
})

test('the first line falls below its selection to keep document header actions reachable', () => {
  assert.deepEqual(
    floatingToolbarPosition(
      { left: 564, right: 641, top: 188, bottom: 224 },
      { width: 513, height: 42 },
      { left: 564, top: 188, right: 1156, bottom: 900 },
      8,
    ),
    { left: 572, top: 232 },
  )
})

test('floating and read-only shells hide commands on the first server render', () => {
  const floating = renderToString(liveDocShell({ containerId: 'doc', toolbar: 'floating', surface: 'plain' }))
  assert.match(floating, /data-toolbar="floating" data-surface="plain"/)
  assert.match(floating, /role="toolbar"[^>]*hidden/)
  assert.match(floating, /aria-keyshortcuts="Alt\+F10"/)
  const readOnly = renderToString(liveDocShell({ containerId: 'doc', toolbar: 'floating', readOnly: true }))
  assert.match(readOnly, /contenteditable="false"/)
  assert.doesNotMatch(readOnly, /aria-keyshortcuts/)
  const compatible = renderToString(liveDocShell({ containerId: 'doc' }))
  assert.match(compatible, /data-toolbar="top" data-surface="framed"/)
  assert.doesNotMatch(compatible, /role="toolbar"[^>]*hidden/)
})
