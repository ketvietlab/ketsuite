import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { marked } from 'marked'
import mermaid from 'mermaid'
import { configureMermaidLoader, fitDiagram } from '../packages/design-system/src/runtime/mermaid.js'
import { renderToString } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { safeMarkdownHref } from '../packages/design-system/src/content/markdown/index.tsx'
import {
  createMermaidTheme,
  hasMermaidOverrides,
} from '../packages/design-system/src/runtime/mermaid-theme.js'
import { createDemo2Routes } from '../apps/design-system/demo.tsx'

const labels = {
  table: 'Reference table',
  diagram: 'Workflow',
  source: 'View source',
  loading: 'Rendering…',
  error: 'Diagram unavailable',
}
test('the public loader accepts the pinned Mermaid engine used by the catalogue host', () => {
  configureMermaidLoader(async () => mermaid)
})
test('a shown Mermaid diagram fits its view box to the drawing in place', () => {
  const runtime = readFileSync('packages/design-system/src/runtime/mermaid.js', 'utf8')
  assert.match(runtime, /const box = typeof diagram\.getBBox === 'function' \? diagram\.getBBox\(\) : null/u)
  // Shown first, then measured: a hidden canvas has no box and keeps Mermaid's own.
  assert.match(
    runtime,
    /canvas\.hidden = false\s+fitDiagram\(diagram\)\s+const width = diagram\.viewBox\.baseVal\.width/u,
  )
})

test('fitting a Mermaid drawing discards the stale intrinsic ratio without shrinking its text', () => {
  const attributes = new Map([
    ['viewBox', '-118 -32 347 356'],
    ['width', '347'],
    ['height', '356'],
  ])
  let measured = { x: 8, y: 8, width: 252, height: 337 }
  const diagram = {
    getBBox: () => measured,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  } as unknown as SVGSVGElement
  fitDiagram(diagram)
  const [x, y, width, height] = attributes.get('viewBox')!.split(' ').map(Number)
  assert.ok(x <= measured.x && y <= measured.y)
  assert.ok(x + width >= measured.x + measured.width && y + height >= measured.y + measured.height)
  // CSS width + height:auto must take the fitted viewBox ratio, not the old renderer dimensions.
  assert.equal(attributes.has('width'), false)
  assert.equal(attributes.has('height'), false)
  const fitted = attributes.get('viewBox')
  measured = { x: 0, y: 0, width: 0, height: 0 }
  fitDiagram(diagram)
  assert.equal(attributes.get('viewBox'), fitted, 'an unmeasurable drawing retains its fallback box')
})

test('screen guidance renders GFM on the server while HTML and unsafe links remain inert', () => {
  const html = renderToString(
    <MarkdownContent
      lexer={marked.lexer}
      labels={labels}
      source={
        '## Guide\n\n**Read** _this_ and `code`.\n\n- First\n- Second\n\n| Name | Value |\n|---|---|\n| A | 1 |\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n[good](/records)\n\n```mermaid\nflowchart TD\n A --> B\n```'
      }
    />,
  )
  const output = html.replace(/<!--[\s\S]*?-->/gu, '')
  assert.match(output, /<h2>Guide/)
  assert.match(output, /<strong>Read/)
  assert.match(html, /<table>/)
  assert.match(html, /<ul>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script|href="javascript:/)
  assert.match(html, /href="\/records"/)
  assert.match(html, /data-ui="mermaid-source" open/)
  assert.match(html, /flowchart TD/)
})
test('Markdown URLs reject executable, protocol-relative and control-character destinations', () => {
  for (const input of [
    'javascript:alert(1)',
    'data:text/html,test',
    '//outside.test',
    'java\nscript:alert(1)',
    '\\outside.test',
  ])
    assert.equal(safeMarkdownHref(input), null)
  assert.equal(safeMarkdownHref('mailto:hello@example.test', true), null)
  assert.equal(safeMarkdownHref('#workflow'), '#workflow')
  assert.equal(safeMarkdownHref('https://example.test'), 'https://example.test')
})
test('help drawer is closed SSR chrome; demo content fragments own the current screen guide', () => {
  const html = renderToString(
    <HelpDrawer id="guide" label="Help" title="Sales" closeLabel="Close" body="Content" />,
  )
  assert.match(html, /<dialog data-ui="help-drawer" id="guide" aria-labelledby="guide-title">/)
  assert.doesNotMatch(html, / open/)
  assert.match(html, /data-ui="help-close"/)
  const routes = createDemo2Routes()
  for (const lang of ['vi', 'en']) {
    const fragment = String(
      routes['/demo2'](new URL(`http://localhost/demo2?view=orders&lang=${lang}`), {
        headers: { 'x-ket-navigation': 'fragment-v1' },
      }).body,
    )
    assert.match(fragment, /data-ui="help-drawer"/)
    assert.match(fragment, lang === 'vi' ? /Đang vẽ sơ đồ/ : /Rendering diagram/)
    assert.doesNotMatch(fragment, /data-ui="app-switcher"/)
  }
})
test('canonical Mermaid theme maps the same palette across diagram families and locks content overrides', () => {
  const palette = {
    background: '#ffffff',
    surface: '#f7f5f5',
    text: '#24262a',
    muted: '#5a5c63',
    line: '#74767b',
    accent: '#5145cd',
    accentSoft: '#efedfc',
    positive: '#1d5d3b',
    positiveSoft: '#ecf5ef',
    warning: '#8b5c12',
    warningSoft: '#fbf3e6',
    danger: '#b42318',
    dangerSoft: '#fef3f2',
    fontFamily: 'Inter, sans-serif',
    dark: false,
  }
  const config = createMermaidTheme(palette)
  assert.equal(config.theme, 'base')
  assert.equal(config.securityLevel, 'strict')
  assert.equal(config.htmlLabels, false)
  assert.equal(config.themeVariables.nodeTextColor, palette.text)
  assert.equal(config.themeVariables.actorBkg, palette.accentSoft)
  assert.equal(config.themeVariables.noteTextColor, palette.text)
  assert.equal(config.themeVariables.pieSectionTextColor, palette.text)
  assert.ok(config.secure.includes('themeVariables'))
  assert.match(config.themeCSS, /kv-positive/)
  for (const source of [
    '---\nconfig: {}\n---\nflowchart TD',
    '%%{init: {}}%%',
    'flowchart TD\nstyle A fill:red',
    'flowchart TD\nclick A handler',
  ])
    assert.equal(hasMermaidOverrides(source), true)
  assert.equal(hasMermaidOverrides('flowchart TD\n A --> B\n class B kv-positive'), false)
})
