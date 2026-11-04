---
title: Quotation line grid
description: Atomic line edits in a native Commerce quotation record.
---

A quotation or sales order is a page (`/admin/sales/quotations/{id}`, `/admin/sales/orders/{id}`; see
[record modal](./record-modal.md)). Its **Products** card uses the public design-system KetGrid for locally
owned, unlocked quotations and orders; it requires `sale.applyLineGrid`, included in `sale.quote-operate`.
Without it the lines table is read-only: no add row, no **Edit line** dialog (DS README, "Editable grids:
KetGrid").

A draft or sent quotation whose lines already have stock moves or invoice lines (a reopened order)
keeps those references. Its saved lines change as a confirmed order's do (`applyConfirmedGrid`: no
product or unit change, quantities not below what was delivered or invoiced), nothing is removed or
reordered, and added product lines are written after the last saved one, in the grid's order
(`sale.error.historyGridStructure` otherwise). The grid locks saved identities, shows **Delivered** and
**Invoiced**, and offers only a product row to add.

Choose a variant before its unit. Unit options come from `sale.listLineUnits` for that
row's current variant; changing the variant clears the unit and price, and changing
the unit clears the price. A blank price is calculated by the server per packaging.
An explicit price is already per packaging. The price column retains decimal text
instead of converting money through a JavaScript Number.

**Save lines** sends one patch with added, updated and removed rows and optional row
order. Added IDs are temporary and replaced by server IDs. The server checks the
order revision, company, authority, state, references and writable fields, then writes
all lines in one transaction. One invalid line rolls back the entire patch. Existing
negotiated prices, discounts and tax selections remain unless their editable fields
change; tax amounts and totals are server-owned. A quotation holds at most 100 lines.

The record keeps structural drafts and learned option labels after refusal. Labels
are display metadata and are stripped before the business call. Refusals appear in
the visible record summary because the grid's posted field is hidden. Concurrent
edits require reloading the page and reconciling against its latest revision.

The grid's draft starts from KetGrid's clean value (`KET_GRID_NO_CHANGES`, `{"added":[],"updated":[],"removed":[],"order":null}`),
not an empty string: a record form compares each field with its first value, and an empty first value
would make an untouched grid read as edited, so **Back to list** would ask to discard nothing.

The grid supports keyboard movement, edit, undo and row reordering; editing is frozen
while a save is pending. On a phone, the page stacks its cards and the grid scrolls
horizontally inside its card. The translated Help guide describes the grid, including its mode for quotations
with deliveries or invoices.

The public API is documented in `packages/design-system/README.md` under **KetGrid**.
Focused tests are `test/design-system-ket-grid.test.ts`,
`test/sale-line-grid-http.test.ts` and `test/sale-packaging-modal.test.tsx`.
The HTTP fixture boots the Commerce deployment and supports an isolated PostgreSQL
lane through `KET_COMMERCE_PG`.

## Combo lines

Saving a combo adds one child per ordered product choice, initially its first item. The server
retains `comboBasePrice` on the parent, whose commercial unit price and totals are zero. Child
`comboParentId` and `comboChoiceId` identify the group and constrain item changes. Deterministic
child IDs encode the company, parent and choice without delimiter ambiguity. The grid displays
the parent's allocation price; order totals count only child amounts.

The combo's explicit or pricelist price is allocated in currency minor units in proportion to
the selected variants' base sales prices. Zero-priced items share equally when all weights are
zero. The last item receives the remainder, then item extras are added. Quantity and discount
follow the parent; item unit, price and taxes are server-owned. Removing one child restores its
selection; removing a parent removes its group. The 100-line limit includes generated children.

Deliveries and invoices omit the parent. Parent quantity changes on confirmed orders preserve
historical item unit prices and cannot fall below delivered, invoiced or picked quantities.
Pending demand is resized in the same transaction and excess unpicked reservations are released;
an increase without pending moves creates a supplementary picking. Picking completion and demand
resize share a picking lock. Order edits and invoicing share the order revision lock. Changing the
retained combo price after stock/invoice history does not reallocate items; historical taxes and
discounts stay fixed. A child with stock/invoice history cannot change its SKU.

The internal Stock domain service `resizeMoveDemand` owns reservation release and demand changes;
Sale composes it with its declared effects inside the order transaction. POS and online combo
selection remain out of scope. Tests: `sale-combos-http.test.ts`, on SQLite and PostgreSQL.

## Saved line costs

`sale.OrderLineCost` stores cost separately from `sale.OrderLine`. Ordinary order
reads and customer quotation reports never include it. `sale.getLineCosts` requires
the sensitive `sale.cost` bundle and narrows reads to the active company. Commerce
sales representatives, sales managers and tenant auditors receive that bundle;
granting quotation operation or order viewing alone does not grant cost access.

Each snapshot contains the SKU, base unit, selling unit, conversion factor, base
cost, cost for one selling unit, company currency and capture time. Decimal
multiplication preserves precision; this is not a currency conversion or a posted
stock valuation. No source cost is `null`, distinct from a known zero cost.

Adding or editing a quotation line captures current cost, in the unit the line sells in (the product's own
when a new line leaves the unit empty). Grid/saveDraft replacement
refreshes the saved rows. If source cost is missing, an existing snapshot is retained
only when SKU, both units, factor and currency still match. Reading or confirming an
order does not reprice it. Existing lines are not backfilled from today's cost.
Reward and externally imported lines that bypass the quotation writer have no
snapshot until a supported ordinary-line edit captures one.

The page's permission-controlled **Saved line costs** card describes persisted
lines, separately from the editable grid draft. It names each selling unit and
currency and distinguishes unavailable cost from zero. It is not a margin preview.

The public add-line HTTP command owns a transaction around its line and snapshot.
`saleFunctionSpecs.addLine` remains the public composition contract: its handler
uses the caller's transaction, and consumers must include its declared effects.
CRM quotation replacement removes cost satellites before replacing lines. Removal,
replacement, revision checks and cost writes roll back together.

Focused cost coverage is in `test/sale-line-costs-http.test.ts`, including HTTP
permissions, tenant isolation, a database-induced write failure, concurrency and
missing-cost retention. It runs on SQLite and the isolated PostgreSQL lane.
Packaging-specific rules use `pricing.priceForLine`; see [packaging prices](./pricing-packaging.md).

The page reads one context (`/admin/sales/record/{id}/context`) for its permissions, grid and saved-cost
data. Saving refreshes all displayed totals. Confirm and cancel post to `/admin/sales/order-command`, which
keeps installed loyalty composition (`loyalty_sale.*`); Commerce without that bridge uses the
revision-checked Sale function. Confirm, cancel and reset navigate to the order's or quotation's URL,
dropping a `returnTo` list that no longer holds it. Print links only appear when a renderer route and the
report source permission exist, and keep the page's company and branch. The order's conversation and
activities sit in the page's aside (`sale_backend:order.collaboration`, gated by each fill's `may`); the
server keeps legacy form POST compatibility.

## Lines without products

The Description column supports lines without Product or Unit. Tax selects one tax
or no tax; existing multi-tax rows remain unchanged and lock that cell. See
[Sales free lines](./sale-free-lines.md) for validation, confirmation configuration,
permission-filtered zero cost/margin and the explicit schema migration.

## Wide line records

Sales pages opt into the public RecordPage wide rail breakpoint: reference facts
follow the record through 91.5rem of page width, then dock beside it. The editable
columns total 1012px including their row handle. A 1440px Commerce viewport with
navigation shows every column; smaller screens scroll only the grid. SKU cells
show their code, while picker descriptions retain the full searchable name.
Uncoded legacy options fall back to their name. Saved line descriptions remain
historical text; `getOrder` adds the current product code separately. Confirmed
line tables use compact numeric/currency columns and a separate description.
