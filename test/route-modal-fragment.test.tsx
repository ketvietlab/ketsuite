import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { modalSheet, modalWorkspace, shell } from '../packages/ketsuite/src/ui/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => false
translate.resolves = translate.has

const routeModal = () =>
  modalSheet({
    title: 'Edit tier',
    closeHref: '/admin/loyalty/tiers',
    closeLabel: 'Close',
    body: <p>tier form</p>,
  })

const contentSlot = (html: string, open: RegExp, close: string): string => {
  const start = html.search(open)
  assert.notEqual(start, -1, 'the page renders a content slot')
  const end = html.indexOf(close, start)
  assert.notEqual(end, -1, 'the content slot is closed')
  return html.slice(start, end)
}

test('route modal: fragment navigation carries the modal inside the content slot', () => {
  const html = renderToString(
    modalWorkspace(shell(translate, 'Tiers', <p>tier list</p>, { navigation: true }), routeModal()),
  )

  const content = contentSlot(html, /<template data-ket-slot="backend\.content"/, '</template>')
  assert.match(content, /tier list/)
  assert.match(content, /data-ui="modal-layer" data-route-modal="true"/)
  assert.equal(html.match(/data-route-modal="true"/g)?.length, 1)
})

test('route modal: a full page keeps the modal inside the content slot', () => {
  const html = renderToString(modalWorkspace(shell(translate, 'Tiers', <p>tier list</p>), routeModal()))

  assert.equal(html.match(/data-route-modal="true"/g)?.length, 1)
  const slot = html.search(/<div[^>]*data-ket-slot="backend\.content"/)
  assert.notEqual(slot, -1)
  assert.ok(html.indexOf('data-route-modal="true"') > slot)
})

test('route modal: a background that is not a shell is followed by the modal', () => {
  const html = renderToString(modalWorkspace(<p>tier list</p>, routeModal()))

  assert.doesNotMatch(html, /data-ket-slot/)
  assert.match(html, /tier list.*data-route-modal="true"/s)
})
