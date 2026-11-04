---
title: Flow UI components
description: Compact work-management components for Ket view, styled only with design-system tokens.
---

`@ketvietlab/flow-ui` provides the presentation layer for task and project tools: an application
shell, lists, boards, task dialogs, document workspaces, pickers and overview charts. Components
are plain Ket view functions authored in JavaScript with JSDoc types, so the same call renders on
the server and in the browser.

The package owns markup and styling only. Data, persistence, routing, permissions and API calls
stay in your application.

## Install and render

```bash
# Run from: your application root
npm install @ketvietlab/flow-ui @ketvietlab/ketjs-view @ketvietlab/design-system
```

```js
// File: src/islands/tasks.mjs
import { createRoot, domHost, html } from '@ketvietlab/ketjs-view'
import { FlowButton, FlowStatus } from '@ketvietlab/flow-ui'
import { attachFlowUI } from '@ketvietlab/flow-ui/runtime'
import '@ketvietlab/design-system/tokens.css'
import '@ketvietlab/flow-ui/styles.css'

// container is an element carrying the data-flow-ui attribute.
export function mount(container, openCreate) {
  const root = createRoot(domHost(), container)
  const runtime = attachFlowUI(container)
  root.render(html`${FlowStatus({ status: 'progress' })}
    ${FlowButton({ label: 'New task', variant: 'primary', onClick: openCreate })}`)
  runtime.sync()
  return () => {
    runtime.dispose()
    root.dispose()
  }
}
```

Call `runtime.sync()` after every render so native controls and dialogs pick up new props.

## Design authority

Visual rules and Flow compatibility live in [Két Design System](https://github.com/ketvietlab/ketjs/tree/develop/skills/ket-design-system).

## Entry points

| Import                            | Contents                                                        |
| --------------------------------- | --------------------------------------------------------------- |
| `@ketvietlab/flow-ui`             | Buttons, inputs, status, tags, dialogs, task rows and cards     |
| `@ketvietlab/flow-ui/workspace`   | Shell, navigation, sections, tables, boards, pickers, charts    |
| `@ketvietlab/flow-ui/documents`   | Document tree, editor frame, outline and panels                 |
| `@ketvietlab/flow-ui/runtime`     | `attachFlowUI(root)` with `sync()`, `open(id)` and `dispose()`  |
| `@ketvietlab/flow-ui/i18n`        | Translator, locale helpers and `registerFlowMessages`           |
| `@ketvietlab/flow-ui/styles.css`  | Component stylesheet                                            |

## Translations

Copy ships in English, Japanese and Vietnamese under the `flow.` key prefix. Register your own
keys once at startup; a key that already exists throws instead of silently overriding.

```js
// File: src/i18n.mjs
import { registerFlowMessages } from '@ketvietlab/flow-ui/i18n'

registerFlowMessages({
  en: { 'billing.title': 'Billing' },
  ja: { 'billing.title': '請求' },
  vi: { 'billing.title': 'Thanh toán' },
})
```

## Demo

```bash
# Run from: the ketjs repository root
npm run build
npm --workspace @ketvietlab/flow-ui run demo
```

The demo serves the component library and a sample workspace on `http://127.0.0.1:4190/`, with
fixtures kept in browser storage only.


## Daily work view state

The native Flow client preserves an allowlisted saved-view destination and its
query, status, sort and grouping in URL parameters. Project views retain their
workspace context; personal My Work views remain personal. The directory uses
`flow.view.list` keyset pages rather than filtering a truncated candidate list.
Sharing a view requires project write access; editing a private view requires
ownership and the platform view-save permission. Search uses the same
authorization and omits private views owned by others.

Existing deployments add the nullable visibility mirror and workspace reference
through the non-destructive schema migration, then run the explicit Company
native upgrade with writers stopped. The upgrade validates references and source
metadata, rolls back on invalid rows and is idempotent. It does not import legacy
application records or grant access.


## Authenticated intake forms

The native form designer keeps stable field IDs across reorder/rename. Each
explicit publish creates an immutable schema revision; drafts cannot accept
submissions. The preview submits the record and schema revisions it rendered.
A response ledger entry keeps both the accepted answers and its exact published
schema snapshot. Task creation and response insertion share one transaction and
idempotency receipt. Required/type validation, membership, project access and
assignee access are rechecked on submission. The response list displays its
accepted schema version. Existing schema changes are additive; legacy responses
without a snapshot are not presented as reconstructed historical facts.


Private preference extensions may compose the personal settings slot and declare
finite `readOnlyCommands`. Callers opt in per command with `allowReadOnly:true`.
This is a presenter capability only; native functions keep their authentication,
platform permissions and business checks. General Task writes remain behind the
Core write gate.
