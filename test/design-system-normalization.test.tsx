import { exampleApplications } from '../packages/design-system/src/catalogue/application-switcher.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  Avatar,
  AppShell,
  Badge,
  Button,
  Checkbox,
  CheckboxGroup,
  CountBadge,
  EmptyState,
  Field,
  Grid,
  Icon,
  IconButton,
  Inline,
  Link,
  LinkButton,
  LoadingState,
  MoneyField,
  Notice,
  NumberField,
  Progress,
  RadioGroup,
  SearchField,
  Select,
  Skeleton,
  Spinner,
  Stack,
  Switch,
  Tag,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from '@ketvietlab/design-system'

const render = (view: Parameters<typeof renderToString>[0]) =>
  renderToString(view).replace(/<!--.*?-->/gs, '')

test('both table implementations share contextual flattening without changing scrolling or row dividers', () => {
  const css = readFileSync('packages/design-system/src/layouts/layering/styles.css', 'utf8')
  const rule = css.split('}').find((rule) => rule.includes('[data-ui="kt-scroll"]'))!
  assert.ok(rule, 'KetTable must participate in the shared table layering rule')
  for (const owner of ['surface', 'modal-sheet', 'dialog', 'popover-panel', 'record-page-aside']) {
    assert.ok(rule.includes(`[data-ui="${owner}"]`), `missing containing level: ${owner}`)
  }
  assert.ok(rule.includes('[data-ui="table-scroll"][data-pattern="data-table"]'))
  assert.match(rule, /border: 0;/)
  assert.match(rule, /border-radius: 0;/)
  assert.match(rule, /background: transparent;/)
  assert.doesNotMatch(rule, /overflow|kt-cell|kt-row|kt-col/)
})

test('typography separates visual role, semantic heading and numeric content', () => {
  const html = render(
    <Text as="h2" variant="headingLg" fontWeight="medium" numeric alignment="end">
      123.00
    </Text>,
  )
  assert.match(html, /^<h2 /)
  assert.match(html, /data-variant="headingLg"/)
  assert.match(html, /data-weight="medium"/)
  assert.match(html, /data-numeric="true"/)
  assert.match(html, /data-align="end"/)
  assert.match(
    render(
      <Text truncate breakWord>
        Long text
      </Text>,
    ),
    /data-truncate="true" data-break-word="true"/,
  )
  assert.match(
    render(<Text tone="muted">Legacy</Text>),
    /<span data-ui="text" data-tone="muted">Legacy<\/span>/,
  )
})

test('Lucide icons have one geometry and explicit decorative or informative semantics', () => {
  const decorative = render(<Icon name="plus" />)
  assert.match(decorative, /viewBox="0 0 24 24"/)
  assert.match(decorative, /stroke-width="2"/)
  assert.match(decorative, /aria-hidden="true"/)
  const informative = render(<Icon name="triangle-alert" label="Needs review" tone="warning" />)
  assert.match(informative, /role="img" aria-label="Needs review"/)
  assert.doesNotMatch(informative, /aria-hidden/)
})

test('money in and money out have their Lucide arrows', () => {
  assert.match(render(<Icon name="arrow-down-left" />), /<path d="M17 7 7 17"[^>]*>.*<path d="M17 17H7V7"/s)
  assert.match(render(<Icon name="arrow-up-right" />), /<path d="M7 7h10v10"[^>]*>.*<path d="M7 17 17 7"/s)
})

test('action emphasis and tone are independent while legacy aliases still work', () => {
  const html = render(
    <Button label="Delete" variant="primary" tone="danger" pressed fullWidth icon="x" loading />,
  )
  assert.match(html, /data-tone="danger"/)
  assert.match(html, /data-variant="primary"/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /data-full-width="true"/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /data-ui="action-leading"/)
  assert.match(html, /data-ui="spinner"[^>]*aria-hidden="true"/)
  assert.doesNotMatch(html, /role="status"/)
  assert.match(render(<Button label="Remove" variant="destructive" size="prominent" />), /data-tone="danger"/)
  assert.match(render(<IconButton label="Add" icon={<Icon name="plus" />} />), /aria-label="Add"/)
  assert.match(render(<LinkButton label="Open" href="/record" />), /^<a /)
  assert.match(render(<LinkButton label="Open" href="/record" disabled />), /^<button /)
  assert.match(
    render(<Link label="Docs" href="https://example.com" target="_blank" />),
    /rel="noopener noreferrer"/,
  )
})

test('scalar fields share label, help and error associations including compound controls', () => {
  const cases = [
    <TextField id="field" name="x" label="Name" help="Hint" error="Invalid" prefix="SO" />,
    <SearchField id="field" name="x" label="Name" help="Hint" error="Invalid" clearable />,
    <NumberField id="field" name="x" label="Name" help="Hint" error="Invalid" />,
    <TextArea id="field" name="x" label="Name" help="Hint" error="Invalid" rows={4} />,
    <Select id="field" name="x" label="Name" help="Hint" error="Invalid" options={[]} />,
    <Switch id="field" name="x" label="Name" help="Hint" error="Invalid" />,
    <Field id="field" name="x" label="Name" help="Hint" error="Invalid" type="date" />,
  ]
  for (const view of cases) {
    const html = render(view)
    assert.equal([...html.matchAll(/for="field"/g)].length, 1)
    assert.equal([...html.matchAll(/id="field-help"/g)].length, 1)
    assert.equal([...html.matchAll(/id="field-error"/g)].length, 1)
    assert.match(html, /aria-describedby="field-help field-error"/)
    assert.match(html, /aria-invalid="true"/)
    assert.doesNotMatch(html, /<label[^>]*>(?:(?!<\/label>)[\s\S])*<label/)
  }
})

test('specialized inputs preserve native semantics and precision without value coercion', () => {
  assert.match(render(<SearchField id="q" name="q" label="Search" clearable />), /type="search"/)
  assert.match(
    render(<SearchField id="q" name="q" label="Search" clearable readOnly />),
    /data-ui="field-clear"[^>]*disabled/,
  )
  const money = render(
    <MoneyField
      id="money"
      name="money"
      label="Amount"
      currency="VND"
      precision={0}
      value="9007199254740993"
    />,
  )
  assert.match(money, /value="9007199254740993"/)
  assert.match(money, /step="1"/)
  assert.match(money, /inputmode="decimal"/)
  assert.match(money, /data-align="end"/)
  assert.match(money, /data-ui="field-affix">VND/)
  assert.match(
    render(<TextArea id="notes" name="notes" label="Notes" rows={4} resize="none" />),
    /rows="4" data-resize="none"/,
  )
  const select = render(
    <Select
      id="region"
      name="region"
      label="Region"
      placeholder="Choose region"
      required
      options={[{ value: 'vn', label: 'Vietnam' }]}
    />,
  )
  assert.match(select, /<option value="" disabled(?:="true")? selected(?:="true")?>Choose region/)
})

test('choice state is independent from native submitted value, with legacy value compatibility', () => {
  const chosen = render(<Checkbox id="a" name="warehouse" label="A" checked value="warehouse-a" />)
  assert.match(chosen, /value="warehouse-a" checked/)
  const unchecked = render(<Checkbox id="b" name="warehouse" label="B" checked={false} value="1" />)
  assert.doesNotMatch(unchecked, /\schecked(?:\s|>)/)
  assert.match(render(<Checkbox id="old" name="old" label="Old" value />), /value="1" checked/)
  assert.match(
    render(<Checkbox id="mixed" name="all" label="All" checked="indeterminate" />),
    /data-indeterminate="true" aria-checked="mixed"/,
  )
  assert.match(
    render(<Switch id="s" name="notify" label="Notify" checked value="enabled" />),
    /value="enabled" checked/,
  )
  for (const [Component, role] of [
    [CheckboxGroup, 'group'],
    [RadioGroup, 'radiogroup'],
  ] as const) {
    const group = render(
      <Component
        id="choices"
        name="choice"
        label="Choices"
        help="Pick"
        options={[{ value: 'a', label: 'A' }]}
      />,
    )
    assert.ok(group.includes(`role="${role}" aria-labelledby="choices-label"`))
    assert.match(group, /id="choices-label"/)
    assert.match(group, /aria-describedby="choices-help"/)
  }
})

test('status and tags separate information, live announcements and native commands', () => {
  assert.doesNotMatch(render(<CountBadge count={4} label="4 records" />), /role="status"/)
  assert.match(render(<CountBadge count={5} label="5 records" announce />), /role="status"/)
  assert.match(render(<Badge label="Paid" icon="check" tone="positive" />), /data-ui="icon"/)
  assert.match(
    render(<Badge label="Order" progress="partiallyComplete" progressLabel="Partially fulfilled" />),
    /Partially fulfilled/,
  )
  assert.match(render(<Tag label="A" removeHref="/?remove=a" />), /<a data-ui="tag-remove" href=/)
  const command = render(<Tag label="A" removeCommand={{ name: 'remove', value: 'a', form: 'order' }} />)
  assert.match(command, /<button data-ui="tag-remove" type="submit" name="remove" value="a" form="order"/)
  assert.match(command, /data-ui="icon"/)
  assert.doesNotMatch(render(<Tag label="A" href="/a" removeHref="/remove" disabled />), /href=/)
})

test('identity and feedback reuse primitives with explicit announcement policy', () => {
  const avatar = render(<Avatar name="Nguyễn Minh Châu" src="/avatar.jpg" decorative={false} />)
  assert.match(avatar, /role="img" aria-label="Nguyễn Minh Châu"/)
  assert.match(avatar, /data-ui="avatar-initials">MC/)
  assert.match(avatar, /data-ui="avatar-image" src="\/avatar.jpg" alt=""/)
  const notice = render(<Notice title="Saved" message="Changes saved" tone="positive" announcement="off" />)
  assert.doesNotMatch(notice, /role="(?:status|alert)"/)
  assert.match(notice, /data-ui="icon"/)
  assert.match(notice, /data-ui="text"/)
  const loading = render(<LoadingState label="Loading" />)
  assert.equal([...loading.matchAll(/role="status"/g)].length, 1)
  assert.match(loading, /data-ui="skeleton" aria-hidden="true"/)
  assert.match(render(<Spinner label="Wait" />), /role="status"/)
  assert.equal(
    [...render(<Skeleton label="Loading" lines={Infinity} />).matchAll(/data-ui="skeleton-line"/g)].length,
    3,
  )
  assert.match(render(<Progress label="Upload" value={120} size="large" />), /aria-valuenow="100"/)
})

test('layout exposes token roles and tooltip associates the actual focus target during SSR', () => {
  assert.match(
    render(<Inline items={[]} gap="column" align="between" blockAlign="baseline" wrap={false} />),
    /data-gap="column" data-align="between" data-block-align="baseline" data-wrap="false"/,
  )
  assert.match(
    render(<Stack items={[]} gap={{ desktop: 'compact', mobile: 'default' }} />),
    /data-gap="compact" data-mobile-gap="default"/,
  )
  assert.match(render(<Grid items={[]} columns={2} mobileColumns={1} />), /data-mobile-columns="1"/)
  const tooltip = render(
    <Tooltip
      id="hint"
      text="More information"
      trigger={({ describedBy }) => <Button label="Info" describedBy={describedBy} />}
    />,
  )
  assert.match(tooltip, /<button[^>]*aria-describedby="hint"/)
  assert.doesNotMatch(tooltip, /<span data-ui="tooltip-trigger" aria-describedby/)
})

test('a table scroll region is the boundary, so a wrapping Stack keeps its cells at their own width', () => {
  // The region contains its inline size: its table scrolls inside it instead of widening the page.
  for (const [file, selector] of [
    ['interactions/ket-table/styles.css', '[data-ui="kt-scroll"] {'],
    ['patterns/data-table/styles.css', '[data-ui="table-scroll"][data-pattern="data-table"] {'],
  ]) {
    const css = readFileSync(`packages/design-system/src/${file}`, 'utf8')
    const region = css.split('}').find((rule) => rule.includes(selector))
    assert.ok(region, `${file} must own its scroll region`)
    assert.match(region, /overflow-x: auto;/)
    assert.match(region, /contain: inline-size;/)
  }
  // Shrinking the Stack instead takes the min-content of a two-line cell, so its lines collapse and overlap.
  const layout = readFileSync('packages/design-system/src/layouts/layout/styles.css', 'utf8')
  const stack = layout.split('}').find((rule) => rule.includes('[data-ui="stack"][data-pattern="stack"] {'))
  assert.ok(stack, 'the public Stack must own its layout')
  assert.doesNotMatch(stack, /grid-template-columns/)
  assert.doesNotMatch(layout, /\[data-ui="stack"\]\[data-pattern="stack"\] > \*/)
  const specimen = readFileSync('packages/design-system/src/catalogue/specimens.tsx', 'utf8')
  assert.ok(specimen.includes("id: 'stack-scroll-boundary'"))
})

test('EmptyState preserves long search terms without widening or clipping a narrow layout', () => {
  const value = 'W'.repeat(100)
  const markup = render(<EmptyState title={value} message={`No match for ${value}`} />)
  assert.ok(markup.includes(value), 'the reader must still see the complete search term')
  assert.match(markup, /data-ui="empty" data-visual="empty" role="status"/)
  const css = readFileSync('packages/design-system/src/primitives/feedback/styles.css', 'utf8')
  const rule = css.split('}').find((rule) => rule.includes('[data-ui="empty"][data-visual] {'))!
  assert.match(rule, /grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(rule, /overflow-wrap: anywhere;/)
  assert.doesNotMatch(rule, /overflow:\s*(hidden|clip)/)
  assert.ok(
    readFileSync('packages/design-system/src/catalogue/specimens.tsx', 'utf8').includes(
      "id: 'empty-long-content'",
    ),
  )
})

test('stacked data tables override desktop fixed row height at the owning selector', () => {
  const css = readFileSync('packages/design-system/src/patterns/data-table/styles.css', 'utf8')
  const row = css
    .replace(/\s+/g, ' ')
    .split('}')
    .find((rule) =>
      rule.includes(
        '[data-ui="table-scroll"][data-pattern="data-table"][data-responsive="stack"] [data-ui="row"] {',
      ),
    )
  assert.ok(row, 'mobile selector must outrank the desktop data-table row selector')
  assert.match(row, /height: auto;/)
  assert.match(row, /display: grid;/)
  const legacy = readFileSync('packages/ketsuite/src/modules/backend/design/lists.css', 'utf8')
  assert.ok(
    legacy.includes('[data-ui="table-scroll"]:not([data-pattern="data-table"]):not([data-gutter="compact"])'),
  )
  // The legacy compact inset never reaches a DataTable: in a card it pushed the table past the edge.
  const flat = legacy.replace(/\s+/g, ' ')
  assert.match(
    flat,
    /\[data-ui="table-scroll"\]\[data-gutter="compact"\]:not\(\[data-pattern="data-table"\]\) \{ margin: 10px;/,
  )
  assert.doesNotMatch(flat, /\[data-ui="table-scroll"\]\[data-gutter="compact"\] \{ margin: 10px/)
})

test('page gutter and card gaps share the responsive layout token', () => {
  const css = readFileSync('packages/design-system/src/foundations/tokens.css', 'utf8')
  const declarations = [...css.matchAll(/--kv-page-padding-x:\s*([^;]+);/g)]
  assert.ok(declarations.length > 0)
  for (const match of declarations) assert.equal(match[1], 'var(--kv-layout-gap)')
  assert.match(css, /--kv-layout-gap: 0\.5rem;/)
  assert.match(css, /--kv-layout-gap: 0\.75rem;/)
  assert.match(css, /--kv-gap-section: var\(--kv-layout-gap\);/)
})

test('a mobile location shell reserves no grid height for its closed navigation', () => {
  const html = render(
    <AppShell applications={exampleApplications} sidebar="Navigation" location="Location" main="Content" />,
  )
  assert.match(html, /data-has-location="true"/)
  assert.doesNotMatch(html, /data-has-topbar="true"/)
  assert.match(
    html,
    /<aside data-ui="app-sidebar">Navigation<\/aside><main data-ui="app-main">LocationContent/,
  )
  const css = readFileSync('packages/design-system/src/layouts/shell/styles.css', 'utf8')
  // A zero-height sidebar still occupies an implicit auto grid row. Its track
  // must stay zero, otherwise min-height: 100dvh distributes spare height to it.
  // An explicit legacy topbar keeps its own two-row layout.
  assert.match(
    css,
    /@media \(width < 48rem\) \{\s*:where\(\[data-kv-design-system\]\)\s*\[data-ui="app-shell"\]\[data-has-location="true"\]:not\(\[data-has-topbar="true"\]\)\s*\{(?:\s|\/\*[\s\S]*?\*\/)*grid-template-rows: 0 minmax\(0, 1fr\);/,
  )
})
