import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { coreRoutes } from '../packages/website-client/client/routes.ts'
import { tr } from '../packages/website-client/client/i18n.ts'
import { screenHelpSource, helpLexer, screenHelpLabels } from '../packages/website-client/client/help.tsx'
import { eventStartedInNestedModal } from '../packages/ketsuite/src/ui/client/table-selection-view.tsx'

test('every native Studio route has authored vi/en screen help', () => {
  for (const [key, route] of Object.entries(coreRoutes)) {
    for (const locale of ['vi', 'en'] as const) {
      const source = screenHelpSource(key, tr(route.title), locale)
      assert.match(source, new RegExp(locale === 'vi' ? '## Thực hiện' : '## Steps'), key)
      assert.ok(helpLexer(source).length >= 5, key)
      assert.doesNotMatch(source, /placeholder|TODO/)
    }
  }
})

test('public HelpDrawer renders a closed native dialog and safe SSR Markdown with independent heading levels', () => {
  const html = renderToString(
    <HelpDrawer
      id="screen-help"
      label="Guide"
      title="Help"
      closeLabel="Close"
      body={
        <MarkdownContent
          source={'# Title\n\n<script>alert(1)</script>'}
          lexer={helpLexer}
          labels={screenHelpLabels}
          headingOffset={1}
        />
      }
    />,
  )
  assert.match(html, /<dialog[^>]*data-ui="help-drawer"[^>]*aria-labelledby="screen-help-title"/)
  assert.doesNotMatch(html, /<dialog[^>]* open|<script>|data-route-modal="true"/)
  assert.match(html.replace(/<!--[\s\S]*?-->/gu, ''), /<h2>Title<\/h2>/)
  assert.match(html.replace(/<!--[\s\S]*?-->/gu, ''), /<p>&lt;script&gt;/)
  assert.match(html, /&lt;script&gt;/)
})

test('a native dialog keeps keyboard ownership over the route modal even after synchronous removal', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement')
  class ElementFixture {
    isConnected = true
    readonly kind: 'dialog' | 'layer' | 'control'
    constructor(kind: 'dialog' | 'layer' | 'control') {
      this.kind = kind
    }
    matches(selector: string) {
      if (this.kind === 'dialog') return selector.split(',').some((part) => part.trim() === 'dialog')
      return this.kind === 'layer' && selector.includes('[data-ui="modal-layer"]')
    }
  }
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementFixture })
  try {
    const route = new ElementFixture('layer') as unknown as HTMLElement
    const dialog = new ElementFixture('dialog')
    const control = new ElementFixture('control')
    const event = (path: unknown[]) => ({ composedPath: () => path }) as unknown as KeyboardEvent
    assert.equal(eventStartedInNestedModal(event([control, dialog, route]), route), true)
    dialog.isConnected = false
    assert.equal(eventStartedInNestedModal(event([control, dialog, route]), route), true)
    assert.equal(eventStartedInNestedModal(event([control, new ElementFixture('layer'), route]), route), true)
    assert.equal(eventStartedInNestedModal(event([control, route]), route), false)
  } finally {
    if (original) Object.defineProperty(globalThis, 'HTMLElement', original)
    else Reflect.deleteProperty(globalThis, 'HTMLElement')
  }
})
