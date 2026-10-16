import assert from 'node:assert/strict'
import { test } from 'node:test'
import { html, renderToStaticString } from '@ketvietlab/ketjs-view'
import type { MenuNode, Translator } from '@ketvietlab/ketjs'
import { shell } from '../packages/ketsuite/src/ui/layout.tsx'
import { sidebarMain, sidebarNavigationContent } from '../packages/ketsuite/src/ui/nav.tsx'

const _ = Object.assign((key: string) => key, { locale: 'vi' }) as Translator
const leaf = (id: string, secondary = false): MenuNode => ({
  id,
  label: id,
  path: `/admin/${id}`,
  icon: null,
  active: false,
  secondary,
  children: [],
})
const menu: MenuNode[] = [
  {
    ...leaf('care'),
    active: true,
    children: [leaf('followups'), leaf('shipping'), leaf('hidden', true), leaf('zero'), leaf('invalid')],
  },
]
test('Backend navigation: authorized personal counts use the public count hook in both render paths', () => {
  const counts = { followups: 6857, shipping: 4, hidden: 900, zero: 0, invalid: -1, unrelated: 999 }
  for (const component of [sidebarMain, sidebarNavigationContent]) {
    const html = renderToStaticString(component(_, { menu, counts }))
    assert.match(html, /data-ui="navigation-item-count">6857</)
    assert.match(html, /data-ui="navigation-item-count">4</)
    assert.equal((html.match(/data-ui="navigation-item-count"/g) ?? []).length, 2)
    assert.doesNotMatch(html, />900<|>999<|>-1</)
  }
})
test('Backend navigation: no count input preserves the existing shell; invalid numbers hide', () => {
  assert.doesNotMatch(renderToStaticString(sidebarMain(_, { menu })), /navigation-item-count/)
  assert.doesNotMatch(
    renderToStaticString(sidebarMain(_, { menu, counts: { shipping: NaN, followups: 1.5, zero: Infinity } })),
    /navigation-item-count/,
  )
})

test('Backend shell: Frame counts reach the rendered navigation', () => {
  const output = renderToStaticString(
    shell(_, 'Care', html`Body`, { menu, counts: { shipping: 2 }, topbar: false }),
  )
  assert.match(output, /data-ui="navigation-item-count">2</)
})
