---
title: Pricing formulas and rule grids
description: Exact line prices, dependency safety and atomic native rule editing.
---

Pricing keeps `priceFor` as a base-unit net-price compatibility API. `priceForLine` returns net `price`, displayed `priceUnit`, percentage `discount` and an optional `priceBreaks` array when requested. Package thresholds count the selected sales-line unit. Fixed template rules add variant extras; a fixed package amount is not multiplied twice.

Percentage rules use list price or another active same-currency pricelist's net price; cost is available only for formulas. Percentage discounts are 0–100. Formula discounts are −1000–100 (negative means markup). Exact decimal arithmetic subtracts the discount, rounds half away from zero to the chosen multiple, adds an integer currency surcharge, then clamps below zero. Formula lines have discount 0. Persisted legacy margin bounds remain effective; the new grid does not create them. Actual persisted pricing rules already have an explicit base; the mock's pre-base `margin` object is not a production storage format or an authorized migration input.

Company-scoped graph locks serialize rule writes and active-state changes. A rule may not create a direct or indirect cycle. An active dependent pricelist prevents archiving its base; reactivation revalidates dependencies. Legacy cycles terminate at list price at the closing edge. Specificity, nearest category, packaging and minimum quantity retain their order; server-assigned creation order breaks an otherwise equal tie; legacy rows without it use descending ID. Quantity breaks recursively include eligible dated rules from base lists.

The native RecordPage uses one settings form and a KetGrid for rules. Computation controls base choices; only formulas allow cost, and base-list choices omit the current and inactive lists. Product/template/package choices use the existing remote readers. Item-only editors retain the individual rule dialog. A combined save requires both list and item grants, a fingerprint of persisted settings/rules, at most 500 rows and company-owned row identities. Removal and all writes share one caller-owned transaction. Invalid rows, concurrent edits and dependency refusals roll back the whole save. The delivery adapter converts company-local date inputs to UTC and reports the failed row. Direct function inputs remain UTC.

Sales automatic lines show a percentage rule's base unit price and discount separately, preserving its net total. `sale.listLinePrices` returns price and quantity steps without raw cost fields. The protected cost picker retains its separate grant. Native grids consume row-owned KetGrid steps when quantities or units change; manual-price and fulfilment-history locks are independent. Server writers recalculate authoritative amounts and ignore posted step/lock data. Existing saved rows are not bulk repriced by editing a pricelist.

See the VI/EN screen Help for operations. Local verification does not publish, deploy or migrate tenants.

Grid temporary IDs are replaced with durable server IDs. The nullable creation-order field is assigned under the company graph lock and cannot be supplied by callers. Editing an existing rule does not make it newer. Additive migration preserves legacy rows without backfilling guessed history; no tenant migration is run as local verification.
