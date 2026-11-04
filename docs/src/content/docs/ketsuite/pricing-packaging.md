---
title: Packaging-specific sales prices
description: Pricing rules for a sales-line unit, with base-unit API compatibility.
---

Commerce composes both `pricing` and `pricing_backend`. A pricelist's record page
reads its context in the browser and uses the native record runtime for settings,
rule dialogs, drafts, field refusals and reloads. Its Help is available in English
and Vietnamese. The collection uses three native client islands over one paged
read. Search, advanced filters, groups, saved searches, sorting and paging keep URL
state; typing applies after a short pause, Back restores a query and record Close returns to the filtered collection.
The native create POST fallback remains available and enforces write permission.

The list endpoint returns at most 100 flat rows (50 by default), clamps pages and
keeps reads within the authenticated company/branch scope. Group leaves use the
existing 50-row group pager. The legacy domain API still reads the authorized
company collection on the server; this migration bounds browser payloads, not
server query cost. Failed/offline/denied and first-use/no-match states use native
components. A shared disposable store aborts superseded reads, rejects late
answers, caches recent queries and clears retained data on permission denial.

## Category precedence

After scope precedence (variant, template, category, global), category rules prefer
the nearest matching category before comparing minimum quantities. Eligibility
still applies first: a nearer rule outside its date range or quantity threshold
cannot hide an applicable ancestor. Within one category, higher eligible quantity
thresholds win, with stable rule ID ordering for ties. Renaming keeps relational
IDs; moving a category changes its current ancestor fallback. This applies to both
the base-unit API and sales-line unit pricing; it does not reprice saved lines.

## Rule contract

`pricing.PricelistItem.uomId` is nullable. Only variant and product-template rules
can select packaging. The unit must be active, in the product's measurement family,
and explicitly enabled by `product.TemplateUom` or the active company's
`product.ProductUom`. Template rules use template links only. Selecting the product's
base unit normalizes to an unrestricted rule.

`pricing.priceForLine` returns the price of **one requested sales-line unit** and
its `uomId`. Sales quotation creation uses this result directly, without multiplying
the package factor a second time. An explicit negotiated sales price remains per
sales-line unit.

- Variant scope outranks template, then category and global scope. Within the same
  scope, matching packaging outranks an unrestricted rule, then minimum quantity
  decides. Category-depth ordering is unchanged by this feature.
- Minimum quantity is in sales-line units: two boxes means two, regardless of how
  many base units those boxes contain.
- A packaging fixed amount is already per package. A template fixed rule also adds
  variant extras multiplied by the package factor. Without packaging, both fixed
  amount and template extras convert from the base unit.
- Percentage/formula bases are in the sales-line unit. A packaging rule's surcharge
  and margin limits are per package; a rule without packaging states them per base
  unit and they scale by the line's unit factor. The rounding
  step is applied as entered. Nested pricelists retain the requested unit and
  quantity, require matching currency, and reject recursion.
- The line-price engine uses exact decimal text arithmetic. Unit ratios retain the
  existing 15-significant-digit UoM conversion contract; this is not a new arbitrary
  precision unit-conversion engine.

`pricing.priceFor` preserves its legacy base-unit price and converted-quantity
contract. It ignores packaging-specific rules. Existing POS and other consumers
of that contract are not silently migrated to line-unit pricing. The public
`pricingFunctionSpecs` export and compatibility entry point remain available.

## Access and editing

Commerce sales managers receive `pricing.configure`. Sales representatives,
accountants and tenant auditors can read pricing; warehouse operators do not gain
pricing access. Context enrichments use optional permission-checked reads. Hiding
write controls is backed by function and command-route authorization.

The packaging picker reads `pricing.listRuleUnits`. Changing scope or product
clears dependent relation drafts. Fixed, percentage and formula editors show the
fields relevant to the selected computation. Native date/time controls display the
effective company/viewer timezone, and the command adapter converts to UTC before
calling the domain function. Invalid input remains in the dialog.

Saving a rule does not reprice existing sales lines. No release, production data
migration or deployment is implied by local verification. Existing databases need
the normal nullable-field migration before this source is deployed.
