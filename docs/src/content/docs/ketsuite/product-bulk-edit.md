---
title: Product bulk edits
description: Atomic edits with native field permissions, immutable SUA receipts and product history.
---

Select 1–200 active products on the current product-list page and choose **Bulk edit**.
The native modal keeps the selection, asks for one field and a new value, and offers only
fields the actor may change. Neither selector implicitly chooses its first option. Changing
the field clears the previous value. A refused submission preserves the raw draft.

Supported fields are product group, add/remove tag, existing sales tax, sales price,
can be sold, can be purchased, customer lead days and inventory tracking. Lead days are
whole numbers from 0 through 365. Sales prices are nonnegative exact decimals using a dot.
Existing groups, tags and taxes are selected by identity; this operation does not create them.
Enabling inventory tracking preserves its current lot/serial policy; disabling it selects none.

## Transaction and permission boundary

`product.bulkEditProducts` accepts an intent id, a unique list of `{ id, revision }` product
snapshots, a field, its textual value and an optional locale. Boolean fields accept only
the exact strings `true` and `false`. The server independently validates every field.

The command owns one transaction. A company sequence serializes receipt numbering and
replay, then products are locked in stable identity order. Missing, archived, foreign-company
or stale products refuse the whole selection. The existing `saveProductRecord` service runs
with `inTransaction: true`, preserving native product, tag, category, tax and stock validation.
General fields require `product.saveTemplate`; inventory requires `stock.configureProduct`.
Physical stock prevents changes to inventory setup. No grant is inferred from visible controls.

Compare canonical values before invoking the writer. `03` and `3` lead days, equal decimal
prices and already-present tags do not change a product's revision or timestamps. One late
refusal rolls back prior saves and receipt numbering. Error messages identify the product
and field. Reopening after a conflict reads fresh revisions; no automatic overwrite occurs.

The same intent and structurally equal request replays the same receipt. A changed request
under that id refuses. Structural comparison is required because PostgreSQL JSONB may reorder
object keys. Concurrent conflicts may be retried with the same intent, preserving idempotency.

## Receipt and history

Every successful submission, including a no-op, creates a company-scoped append-only
`product.BulkEdit` receipt numbered `SUA/0001`, recording actor, time, field, value, selected
count and changed count. Each changed product gets one append-only `BulkEditItem` with
before/after values and an identity/name snapshot. Products that already matched get no item.
Audit identities are text so an otherwise permitted product deletion does not erase history.

Catalogue readers see recent SUA entries in the product page, with actor name, translated
field, value label and changed/selected counts. There is no separate bulk-receipt list.
`product.listBulkEdits` bounds results to at most 100 and only reads the active company.

## Verification boundary

Commerce HTTP tests cover canonical no-op snapshots, exact prices, native choices, permissions,
stock refusal rollback, stale revisions, company isolation, 200-selection limits and concurrent
replay. UI tests cover unselected fields, draft retention, context projections and translated
history. PostgreSQL is required to verify JSONB replay semantics. Mutation tests verify critical
transaction, limit, no-op, replay and history guards. Local checks do not imply release or deployment.
