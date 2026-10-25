import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { DataTable, EmptyState } from '@ketvietlab/design-system'

const SRC = 'packages/design-system/src'
const css = readFileSync(`${SRC}/primitives/feedback/styles.css`, 'utf8')
const rule = (selector: string) => {
  const found = css
    .split('}')
    .find((item) => item.trimEnd().endsWith(`${selector} {`) || item.includes(`${selector} {\n`))
  assert.ok(found, `missing rule ${selector}`)
  return found
}
const badge = (markup: string) => markup.match(/data-ui="empty-mark"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? ''

test('EmptyState draws one decorative illustration whose badge names why the region is empty', () => {
  const markup = renderToString(<EmptyState title="No orders" message="Clear the filters." />)
  assert.match(markup, /data-ui="empty" data-visual="empty" role="status"/)
  assert.match(markup, /data-ui="empty-visual" aria-hidden="true"/)
  for (const part of ['backdrop', 'sheet-back', 'sheet', 'heading', 'text'])
    assert.match(markup, new RegExp(`data-part="${part}"`))
  // The default badge is the neutral inbox; each reason has its own glyph.
  assert.match(badge(markup), /M22 12h-6l-2 3h-4l-2-3H2/)
  const glyphs = {
    start: 'M12 5v14M5 12h14',
    search: 'm21 21-4.3-4.3',
    done: 'm20 6-11 11-5-5',
    locked: 'M7 11V7a5 5 0 0 1 10 0v4',
  } as const
  for (const [visual, path] of Object.entries(glyphs)) {
    const html = renderToString(<EmptyState visual={visual as keyof typeof glyphs} title="T" message="M" />)
    assert.match(html, new RegExp(`data-visual="${visual}"`))
    assert.ok(badge(html).includes(path), `${visual} badge`)
  }
  // A caller's icon replaces only the glyph, not the reason.
  const custom = renderToString(<EmptyState visual="search" icon="package" title="T" message="M" />)
  assert.match(custom, /data-visual="search"/)
  assert.ok(badge(custom).includes('m3.29 7 8.71 5 8.71-5'))
})

test('EmptyState owns one frame and size that outranks the legacy backend empty rule', () => {
  const frame = rule('[data-ui="empty"][data-visual]')
  assert.match(frame, /min-block-size: 15rem;/)
  assert.match(frame, /border: 1px dashed var\(--kv-color-line-strong\);/)
  assert.match(frame, /border-radius: var\(--kv-radius-lg\);/)
  assert.match(frame, /background: var\(--kv-color-surface\);/)
  assert.match(frame, /max-inline-size: none;/)
  assert.match(frame, /margin: 0;/)
  assert.match(frame, /justify-items: center;/)
  for (const hook of ['empty-visual', 'empty-title', 'empty-message', 'empty-actions'])
    rule(`[data-ui="empty"][data-visual] [data-ui="${hook}"]`)
  assert.match(
    rule('[data-ui="empty"][data-visual] [data-ui="empty-visual"]'),
    /width: 7\.5rem;\s*height: 6rem;/,
  )
  // No other public stylesheet resizes or reframes the state.
  const others: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (
        path.endsWith('.css') &&
        !path.endsWith('feedback/styles.css') &&
        readFileSync(path, 'utf8').includes('[data-ui="empty')
      )
        others.push(path)
    }
  }
  walk(SRC)
  assert.deepEqual(others, [])
})

test('EmptyState illustration and badge take Két tokens so both themes follow', () => {
  for (const part of ['backdrop', 'sheet', 'sheet-back', 'text'])
    assert.match(css, new RegExp(`\\[data-part="${part}"\\][^{]*\\{[^}]*fill: var\\(--kv-color-`))
  const mark = rule('[data-ui="empty"][data-visual] [data-ui="empty-mark"]')
  assert.match(mark, /background: var\(--kv-color-accent\);/)
  assert.match(mark, /color: var\(--kv-color-surface\);/)
  assert.match(
    rule('[data-ui="empty"][data-visual="done"] [data-ui="empty-mark"]'),
    /var\(--kv-color-positive\)/,
  )
  assert.match(
    rule('[data-ui="empty"][data-visual="locked"] [data-ui="empty-mark"]'),
    /var\(--kv-color-ink-muted\)/,
  )
  assert.doesNotMatch(css.slice(css.indexOf('[data-ui="empty"][data-visual] {')), /#[0-9a-f]{3,6}\b/i)
  const specimens = readFileSync(`${SRC}/catalogue/specimens.tsx`, 'utf8')
  assert.ok(specimens.includes("id: 'empty-visuals'"))
})

test('a titled DataTable keeps the panel inset while empty and runs rows edge to edge', () => {
  const table = (rows: { id: string }[]) =>
    renderToString(
      <DataTable
        title="Orders"
        rows={rows}
        id={(row) => row.id}
        columns={[{ key: 'id', label: 'ID', cell: (row) => row.id }]}
      />,
    )
  assert.match(table([]), /data-ui="surface"[^>]*data-padding="default"[\s\S]*data-ui="empty"/)
  assert.match(table([{ id: 'A' }]), /data-ui="surface"[^>]*data-padding="none"/)
})

test('the backend emptyState helper renders the public EmptyState, so legacy screens share its frame', async () => {
  const { emptyState } = await import('../packages/ketsuite/src/ui/state.tsx')
  const markup = renderToString(emptyState('No lots', 'Receive stock to create a lot.', { visual: 'start' }))
  assert.match(markup, /data-ui="empty" data-visual="start" role="status"/)
  assert.match(
    markup,
    /data-ui="empty-title"[\s\S]*No lots[\s\S]*data-ui="empty-message"[\s\S]*Receive stock/,
  )
  assert.doesNotMatch(markup, /data-ui="empty-(?:hint|icon)"/)
  // Subject icons from older call sites no longer replace the reason badge.
  const legacy = renderToString(emptyState('Empty', 'Nothing here', { icon: '★' }))
  assert.match(legacy, /data-visual="empty"/)
  assert.doesNotMatch(legacy, /★/)
})
