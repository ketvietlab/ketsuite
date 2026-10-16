import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { KetTable } from '../packages/design-system/src/interactions/ket-table/index.tsx'
import { BulkActions, ListChrome } from '../packages/design-system/src/patterns/list-chrome/index.tsx'
import { ketTableDemoConfig } from '../packages/design-system/src/interactions/ket-table/demo.ts'

const row = { id: 'FU-1042', name: 'Contact customer' }
const props = {
  columns: [
    { key: 'work', label: 'Work', cell: (value: typeof row) => value.name, sortHref: '/work?sort=latest' },
  ],
  rows: [row],
  id: (value: typeof row) => value.id,
  rowHref: (value: typeof row) => `/work?record=followup:${value.id}`,
  selection: { formId: 'work-selection', fieldName: 'selected' },
  labels: ketTableDemoConfig.labels,
}

test('collection state: loading belongs to KetTable and never calls real row cells or exposes record commands', () => {
  const output = renderToString(
    KetTable({
      ...props,
      columns: [
        {
          ...props.columns[0],
          cell: () => {
            throw new Error('row data accessed before read')
          },
        },
      ],
      loading: { rows: 50 },
    }),
  )
  assert.equal((output.match(/data-ui="kt-row"/g) ?? []).length, 50)
  assert.equal((output.match(/data-ui="kt-placeholder"/g) ?? []).length, 50)
  assert.match(output, /aria-busy="true"/)
  assert.match(output, /data-loading="true"/)
  assert.match(output, /data-ui="kt-row-select"[^>]*disabled/)
  assert.match(output, /data-ui="kt-select-all"[^>]*disabled/)
  assert.doesNotMatch(output, /data-ui="kt-row-link"|data-ui="kt-sort-button"/)
  assert.match(output, /aria-hidden="true"/)
})

test('collection state: loading clamps rows to 1..100, owns line height and preserves selection geometry', () => {
  for (const [requested, expected] of [
    [0, 1],
    [10000, 100],
  ]) {
    const output = renderToString(KetTable({ ...props, loading: { rows: requested, lines: { work: 2 } } }))
    assert.equal((output.match(/data-ui="kt-row"/g) ?? []).length, expected)
    assert.match(output, /data-ui="kt-placeholder" data-lines="2"/)
    assert.match(output, /data-ui="kt-select-col"/)
  }
  const css = readFileSync(
    new URL('../packages/design-system/src/interactions/ket-table/styles.css', import.meta.url),
    'utf8',
  )
  assert.match(css, /\[data-ui="kt-placeholder"\][\s\S]*?min-block-size: var\(--kv-line-sm\)/)
  assert.match(css, /\[data-loading="true"\][\s\S]*?visibility: hidden/)
})

test('collection state: busy retains real links and values and delegates dimming to the public table', () => {
  const output = renderToString(KetTable({ ...props, busy: true }))
  assert.match(output, /data-busy="true"/)
  assert.match(output, /aria-busy="true"/)
  assert.match(output, /Contact customer/)
  assert.match(output, /record=followup:FU-1042/)
  assert.doesNotMatch(output, /data-ui="kt-placeholder"|data-loading="true"/)
  const css = readFileSync(
    new URL('../packages/design-system/src/interactions/ket-table/styles.css', import.meta.url),
    'utf8',
  )
  assert.match(css, /\[data-busy="true"\][\s\S]*?opacity: 0\.75/)
})

test('collection state: controlled selection survives a new pure table render with native form association', () => {
  const selected = renderToString(
    KetTable({ ...props, selectionState: { ids: [row.id], onChange: () => {} } }),
  )
  assert.match(
    selected,
    /data-ui="kt-row-select"[^>]*name="selected.FU-1042"[^>]*form="work-selection"[^>]*checked/,
  )
  assert.match(selected, /data-ui="kt-row"[^>]*data-selected="true"/)
  const cleared = renderToString(KetTable({ ...props, selectionState: { ids: [], onChange: () => {} } }))
  assert.doesNotMatch(cleared, /checked|data-selected="true"/)
})

test('collection state: a server table names each row checkbox by the subject its rowName gives', () => {
  const label = ketTableDemoConfig.labels.selectRow
  const unnamed = renderToString(KetTable(props))
  assert.match(unnamed, new RegExp(`data-ui="kt-row-select"[^>]*aria-label="${label}: FU-1042"`))
  const named = renderToString(KetTable({ ...props, rowName: (value: typeof row) => value.name }))
  assert.match(named, new RegExp(`data-ui="kt-row-select"[^>]*aria-label="${label}: Contact customer"`))
  // Placeholders have no subject yet; the real reader is never called for them.
  const loading = renderToString(
    KetTable({
      ...props,
      rowName: () => {
        throw new Error('loading rows are not named')
      },
      loading: { rows: 1 },
    }),
  )
  assert.match(loading, /data-ui="kt-row-select"[^>]*aria-label="[^"]*: loading-0"/)
})

test('collection state: clear selection resets the associated native form', () => {
  const output = renderToString(
    BulkActions({ form: 'work-selection', selectedCount: 1, clearLabel: 'Clear selection', actions: [] }),
  )
  const clear = output.match(/<button\b[^>]*name="clear-selection"[^>]*>/)?.[0]
  assert.ok(clear, 'clear command is a native button')
  assert.match(clear, /type="reset"/)
  assert.match(clear, /form="work-selection"/)
})

test('collection state: filter menus wrap inside their available canvas at desktop widths', () => {
  const css = readFileSync(
    new URL('../packages/design-system/src/patterns/list-chrome/styles.css', import.meta.url),
    'utf8',
  )
  const rule = css.match(/\[data-ui="list-filter-menus"\]\s*\{([^}]+)\}/)?.[1]
  assert.ok(rule, 'the public filter group owns its layout')
  assert.match(rule, /flex:\s*0 1 auto/)
  assert.match(rule, /flex-wrap:\s*wrap/)
  assert.match(rule, /max-inline-size:\s*100%/)
})

test('collection state: selected commands replace the query toolbar once and restore it when cleared', () => {
  const props = {
    search: { id: 'work-search', action: '/work', label: 'Search', value: 'Saved query' },
    bulkPresentation: 'replace' as const,
    bulk: { selectedCount: 1, form: 'work-selection', clearLabel: 'Clear selection', actions: [] },
  }
  const selected = renderToString(ListChrome(props))
  assert.equal((selected.match(/data-ui="bulk-actions"/g) ?? []).length, 1)
  assert.doesNotMatch(selected, /data-ui="list-search"/)
  const cleared = renderToString(ListChrome({ ...props, bulk: { ...props.bulk, selectedCount: 0 } }))
  assert.match(cleared, /data-ui="list-search"/)
  assert.match(cleared, /value="Saved query"/)
  assert.doesNotMatch(cleared, /data-ui="bulk-actions"/)
})

test('collection state: danger badge has AA small-text contrast on dark table and record surfaces', () => {
  const tokens = readFileSync(
    new URL('../packages/design-system/src/foundations/tokens.css', import.meta.url),
    'utf8',
  )
  const styles = readFileSync(
    new URL('../packages/design-system/src/primitives/status/styles.css', import.meta.url),
    'utf8',
  )
  const rule = styles.match(
    /\[data-ui="badge"\]\[data-pattern="badge"\]\[data-tone="danger"\]\s*\{([^}]+)\}/,
  )?.[1]
  assert.match(rule ?? '', /color: var\(--kv-badge-danger-text\)/)
  assert.match(
    tokens,
    /--kv-badge-danger-text:\s*light-dark\(var\(--kv-danger\), var\(--kv-ref-danger-hover\)\)/,
  )
  const hex = (name: string) => {
    const value = tokens.match(new RegExp(`${name}:\\s*#([a-f0-9]{6});`))?.[1]
    assert.ok(value, name)
    return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16))
  }
  const luminance = (rgb: number[]) =>
    rgb
      .map((v) => {
        const x = v / 255
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const tint = tokens.match(/--kv-ref-danger-bg:\s*rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/)
  assert.ok(tint)
  const alpha = Number(tint[4]) / 100
  const foreground = luminance(hex('--kv-ref-danger-hover'))
  for (const name of ['--kv-ref-bg-main', '--kv-ref-surface-1', '--kv-ref-surface-2']) {
    const base = hex(name)
    const background = luminance(base.map((v, i) => v * (1 - alpha) + Number(tint[i + 1]) * alpha))
    const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    assert.ok(ratio >= 4.5, `${name}: ${ratio}`)
  }
})

test('the selection column fills only its header cell, not the body cells under its <col>', () => {
  const css = readFileSync('packages/design-system/src/interactions/ket-table/styles.css', 'utf8')
  assert.match(css, /th\[data-ui="kt-select-col"\] \{[^}]*background: var\(--kv-table-header-bg\);/)
  // The <col> shares the hook; a background there paints the whole column.
  for (const rule of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    const selectors = rule[1]!.split(',').map((selector) => selector.trim())
    if (selectors.some((selector) => /(^|\s)\[data-ui="kt-select-col"\]/.test(selector)))
      assert.doesNotMatch(rule[2]!, /background/, `${rule[1]!.trim()} must not fill the <col>`)
  }
})
