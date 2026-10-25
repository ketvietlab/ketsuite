---
title: LiveDoc presentation and formatting
description: Native rich editor presentation, selection and keyboard contracts.
---

`createLiveDocView` from `@ketvietlab/ketsuite/livedoc` owns the editor DOM,
Yjs value, selection, commands and disposable browser runtime. Rendering the
shell is pure; document transport or persistence remains with its owner.

## Presentation

- `toolbar: 'top' | 'floating'` defaults to `top`. Floating renders the same
  commands hidden in the initial shell, then positions them near selected text.
  It occupies no document layout space. Native selects retain a model selection
  bookmark; mark and block commands restore it before changing the document.
- `surface: 'framed' | 'plain'` defaults to `framed`. Plain removes the frame,
  background and content inset. The containing document owns page padding.
- `readOnly` makes the server-rendered textbox read-only and hides commands.
  The runtime never attaches floating interactions for a read-only editor.

Public presentation hooks are `data-ui="flow-editor"` with `data-toolbar` and
`data-surface`; the toolbar retains its existing `role="toolbar"` and accessible
names. A kit embedding the editor supplies its semantic tokens through its
documented adapter. It does not create a second toolbar or command runtime.

## Interaction and lifecycle

Select text to open floating formatting. Collapse the selection or move focus
outside the editor to hide it. **Alt+F10** also opens it at the caret and focuses
the first control; **Escape** closes it and returns focus/selection to the editor.
Native Tab navigation reaches the formatting controls. Link dialogs keep their
own bookmark and return to the editor when closed. Table cells retain their
existing isolated editing model; text-format commands do not operate on them.
Inline marks/link require selected text; those controls are disabled at a caret.
Block/list/table commands remain available through the caret toolbar.

The toolbar prefers above the selection, falls below near the viewport top,
wraps at narrow widths and clamps to the editor column and visual viewport.
The first line opens below its selection to keep document header actions reachable.
Its gap derives from
computed kit padding in CSS pixels. Scroll/resize repositioning is coalesced in
an animation frame. IME composition hides floating formatting. `dispose()`
aborts the added listeners and cancels pending repositioning.

## Flow documents

`FlowLiveDoc` exposes the same `toolbar` and `surface` options, plus `hideLabel`
for a document canvas. Hiding the visible label preserves the editor's accessible
name. Flow document routes choose floating/plain; embedded task descriptions
keep the compatible top/framed default. `data-live-key` includes presentation
mode so an explicit mode change remounts the owner-scoped editor correctly.

The specimen is **Ghi chú trực tiếp** in `packages/flow-ui/demo/app.mjs`.
Focused producer checks live in `test/live-doc-floating.test.ts` and
`test/flow-editor-view.test.ts`; the Flow adapter contract is checked in
`packages/flow-ui/test/live-doc.test.mjs`. Real-browser evidence is maintained
with the consuming Flow hardening tracker. These checks do not certify the
production collaboration transport or storage adapter.


## Durable owners and multiple workers

A `DocumentOwner` with `durablePush: true` acknowledges a push only after its
snapshot commit. Hydration, merge and persistence are serialized per document on
each worker; the owner still enforces CAS across workers. Failed updates are not
kept in the worker cache or exposed by `/content`.

The SSE route sends an initial committed checkpoint, then checks the shared
immutable snapshot pointer roughly once per second. It authorizes the owner on
every check, including idle connections, and rechecks after reading blob bytes.
The stream rotates after 30 seconds; the editor reconnects and merges checkpoints
idempotently with Yjs. This requires shared database and blob storage. It does not
provide distributed presence by itself. Native Flow supplies `presenceFn` and
`presenceListFn` owner hooks backed by Company-scoped 90-second leases. Names and
actors are server-derived; reads filter revoked senders, and expiry/leave yields
`gone`. Owner hooks must authorize every read/write and bound their directory.
Owners without these hooks retain process-local presence.
Non-durable owners retain their existing in-memory relay and flatten lifecycle.
