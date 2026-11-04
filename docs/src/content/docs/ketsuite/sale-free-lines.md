---
title: Sales free lines
description: Quotation lines without products, confirmation policy and an explicit schema migration.
---

Sales lines may omit both `productId` and `productUomId`. A free line requires a
trimmed description of 1–500 characters, positive quantity, nonnegative price and
0–100% discount. It uses the existing tax quote and exact-decimal amount writers.
It creates no catalogue product, stock move or stored product-cost snapshot.

The native quotation grid includes Description and Tax. Leave Product and Unit
empty for a free line. One tax or no tax can be selected in the grid; existing
multiple-tax lines retain their taxes and lock that cell. All rows save together
under the order revision. Invalid rows, stale revisions and forbidden fields leave
the whole patch uncommitted. Product lines retain their normal unit eligibility,
pricelist and combo rules. Existing `saveDraft` product rows retain the original
product/unit/quantity contract; free rows additionally accept their own description,
price, discount and taxes.

`syncDeliveries` skips free lines. They invoice ordered quantities through the
existing invoice writer and preserve their description and null product/unit IDs.
The separately authorized `sale.getLineCosts` returns a derived zero cost for free
lines and the saved line margin (untaxed subtotal minus extended cost). It creates
no fake Product or cost row. General order reads do not gain cost or margin fields.
Unknown product cost remains unknown. Editing margin to solve a new price is a
separate feature.

## Confirmation configuration

Settings → Sales configuration is a native record page. `sale.getConfiguration`
reads the active company's policy through `sale.view`; `sale.saveConfiguration`
requires `sale.configure` and an expected revision. `requireProduct` defaults to
false. When true, quotations can still save free lines, but the common confirmation
service rejects them with the first line's description. Every caller of that service
uses the same guard; previously confirmed orders remain confirmed. This does not
claim that a customer quotation-signing/payment UI has been implemented.

Configuration changes and confirmations lock the company policy row. Company-prefixed
IDs prevent cross-company collisions, and optimistic revisions protect configuration
edits. Changing the policy never rewrites historical orders or invoices.

## Existing databases

Changing the two Sales line references from required to nullable is a **manual
migration** in KetJS. A normal `migrateOne` refuses it. New databases use the target
schema normally. Existing databases must use the exported `migrateSaleFreeLines`
helper in an operator-controlled migration window, with an opened adapter and the
exact target deployment manifest. It is not called from web requests or module load.

The helper verifies the physical schema against the recorded marker before changing
anything. It accepts only these two nullable changes and the new Sales configuration
table. Unrelated pending schema work must be applied separately. PostgreSQL alters
the two constraints in place. SQLite copies through a temporary table while keeping
the original declaration, columns, IDs and named indexes/triggers; inbound physical
foreign keys are refused for an operator-specific plan. No row is backfilled with a
fake product or unit.

DDL and `confirmManualMigration` share one transaction. Physical verification must
succeed before the migration marker advances. A failed statement rolls everything
back; a completed target returns `already-applied`. The helper is exercised on
isolated SQLite and PostgreSQL databases, including an injected DDL failure. Running
it on a live tenant is an explicit deployment action, outside normal local verification.
