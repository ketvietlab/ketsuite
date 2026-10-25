import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowDocTree } from '../src/documents.mjs'
import { setFlowLocale } from '../src/i18n.mjs'

function event(node, name, title) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = event(child, name, title)
      if (found) return found
    }
    return
  }
  if (node.items && node.render)
    return event(
      node.items.map((item, i) => node.render(item, i)),
      name,
      title,
    )
  if (!node.strings) return
  const index = node.strings.findIndex((part) => part.endsWith(`on:${name}=`))
  if (index >= 0 && node.values.includes(title)) return node.values[index]
  return event(node.values, name, title)
}

test('document tree keeps the full title available when its visible label is truncated', () => {
  setFlowLocale('en')
  const title = 'A long document title about quality & reliability and access controls'
  const props = {
    items: [{ id: 'doc-a', title }],
    active: 'doc-a',
    collapsed: [],
    onOpen() {},
    onToggle() {},
  }
  for (const onReorder of [undefined, () => {}]) {
    const output = renderToStaticString(FlowDocTree({ ...props, onReorder }))
    const buttonTitle = output.match(/data-flow="doc-tree-page"[^>]*title="([^"]+)"/)?.[1]
    assert.ok(
      buttonTitle?.includes(title.replace('&', '&amp;')),
      'tooltip exposes the escaped full document title',
    )
    if (onReorder) assert.ok(buttonTitle.includes('Alt'), 'retain the keyboard instruction')
  }
})

test('document keyboard reordering changes siblings without moving across parent groups', () => {
  setFlowLocale('en')
  const moves = []
  const tree = FlowDocTree({
    items: [
      { id: 'a', title: 'First' },
      { id: 'b', title: 'Second' },
      { id: 'c', title: 'Child', parentId: 'a' },
    ],
    active: 'b',
    collapsed: [],
    onOpen() {},
    onToggle() {},
    onReorder: (...args) => moves.push(args),
  })
  let prevented = 0
  event(
    tree,
    'keydown',
    'Second',
  )({
    key: 'ArrowUp',
    altKey: true,
    preventDefault() {
      prevented++
    },
  })
  assert.deepEqual(moves, [['b', 'a', 'before']])
  assert.equal(prevented, 1)
  event(tree, 'keydown', 'Child')({ key: 'ArrowUp', altKey: true, preventDefault() {} })
  assert.equal(moves.length, 1)
})
